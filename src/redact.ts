export function redact(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/((?:access_token|refresh_token|authorization|password|serviceToken|wsToken|token)\s*["']?\s*[=:]\s*["']?)([^\s&",;}]+)/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}
