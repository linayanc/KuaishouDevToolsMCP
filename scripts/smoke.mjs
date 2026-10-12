import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const projectPath = process.argv[2];
if (!projectPath || !path.isAbsolute(projectPath)) {
  console.error('Usage: npm run smoke -- <absolute-export-path> [--preview | --debug] [--runtime=ws://127.0.0.1:<port>]');
  process.exit(1);
}
const client = new Client({name:'kuaishou-live-smoke',version:'0.1.0'});
const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/index.js',import.meta.url))]});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length,7);
  const call = async (name,args={}) => {
    const result = await client.callTool({name,arguments:args},undefined,{timeout:150000});
    console.log(JSON.stringify({tool:name,isError:!!result.isError,result:result.structuredContent}));
    assert.ok(!result.isError,`${name} failed`);
    return result;
  };
  await call('kuaishou_open_project',{projectPath});
  if (process.argv.includes('--preview')) await call('kuaishou_preview');
  if (process.argv.includes('--debug')) await call('kuaishou_start_debug');
  const runtime = process.argv.find(x=>x.startsWith('--runtime='))?.slice(10);
  if (runtime) {
    await call('kuaishou_connect_runtime',{projectPath,webSocketUrl:runtime});
    await call('kuaishou_get_logs',{limit:20});
    await call('kuaishou_get_errors',{limit:20});
    await call('kuaishou_watch_logs',{waitMs:5000,limit:20});
  }
} finally { await client.close(); }
