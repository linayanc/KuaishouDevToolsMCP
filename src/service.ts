import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CdpConnection } from './cdp.js';
import QRCode from 'qrcode';
import { redact } from './redact.js';
import { localUrl, type Config } from './config.js';
import { IdeBridge } from './bridge.js';
import { errorMessage, ToolError } from './errors.js';
import { LogStore, type Query } from './logs.js';
import { samePath, validateProject } from './project.js';

export class KuaishouService {
  private project?: string;
  private projectId?: string;
  private runtimeUrl?: string;
  private bridge: IdeBridge;
  private store: LogStore;
  private connection?: CdpConnection;
  private targetId?: string;
  private attaching?: Promise<void>;
  private ticker?: NodeJS.Timeout;
  private closed = false;
  private everConnected = false;
  private gaps = 0;
  private lastError?: string;
  private baseline = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private shutdown = new AbortController();
  constructor(readonly config: Config) { this.store = new LogStore(config.capacity); this.bridge = new IdeBridge(config.endpoint); }

  // An MCP host may send parallel calls. Serialize project changes and default cursor updates.
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private status() {
    return { state: this.connection?.connected ? 'connected' : 'disconnected', targetId: this.targetId,
      source: 'device-cdp-explicit', possibleGapCount: this.gaps, lastError: this.lastError };
  }

  async openProject(input: string, importIfMissing = false) {
    const project = await validateProject(input, this.config.allowedRoots);
    const entry = await this.bridge.openProject(project, importIfMissing);
    if (this.ticker) clearInterval(this.ticker);
    // Do not allow an old attach operation to write into a new project session.
    await this.attaching;
    this.connection?.close();
    this.connection = undefined;
    this.project = project;
    this.projectId = entry.id;
    this.runtimeUrl = undefined;
    this.store = new LogStore(this.config.capacity);
    this.baseline = 0;
    this.gaps = 0;
    this.everConnected = false;
    this.targetId = undefined;
    this.lastError = undefined;
    this.shutdown.signal.throwIfAborted();
    this.ticker = setInterval(() => { void this.ensureConnection(); }, 2000);
    this.ticker.unref();
    return { opened: true, projectPath: project, projectId: entry.id, connection: this.status(),
      warning: 'This IDE project window does not run the game. Use kuaishou_start_debug, scan its QR on a phone, then kuaishou_connect_runtime with the local device proxy WebSocket URL.' };
  }

  async connectRuntime(input: string, address: string) {
    const project = await validateProject(input, this.config.allowedRoots);
    if (!this.project || !samePath(project, this.project)) throw new ToolError('PROJECT_MISMATCH', 'Open this project before binding its runtime.');
    const url = localUrl(address, ['ws:']);
    if (url.pathname.startsWith('/devtools/page/')) throw new ToolError('RUNTIME_INVALID', 'Do not connect the IDE project/editor WebSocket as a game runtime. Use the device proxy.');
    await this.attaching;
    this.connection?.close();
    this.connection = undefined;
    this.runtimeUrl = url.href;
    this.store = new LogStore(this.config.capacity);
    this.baseline = 0;
    this.gaps = 0;
    this.everConnected = false;
    this.targetId = undefined;
    this.lastError = undefined;
    await this.ensureConnection();
    if (!this.everConnected) throw new ToolError('RUNTIME_NOT_CONNECTED', this.lastError ?? 'Device is not connected.');
    return { projectPath: project, connection: this.status(),
      warning: 'Runtime association was explicitly supplied by the caller; verify that this device proxy belongs to this project.' };
  }

