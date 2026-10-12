import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateProject } from '../src/project.js';
import { selectIdePage, type Target } from '../src/discovery.js';
import { loadConfig, localUrl } from '../src/config.js';
test('rejects remote endpoints, credentials, malformed roots and unbounded retention',()=>{
  for(const url of ['http://example.com','http://127.0.0.1.evil.test','http://user:pw@localhost:1','file:///tmp/x','http://localhost:1/#x']) assert.throws(()=>localUrl(url,['http:']));
  assert.equal(localUrl('http://[::1]:9000',['http:']).port,'9000');
  assert.throws(()=>loadConfig({KUAISHOU_LOG_CAPACITY:'NaN'}));
  assert.throws(()=>loadConfig({KUAISHOU_ALLOWED_ROOTS:'["relative"]'}));
});
test('only recognizes Kuaishou IDE pages and refuses ambiguous windows',()=>{
  const p:Target={id:'p',type:'page',url:'file:///ide/kuaishou-minigame-devtools/resources/app.asar/dist/renderer/project.html?projectId=1',webSocketDebuggerUrl:'ws://127.0.0.1:9223/p'};
  assert.equal(selectIdePage([p,{...p,id:'q',url:p.url.replace('projectId=1','projectId=2')}],'project','1').id,'p');
  assert.throws(()=>selectIdePage([{...p,url:p.url.replace('file:','https:')}],'project','1'));
  assert.throws(()=>selectIdePage([p,{...p,id:'duplicate'}],'project','1'));
  assert.throws(()=>selectIdePage([{...p,url:p.url.replace('kuaishou-minigame-devtools','other-ide')}],'project','1'));
});
test('export validation resolves junctions and requires a game entry and valid config',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'kuaishou-project-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const allowed=path.join(dir,'allowed'),outside=path.join(dir,'outside');await mkdir(allowed);await mkdir(outside);
  await writeFile(path.join(outside,'project.config.json'),'{}');await writeFile(path.join(outside,'game.js'),'');
  await assert.rejects(validateProject(outside,[allowed]),/outside/);
  await symlink(outside,path.join(allowed,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(validateProject(path.join(allowed,'link'),[allowed]),/outside/);
  await writeFile(path.join(allowed,'project.config.json'),'{ invalid');
  await assert.rejects(validateProject(allowed,[]),/project.config.json/);
  await writeFile(path.join(allowed,'project.config.json'),'{}');
  await assert.rejects(validateProject(allowed,[]),/game.js/);
  await writeFile(path.join(allowed,'game.js'),'');assert.ok(await validateProject(allowed,[allowed]));
});
