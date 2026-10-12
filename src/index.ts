#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { isIdePage, listTargets } from './discovery.js';
import { errorMessage } from './errors.js';
import { redact } from './redact.js';
import { createServer, VERSION } from './server.js';
import { KuaishouService } from './service.js';

async function main() {
  if (process.argv.includes('--version')) { console.log(VERSION); return; }
  if (process.argv.includes('--help')) {
    console.log(`kuaishou-devtools-mcp ${VERSION}\n\nUsage: node dist/index.js [--doctor | --version | --help]\nDefault: MCP server over stdio.\n\nEnvironment:\n  KUAISHOU_CDP_ENDPOINT   IDE http endpoint (default http://127.0.0.1:9223)\n  KUAISHOU_ALLOWED_ROOTS  JSON array of allowed absolute export directories\n  KUAISHOU_LOG_CAPACITY   Retained entries (10–10000; default 2000)\n\nStart one IDE with --remote-debugging-port=9223 and complete login.\nIDE 2.0.6 uses phone debugging; bind its local device proxy to read game logs.\n`);
    return;
  }
  const config = loadConfig();
  if (process.argv.includes('--doctor')) {
    try {
      const targets = await listTargets(config.endpoint);
      const projectList = targets.filter(t => isIdePage(t, 'project-list'));
      const projects = targets.filter(t => isIdePage(t, 'project'));
      const deviceProxies = targets.flatMap(t => {
        try {
          const url = new URL(t.url);
          if (url.protocol !== 'file:' || !decodeURIComponent(url.pathname).includes('/kuaishou-minigame-devtools/') || !url.pathname.endsWith('/inspector.html')) return [];
          const ws = new URL(`ws://${url.searchParams.get('ws')}`);
          if (!ws.port || ws.username || ws.password || ws.pathname !== '/' || ws.search || ws.hash) return [];
          return [{webSocketUrl: `ws://127.0.0.1:${ws.port}/`, projectOwnership: 'unverified; caller must verify'}];
        } catch { return []; }
      });
      const ok = projectList.length === 1;
      console.log(JSON.stringify({ok,node:process.version,platform:process.platform,endpoint:config.endpoint,
        projectListWindows:projectList.length,projectWindows:projects.length,deviceProxies,
        note:'IDE availability only; device connectivity and project ownership are not verified.'},null,2));
      if (!ok) process.exitCode = 1;
    } catch (error) { console.log(JSON.stringify({ok:false,error:redact(errorMessage(error))})); process.exitCode = 1; }
    return;
  }
  if (process.argv.length > 2) throw new Error('Unknown arguments. Use --help.');
  const service = new KuaishouService(config);
  const handle = serveStdio(() => createServer(service), { onerror: error => console.error(redact(errorMessage(error))) });
  const close = () => { service.close(); void handle.close(); };
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
main().catch(error => { console.error(redact(errorMessage(error))); process.exitCode = 1; });
