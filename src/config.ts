import path from 'node:path';
import { ToolError } from './errors.js';
export interface Config { endpoint: string; allowedRoots: string[]; capacity: number }
export function loadConfig(env = process.env): Config {
  let roots: unknown;
  try { roots = JSON.parse(env.KUAISHOU_ALLOWED_ROOTS ?? '[]'); }
  catch { throw new ToolError('CONFIG_INVALID', 'KUAISHOU_ALLOWED_ROOTS must be a JSON array.'); }
  if (!Array.isArray(roots) || !roots.every(r => typeof r === 'string' && path.isAbsolute(r))) {
    throw new ToolError('CONFIG_INVALID', 'KUAISHOU_ALLOWED_ROOTS must contain absolute paths.');
  }
  const capacity = Number(env.KUAISHOU_LOG_CAPACITY ?? 2000);
  if (!Number.isInteger(capacity) || capacity < 10 || capacity > 10000) {
    throw new ToolError('CONFIG_INVALID', 'KUAISHOU_LOG_CAPACITY must be an integer from 10 to 10000.');
  }
  const endpoint = env.KUAISHOU_CDP_ENDPOINT ?? 'http://127.0.0.1:9223';
  localUrl(endpoint, ['http:']);
  return { endpoint, allowedRoots: roots, capacity };
}
export function localUrl(value: string, protocols: string[]): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ToolError('ENDPOINT_INVALID', 'Invalid local debugging URL.'); }
  if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.hash) {
    throw new ToolError('ENDPOINT_INVALID', 'Only loopback debugging endpoints without credentials or fragments are supported.');
  }
  return url;
}
