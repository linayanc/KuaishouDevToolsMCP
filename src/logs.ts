import { createHash, randomUUID } from 'node:crypto';
import { redact } from './redact.js';
import { ToolError } from './errors.js';

export const levels = ['log', 'info', 'warn', 'debug', 'error', 'exception'] as const;
export type Level = typeof levels[number];
export interface Frame { functionName: string; url: string; line: number; column: number }
export interface LogEntry {
  id: number;
  timestamp: string;
  level: Level;
  message: string;
  source: 'console' | 'exception';
  targetId: string;
  stack: Frame[];
  truncated: boolean;
}
export interface Query { limit?: number; levels?: Level[]; contains?: string }
export interface CdpEvent { method: string; params?: Record<string, any> }

function sourceUrl(value: string): string {
  // No query strings / fragments from authenticated debugging URLs in tool output.
  return redact(value.split(/[?#]/, 1)[0] ?? '').slice(0, 1000);
}
function frames(stack: any): Frame[] {
  if (!Array.isArray(stack?.callFrames)) return [];
  return stack.callFrames.slice(0, 20).map((frame: any) => ({
    functionName: redact(String(frame.functionName ?? '')).slice(0, 200),
    url: sourceUrl(String(frame.url ?? '')),
    line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : 0,
    column: Number.isFinite(frame.columnNumber) ? frame.columnNumber + 1 : 0,
  }));
}
function argument(arg: any): string {
  if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  if (arg.unserializableValue !== undefined) return String(arg.unserializableValue);
  // Use protocol previews only: no evaluate, getters, or remote object traversal.
  if (arg.subtype === 'error') return String(arg.description ?? 'Error');
  if (Array.isArray(arg.preview?.properties)) {
    return `${arg.description ?? arg.type} {${arg.preview.properties.slice(0, 20)
      .map((p: any) => `${p.name}: ${p.value ?? p.type}`).join(', ')}${arg.preview.overflow ? ', …' : ''}}`;
  }
  return String(arg.description ?? arg.type ?? 'undefined');
}

export function normalizeEvent(event: CdpEvent, targetId: string): Omit<LogEntry, 'id'> | undefined {
  const p = event.params;
  if (!p) return;
  let message: string, level: Level, stack: Frame[], source: LogEntry['source'];
  if (event.method === 'Runtime.consoleAPICalled') {
    if (!Array.isArray(p.args)) return;
    message = p.args.slice(0, 100).map(argument).join(' ');
    const mapping: Record<string, Level> = { warning: 'warn', assert: 'error', error: 'error', debug: 'debug', info: 'info' };
    level = mapping[p.type] ?? 'log';
    stack = frames(p.stackTrace);
    source = 'console';
  } else if (event.method === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails;
    if (!d) return;
    message = String(d.exception?.description ?? d.text ?? 'Uncaught exception');
    stack = frames(d.stackTrace);
    if (!stack.length && d.url) stack.push({ functionName: '', url: sourceUrl(String(d.url)), line: (d.lineNumber ?? 0) + 1, column: (d.columnNumber ?? 0) + 1 });
    level = 'exception';
    source = 'exception';
  } else return;
  message = redact(message);
  const date = new Date(typeof p.timestamp === 'number' ? p.timestamp : Date.now());
  return { timestamp: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(), level,
    message: message.slice(0, 8000), source, targetId, stack, truncated: message.length > 8000 };
}

export class LogStore {
  readonly session = randomUUID();
  private entries: LogEntry[] = [];
  private sequence = 0;
  private fingerprints = new Map<string, true>();
  constructor(readonly capacity = 2000) {}
  get latest(): number { return this.sequence; }
  cursor(id = this.latest): string { return `${this.session}:${id}`; }
  parseCursor(cursor: string): number {
    const [session, value, extra] = cursor.split(':');
    const number = Number(value);
    if (session !== this.session || extra !== undefined || !/^\d+$/.test(value ?? '') || !Number.isSafeInteger(number) || number > this.sequence) {
      throw new ToolError('CURSOR_INVALID', 'Cursor belongs to another project/server session or is invalid.', 'Call kuaishou_get_logs to obtain a fresh cursor.');
    }
    return number;
  }
  append(event: CdpEvent, targetId: string): void {
    const normalized = normalizeEvent(event, targetId);
    if (!normalized) return;
    // Include protocol timestamp and context so equal messages at different times survive.
    // Remote object handles change between connections; they are not event identity.
    const fingerprint = createHash('sha256').update(JSON.stringify([targetId, event.method,
      event.params?.timestamp, event.params?.executionContextId, event.params?.exceptionDetails?.exceptionId, normalized])).digest('hex');
    if (this.fingerprints.has(fingerprint)) return;
    this.fingerprints.set(fingerprint, true);
    if (this.fingerprints.size > this.capacity * 2) this.fingerprints.delete(this.fingerprints.keys().next().value!);
    this.entries.push({ id: ++this.sequence, ...normalized });
    if (this.entries.length > this.capacity) this.entries.shift();
  }
  private matches(entry: LogEntry, query: Query): boolean {
    return (!query.levels?.length || query.levels.includes(entry.level))
      && (!query.contains || entry.message.toLowerCase().includes(query.contains.toLowerCase()));
  }
  snapshot(query: Query = {}) {
    const matches = this.entries.filter(entry => this.matches(entry, query));
    const entries = matches.slice(-(query.limit ?? 100));
    return { entries, nextCursor: this.cursor(), hasMore: false, dropped: this.sequence - this.entries.length,
      omitted: matches.length - entries.length };
  }
  since(after: number, query: Query = {}) {
    const oldest = this.entries[0]?.id ?? this.sequence + 1;
    const dropped = Math.max(0, oldest - after - 1);
    const pending = this.entries.filter(entry => entry.id > after);
    const entries: LogEntry[] = [];
    let scanned = after;
    for (const entry of pending) {
      scanned = entry.id;
      if (this.matches(entry, query)) entries.push(entry);
      if (entries.length >= (query.limit ?? 100)) break;
    }
    if (!pending.length) scanned = this.sequence;
    return { entries, nextCursor: this.cursor(scanned), hasMore: scanned < this.sequence, dropped, omitted: 0 };
  }
}