  private async attach(): Promise<void> {
    if (!this.project || !this.runtimeUrl || this.closed || this.connection?.connected) return;
    let connection: CdpConnection | undefined;
    try {
      if (this.closed) return;
      connection = new CdpConnection();
      const store = this.store;
      connection.onEvent = event => store.append(event, 'explicit-device-runtime');
      connection.onDisconnect = () => { this.gaps++; this.lastError = 'Device disconnected; reconnecting. Logs during the gap may be unavailable.'; };
      this.connection = connection;
      await connection.connect(this.runtimeUrl);
      await connection.enableRuntime();
      if (this.closed) { connection.close(); return; }
      this.targetId = 'explicit-device-runtime';
      this.everConnected = true;
      this.lastError = undefined;
    } catch (error) {
      connection?.close();
      this.lastError = redact(errorMessage(error));
    }
  }

  private ensureConnection(): Promise<void> {
    if (!this.attaching) this.attaching = this.attach().finally(() => { this.attaching = undefined; });
    return this.attaching;
  }

  async read(query: Query = {}, errorsOnly = false) {
    await this.prepareRead();
    const result = this.store.snapshot(errorsOnly ? { ...query, levels: ['error', 'exception'] } : query);
    this.baseline = this.store.parseCursor(result.nextCursor);
    return { projectPath: this.project, ...result, connection: this.status() };
  }

  async watch(query: Query & { cursor?: string; waitMs?: number } = {}, signal?: AbortSignal) {
    await this.prepareRead();
    let after = query.cursor ? this.store.parseCursor(query.cursor) : this.baseline;
    const deadline = Date.now() + (query.waitMs ?? 0);
    let result = this.store.since(after, query);
    let dropped = result.dropped;
    while (!result.entries.length && Date.now() < deadline && !this.closed) {
      signal?.throwIfAborted();
      after = this.store.parseCursor(result.nextCursor);
      await delay(Math.min(100, Math.max(1, deadline - Date.now())), undefined, { signal: signal ?? this.shutdown.signal });
      result = this.store.since(after, query);
      dropped += result.dropped;
    }
    signal?.throwIfAborted();
    if (!query.cursor) this.baseline = this.store.parseCursor(result.nextCursor);
    return { projectPath: this.project, ...result, dropped, connection: this.status() };
  }

  private async prepareRead(): Promise<void> {
    if (!this.project) throw new ToolError('PROJECT_NOT_OPEN', 'Call kuaishou_open_project before reading logs.');
    if (!this.runtimeUrl) throw new ToolError('RUNTIME_NOT_CONNECTED', 'Call kuaishou_connect_runtime with this project\'s local device proxy WebSocket URL. IDE/editor logs are not game logs.');
    await this.ensureConnection();
    if (!this.everConnected) throw new ToolError('RUNTIME_NOT_CONNECTED', this.lastError ?? 'Simulator is not connected.');
  }

  async preview(input?: string, debug = false) {
    const project = input ? await validateProject(input, this.config.allowedRoots) : this.project;
    if (!project || !this.projectId || !this.project || !samePath(project, this.project)) throw new ToolError('PROJECT_NOT_OPEN', 'Call kuaishou_open_project for this project first.');
    const result = await this.bridge.generate(this.projectId, project, debug);
    const directory = await mkdtemp(path.join(tmpdir(), 'kuaishou-mcp-preview-'));
    const qrCodePath = path.join(directory, 'preview.png');
    const bytes = await QRCode.toBuffer(result.scheme, { type: 'png', width: 360, margin: 2 });
    await writeFile(qrCodePath, bytes, { mode: 0o600 });
    return { projectPath: project, qrCodePath, action: result.action, packageType: result.packageType,
      connection: this.status(), image: bytes.toString('base64'),
      nextStep: debug ? 'Scan with Kuaishou on the same LAN. Find the ws= host:port in the new inspector window URL; bind ws://127.0.0.1:<port> with kuaishou_connect_runtime. Do not use the phone IP or the IDE renderer WebSocket.' : undefined };
  }

  close(): void {
    this.closed = true;
    this.shutdown.abort();
    if (this.ticker) clearInterval(this.ticker);
    this.connection?.close();
    this.bridge.close();
  }
}
