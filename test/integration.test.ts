import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, realpath, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { KuaishouService } from '../src/service.js';
import { loadConfig } from '../src/config.js';

const event = (text: string, timestamp: number, type = 'log') => ({ method: 'Runtime.consoleAPICalled', params: {
  type, timestamp, args: [{ type: 'string', value: text }],
} });
async function fixture(t: { after: (fn: () => unknown) => void }) {
  const project = await realpath(await mkdtemp(path.join(tmpdir(), 'kuaishou integration & 中文 ')));
  await writeFile(path.join(project, 'project.config.json'), JSON.stringify({appid:'kwai_game_test_appid',projectname:'demo',engine_type:'frog'}));
  await writeFile(path.join(project,'game.js'),'console.log("test")');
  let registered = true;
  let opened = false;
  let code = 'SUCCESS';
  let mismatch = false;
  let missingScheme = false;
  let runtimeConnections = 0;
  const calls: string[] = [];
  const history = [event('ready',1000),event('warning',2000,'warning'),event('broken',3000,'error'), {
    method:'Runtime.exceptionThrown',params:{timestamp:4000,exceptionDetails:{text:'Uncaught',exception:{description:'Error: boom'}}},
  }];
  const http = createServer((_req,res) => {
    const base = 'file:///ide/kuaishou-minigame-devtools/resources/app.asar/dist/renderer/';
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify([
      {id:'list',type:'page',url:base+'project-list.html',webSocketDebuggerUrl:endpoint.replace('http:','ws:')+'/list'},
      ...(opened ? [{id:'project',type:'page',url:base+'project.html?projectId=p1',webSocketDebuggerUrl:endpoint.replace('http:','ws:')+'/project'}] : []),
      {id:'unrelated',type:'page',url:'https://example.com',webSocketDebuggerUrl:endpoint.replace('http:','ws:')+'/wrong'},
    ]));
  });
  const wss = new WebSocketServer({server:http});
  wss.on('connection',(ws,req) => {
    if(req.url==='/runtime') runtimeConnections++;
    ws.on('message',bytes => {
      const command = JSON.parse(bytes.toString());
      if(req.url==='/runtime') {
        assert.equal(command.method,'Runtime.enable');
        for(const item of history) ws.send(JSON.stringify(item));
        ws.send(JSON.stringify({id:command.id,result:{}}));
        return;
      }
      assert.ok(req.url==='/list'||req.url==='/project');
      assert.equal(command.method,'Runtime.evaluate');
      assert.equal(command.params.awaitPromise,true);
      const e = command.params.expression;
      calls.push(e);
      let value: any;
      if(e.includes('getProjectList()')) value=registered?[{id:'p1',path:project,name:'demo'}]:[];
      else if(e.includes('.createProject(')) {registered=true;opened=true;value={result:code};}
      else if(e.includes('.openProject(')) {opened=true;value={result:code};}
      else if(e.includes('.getProjectInfo(')) value={id:'p1',path:mismatch?path.join(project,'wrong'):project};
      else if(e.includes('.phonePreviewProject(')||e.includes('.phoneInspectProject(')) {
        const debug=e.includes('.phoneInspectProject(');
        const args=JSON.parse(e.slice(e.indexOf('(')+1,-1));
        assert.deepEqual(args,{id:'p1',projectPath:project,action:debug?'PHONE_INSPECT':'PHONE_PREVIEW'});
        value={result:code,errorMessage:'token=secret',phonePreviewData:{scheme:missingScheme?undefined:'kwai://test-preview',packageType:'MAIN_PACKAGE'}};
      } else assert.fail('Unexpected expression '+e);
      ws.send(JSON.stringify({id:command.id,result:{result:{type:'object',value}}}));
    });
  });
  await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
  const address=http.address();
  if(!address||typeof address==='string')throw new Error('No address');
  const endpoint=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{
    for(const ws of wss.clients)ws.terminate();
    await new Promise<void>(resolve=>wss.close(()=>resolve()));
    await new Promise<void>(resolve=>http.close(()=>resolve()));
    await rm(project,{recursive:true,force:true});
  });
  return {project,endpoint,calls,wss,runtimeUrl:endpoint.replace('http:','ws:')+'/runtime',
    connections:()=>runtimeConnections,setRegistered:(v:boolean)=>{registered=v;opened=false;},setCode:(v:string)=>{code=v;},
    setMismatch:(v:boolean)=>{mismatch=v;},setMissingScheme:(v:boolean)=>{missingScheme=v;},
    broadcast(item:ReturnType<typeof event>){history.push(item);for(const ws of wss.clients)ws.send(JSON.stringify(item));}
  };
}
test('IDE open is distinct from game capture; explicit binding, pagination, gaps, cancellation and session resets',async t=>{
  const f=await fixture(t);
  const service=new KuaishouService({...loadConfig({}),endpoint:f.endpoint});
  t.after(()=>service.close());
  await assert.rejects(service.read(),/kuaishou_open_project/);
  const opened=await service.openProject(f.project);
  assert.equal(opened.connection.state,'disconnected');
  await assert.rejects(service.read(),/kuaishou_connect_runtime/);
  await assert.rejects(service.connectRuntime(f.project,'ws://127.0.0.1:9223/devtools/page/editor'),(e:any)=>e.code==='RUNTIME_INVALID');
  await assert.rejects(service.connectRuntime(f.project,'ws://example.com/runtime'),(e:any)=>e.code==='ENDPOINT_INVALID');
  await service.connectRuntime(f.project,f.runtimeUrl);
  const errors=await service.read({},true);
  assert.deepEqual(errors.entries.map(e=>e.level),['error','exception']);
  const cursor=errors.nextCursor;
  assert.equal((await service.watch()).entries.length,0);
  const pending=service.watch({waitMs:1000});
  setTimeout(()=>f.broadcast(event('new log',5000)),50);
  assert.equal((await pending).entries[0]?.message,'new log');
  assert.equal((await service.watch({cursor})).entries[0]?.message,'new log');
  assert.equal((await service.watch({cursor})).entries[0]?.message,'new log');
  assert.equal((await service.watch()).entries.length,0);
  for(const ws of f.wss.clients)ws.terminate();
  await delay(50);
  const reconnected=await service.read();
  assert.equal(reconnected.connection.state,'connected');
  assert.equal(reconnected.connection.possibleGapCount,1);
  assert.equal(f.connections(),2);
  assert.equal(reconnected.entries.length,5);
  const controller=new AbortController();
  const wait=service.watch({waitMs:1000,contains:'never'},controller.signal);controller.abort();
  await assert.rejects(wait,/abort/i);
  await service.openProject(f.project);
  await service.connectRuntime(f.project,f.runtimeUrl);
  await assert.rejects(service.watch({cursor}),/another project/);
});
test('import is opt-in and existing windows are reused; preview errors, path ownership and missing scheme fail honestly',async t=>{
  const f=await fixture(t);
  const service=new KuaishouService({...loadConfig({}),endpoint:f.endpoint});t.after(()=>service.close());
  f.setRegistered(false);
  await assert.rejects(service.openProject(f.project),(e:any)=>e.code==='PROJECT_NOT_IMPORTED');
  await service.openProject(f.project,true);
  assert.ok(f.calls.some(e=>e.includes('.createProject(')));
  const opens=f.calls.filter(e=>e.includes('.openProject(')).length;
  await service.openProject(f.project);
  assert.equal(f.calls.filter(e=>e.includes('.openProject(')).length,opens);
  for(const debug of [false,true]) {
    const qr=await service.preview(undefined,debug);
    t.after(()=>rm(path.dirname(qr.qrCodePath),{recursive:true,force:true}));
    assert.ok((await readFile(qr.qrCodePath)).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.equal(qr.action,debug?'PHONE_INSPECT':'PHONE_PREVIEW');
    assert.ok(!qr.qrCodePath.startsWith(f.project));
  }
  f.setCode('NOT_LOGIN');
  await assert.rejects(service.preview(),(e:any)=>e.code==='IDE_OPERATION_FAILED'&&!e.message.includes('secret'));
  f.setCode('SUCCESS');f.setMissingScheme(true);
  await assert.rejects(service.preview(),(e:any)=>e.code==='PREVIEW_OUTPUT_MISSING');
  f.setMismatch(true);
  await assert.rejects(service.preview(),(e:any)=>e.code==='PROJECT_MISMATCH');
});
test('stdio MCP handshake exposes seven tools, validates parameters, returns real schema results and QR content',async t=>{
  const f=await fixture(t);
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx',path.resolve('src/index.ts')],
    env:{...process.env,KUAISHOU_CDP_ENDPOINT:f.endpoint} as Record<string,string>,stderr:'pipe'});
  const client=new Client({name:'integration-test',version:'1.0.0'});t.after(()=>client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name),[
    'kuaishou_open_project','kuaishou_connect_runtime','kuaishou_get_logs','kuaishou_get_errors','kuaishou_watch_logs','kuaishou_preview','kuaishou_start_debug']);
  const call=(name:string,args:Record<string,unknown>={})=>client.callTool({name,arguments:args});
  assert.equal((await call('kuaishou_get_logs')).isError,true);
  assert.ok(!(await call('kuaishou_open_project',{projectPath:f.project})).isError);
  assert.equal((await call('kuaishou_get_logs')).isError,true);
  assert.ok(!(await call('kuaishou_connect_runtime',{projectPath:f.project,webSocketUrl:f.runtimeUrl})).isError);
  assert.equal(((await call('kuaishou_get_logs')).structuredContent as any).entries.length,4);
  assert.equal(((await call('kuaishou_get_errors')).structuredContent as any).entries.length,2);
  assert.equal((await call('kuaishou_get_logs',{limit:0})).isError,true);
  const qr=await call('kuaishou_preview');
  assert.ok((qr.content as any[]).some(c=>c.type==='image'&&c.mimeType==='image/png'));
  t.after(()=>rm(path.dirname((qr.structuredContent as any).qrCodePath),{recursive:true,force:true}));
});
