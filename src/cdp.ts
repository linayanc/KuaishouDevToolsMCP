import WebSocket from 'ws';
import { localUrl } from './config.js';
import { ToolError } from './errors.js';
import type { CdpEvent } from './logs.js';

export class CdpConnection {
  private socket?: WebSocket;
  // The IDE's device proxy broadcasts responses to all local clients.
  private sequence = Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  onEvent?: (event: CdpEvent) => void;
  onDisconnect?: () => void;
  get connected(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  async connect(address: string): Promise<void> {
    localUrl(address, ['ws:']);
    const socket = new WebSocket(address, { handshakeTimeout: 3000, maxPayload: 2 * 1024 * 1024, followRedirects: false });
    this.socket = socket;
    socket.on('error', () => { /* reported by connect or close; never unhandled */ });
    socket.on('message', buffer => {
      try {
        const message = JSON.parse(buffer.toString());
        if (typeof message.id === 'number') {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new ToolError('CDP_COMMAND_FAILED', String(message.error.message)));
          else pending.resolve(message.result);
        } else if (typeof message.method === 'string') this.onEvent?.(message);
      } catch { /* malformed remote event is ignored */ }
    });
    socket.on('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new ToolError('CDP_DISCONNECTED', 'Local debugging connection closed.'));
      }
      this.pending.clear();
      this.onDisconnect?.();
    });
    await new Promise<void>((resolve, reject) => {
      const failed = () => reject(new ToolError('CDP_UNAVAILABLE', 'Could not connect to the local debugging WebSocket.'));
      socket.once('error', failed);
      socket.once('close', failed);
      socket.once('open', () => { socket.off('error', failed); socket.off('close', failed); resolve(); });
    });
  }

  async enableRuntime(): Promise<void> { await this.request('Runtime.enable'); }

  request(method: string, params: Record<string, unknown> = {}, timeout = 3000): Promise<any> {
    if (!this.connected) return Promise.reject(new ToolError('CDP_DISCONNECTED', 'Local debugging connection is disconnected.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError('CDP_TIMEOUT', `${method} timed out. The IDE may still finish the operation.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  close(): void {
    this.onDisconnect = undefined;
    this.onEvent = undefined;
    this.socket?.terminate();
  }
}
