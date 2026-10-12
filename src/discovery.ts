import { localUrl } from './config.js';
import { ToolError } from './errors.js';
export interface Target { id: string; type: string; title?: string; url: string; webSocketDebuggerUrl?: string }
export async function listTargets(endpoint: string): Promise<Target[]> {
  const response = await fetch(new URL('/json/list', localUrl(endpoint, ['http:'])), { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new ToolError('CDP_UNAVAILABLE', `Debugging endpoint returned HTTP ${response.status}.`);
  const reader = response.body?.getReader();
  if (!reader) throw new ToolError('CDP_INVALID', 'Empty target response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new ToolError('CDP_INVALID', 'Target response exceeds 2 MiB.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(data)) throw new ToolError('CDP_INVALID', 'Expected a CDP target list.');
  return data.filter((t): t is Target => t && typeof t.id === 'string' && typeof t.type === 'string' && typeof t.url === 'string');
}
export function isIdePage(target: Target, page: 'project' | 'project-list'): boolean {
  try {
    const url = new URL(target.url);
    return target.type === 'page' && url.protocol === 'file:' && !!target.webSocketDebuggerUrl
      && decodeURIComponent(url.pathname).replaceAll('\\', '/').includes('/kuaishou-minigame-devtools/')
      && url.pathname.endsWith(`/dist/renderer/${page}.html`);
  } catch { return false; }
}
export function selectIdePage(targets: Target[], page: 'project' | 'project-list', projectId?: string): Target {
  const matches = targets.filter(t => isIdePage(t, page) && (!projectId || new URL(t.url).searchParams.get('projectId') === projectId));
  if (matches.length !== 1) throw new ToolError(matches.length ? 'IDE_AMBIGUOUS' : 'IDE_NOT_FOUND',
    `Expected one Kuaishou ${page} window; found ${matches.length}.`, 'Start one IDE instance with --remote-debugging-port=9223 and complete login.');
  return matches[0]!;
}
