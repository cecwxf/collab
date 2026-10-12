#!/usr/bin/env node
// Paid real-provider integration. Credentials are inherited via env, never written into the profile.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(repo,'packages/dsh-room/package.json'),'utf8')).version;
assert.ok(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY required');
const dir = await mkdtemp(join(tmpdir(),'collab-real-'));
const workspace = join(dir,'workspace'), home = join(dir,'dsh'), patch=join(dir,'patch.yml');
const env = {...process.env,DSH_HOME:home,DSH_ROOM_MOCK_AGENTS:'0',DSH_ROOM_DEBUG_LOG:join(dir,'bridge.log')};
const desktopApp = process.env.DSH_DESKTOP_APP ? resolve(process.env.DSH_DESKTOP_APP) : null;
const desktopExe = desktopApp?.endsWith('.app') ? join(desktopApp,'Contents/MacOS/DeepSeek Harness') : desktopApp;
const desktopResources = desktopApp?.endsWith('.app') ? join(desktopApp,'Contents/Resources') : desktopApp ? join(dirname(desktopApp),'resources') : null;
const profilePatch = join(home,'profiles/desktop/cordis.patch.yml');
const provider = process.env.DSH_TEST_PROVIDER || 'deepseek-official';
const model = process.env.DSH_TEST_MODEL || 'deepseek-flash';
let child,base,cookie,url;
const controlFile = process.env.DSH_REAL_CONTROL || join(repo, "../work/real-control.json");
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await pause(500);}throw Error(`timeout: ${label}`);}
async function api(path,body,remote){const h=remote||{base,cookie};const r=await fetch(h.base+'/api/collab'+path,{method:body===undefined?'GET':'POST',headers:{cookie:h.cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();assert.ok(r.ok,`${path}: ${r.status} ${v.error||''}`);return v;}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(r=>{const t=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(t);r();});child.kill('SIGTERM');});}
async function boot() {
  child=desktopExe ? spawn(desktopExe,['--user-data-dir='+join(dir,'electron')],{cwd:repo,env,stdio:['ignore','pipe','pipe']}) : spawn('dsh',['web','--patch',patch,'--no-open','--host','127.0.0.1','--port','0'],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
  url=await new Promise((res,rej)=>{let s='';const timer=setTimeout(()=>rej(Error('startup timeout')),60000);child.on('exit',c=>{clearTimeout(timer);rej(Error('startup exit '+c));});child.stdout.on('data',d=>{s+=d;const m=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(s);if(m){clearTimeout(timer);res(m[1]);}});child.stderr.on('data',()=>{});});
  base=new URL(url).origin;const auth=await fetch(url,{redirect:'manual'});cookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
}
try {
  await mkdir(workspace);execFileSync('git',['init','-q','-b','main'],{cwd:workspace});
  await writeFile(join(workspace,'README.md'),'Real dsh agent collaboration fixture\n');
  execFileSync('git',['add','.'],{cwd:workspace});execFileSync('git',['-c','user.name=e2e','-c','user.email=e2e@local','commit','-qm','fixture'],{cwd:workspace});
  await writeFile(patch,`- id: agent-default-model\n  config:\n    provider: ${provider}\n    model: ${model}\n    reasoningEffort: low\n- id: collab\n  config:\n    statePath: ${JSON.stringify(join(dir,'collab/state.json'))}\n    identityPath: ${JSON.stringify(join(dir,'collab/identity.json'))}\n    workspacePath: ${JSON.stringify(workspace)}\n    agentName: real-mac\n    relayUrl: ${process.env.DSH_TEST_RELAY || "ws://62.234.113.56:80"}\n    autoReply: off\n    localAgentRunner: dsh\n`);
  const source = process.env.DSH_PLUGIN_SOURCE || join(repo,'packages/dsh-room');
  if (desktopExe) {
    await mkdir(dirname(profilePatch),{recursive:true});
    await writeFile(profilePatch,'- id: webserver\n  config: { host: 127.0.0.1, port: 0 }\n');
    // Only Desktop initializes its executable profile; use its bundled CLI while it is quit.
    await boot(); await stop();
    execFileSync(desktopExe,['--expose-internals',join(desktopResources,'app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'plugin','--profile','desktop','add',source],{cwd:repo,env:{...env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe'});
    const overlay=await readFile(patch,'utf8');
    // Exercise Desktop's default per-profile identity/state rather than explicit overrides.
    await writeFile(profilePatch,'- id: webserver\n  config: { host: 127.0.0.1, port: 0 }\n'+overlay.split('\n').filter(l=>!/^    (statePath|identityPath):/.test(l)).join('\n'));
  } else execFileSync('dsh',['plugin','--profile','web','add',source],{cwd:repo,env,stdio:'pipe'});
  await boot();
  await until(async()=> (await api('/version')).version===version,'plugin ready',30000);
  if(desktopExe) {
    const dataRoot=join(home,'profiles/desktop/.collab');
    assert.ok(JSON.parse(await readFile(join(dataRoot,'identity.json'),'utf8')).agentId,'Desktop owns its default identity');
    assert.ok(JSON.parse(await readFile(join(dataRoot,'state.json'),'utf8')),'Desktop owns its default room state');
  }
  const state=await api('/state');assert.equal(state.defaultModel.model,model);assert.match(state.defaultModel.name,/DeepSeek/i);assert.ok(state.models.length);
  await writeFile(controlFile,JSON.stringify({base,cookie,url,dir}),{mode:0o600});
  console.log('REAL model:',state.defaultModel.name,`(${provider}/${model})`);
  const room=await api('/rooms',{name:'Real collaboration validation',workspacePath:workspace,localOnly:!process.env.DSH_REAL_RELAY,agents:[],mode:'relay',isolation:'auto',turnLimit:16,concurrency:2});
  const p='/rooms/'+encodeURIComponent(room.roomId), view=async()=>(await api('/state')).rooms.find(r=>r.roomId===room.roomId);
  const coder=await api(p+'/agents',{name:'Coder',scope:'write',reasoningEffort:'low',systemPrompt:'Be concise. For coding tasks write the requested file using the native file tools. Do not modify other files. Always claim and finish tasks using collab tools.'});
  const reviewer=await api(p+'/agents',{name:'Reviewer',scope:'read',reasoningEffort:'low',systemPrompt:'Review only; use native read tools when asked to inspect a file. Reply using collab_send with no mentions.'});
  const moderator=await api(p+'/agents',{name:'Moderator',moderator:true,scope:'read',reasoningEffort:'low'});
  await api(p+'/agents/'+reviewer.agentId,{name:'Reviewer',model,provider});
  const removed=await api(p+'/agents',{name:'Disposable'});await api(p+'/agents/'+removed.agentId+'?op=delete',{});
  await until(async()=> !(await view()).members.some(m=>m.agentId===removed.agentId),'removed agent absent',30000);
  await until(async()=> (await view()).local.agents.length===3 && (await view()).local.agents.every(a=>a.online),'agents joined',30000);
  const messages=async()=>(await api(p+'/messages')).messages;
  async function idle(){await until(async()=>{const runs=(await api(p+'/runs')).runs;assert.ok(!runs.some(r=>r.state==='failed'),JSON.stringify(runs.filter(r=>r.state==='failed')));return !runs.some(r=>['running','queued','approval'].includes(r.state));},'real runs complete');}
  const task=await api(p+'/task',{title:'Implement sum.mjs',assignee:coder.agentId,body:'Write exactly one file sum.mjs exporting function sum(a,b) that returns a+b, as ES module. No dependencies. Then mark this task done with collab_update_task.'});
  await until(async()=> (await messages()).some(m=>m.kind==='task.update' && m.taskId===task.taskId && m.status==='done'),'coder task done');
  await idle();
  const diffs=await api(p+'/diffs');assert.ok(diffs.agents.find(a=>a.agentId===coder.agentId).files.some(f=>f.path==='sum.mjs'));
  assert.equal((await api(p+'/merge',{agentId:coder.agentId,approve:true})).merged,true);
  const {sum}=await import(pathToFileURL(join(workspace,'sum.mjs')));assert.equal(sum(2,3),5);assert.equal(sum(-7,4),-3);
  await api(p+'/send',{text:`@${reviewer.agentId} First call collab_history and collab_peers; verify both tools return successfully without invalid-output errors. Then read sum.mjs in this workspace, check sum(2,3)=5 and sum(-7,4)=-3, and report REAL_REVIEW_PASS REAL_HISTORY_PASS via collab_send only if the code and both tools succeeded.`});
  await until(async()=> (await messages()).some(m=>m.from===reviewer.agentId && m.text.includes('REAL_REVIEW_PASS') && m.text.includes('REAL_HISTORY_PASS')),'real review');await idle();
  await api(p+'/send',{text:`@${moderator.agentId} Coordinate a tiny status check: assign Coder and Reviewer each a task to report COLLAB_STATUS_OK only, no file changes. Then summarize their completed tasks via collab_send.`});
  await until(async()=>{const ms=await messages();return ms.filter(m=>m.kind==='task.create'&&m.from===moderator.agentId).length>=2 && ms.filter(m=>m.kind==='task.update'&&m.status==='done').length>=3 && ms.filter(m=>m.from===moderator.agentId&&m.kind==='chat').length>=2;},'moderator worker coordination');await idle();
  const final=await view();assert.ok(final.local.agents.every(a=>a.sessionId),'every agent has a real dsh session');assert.ok(!(await messages()).some(m=>/\[mock /.test(m.text)));
  const evidence={version,host:desktopExe?'desktop':'web',model:state.defaultModel,agents:final.local.agents.map(a=>({name:a.name,sessionId:a.sessionId,model:a.resolvedModel})),runs:(await api(p+'/runs')).runs,messages:await messages()};
  await writeFile(process.env.DSH_REAL_EVIDENCE||join(repo,'../work/real-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
  console.log((desktopExe?'DSH DESKTOP':'DSH WEB')+' REAL E2E PASS: create/edit/remove agents; coding task claim/done; worktree diff/merge; executable sum; real reviewer; moderator/worker collaboration; real session ids; zero mock output');
  if(process.env.DSH_REAL_KEEP){await writeFile(controlFile,JSON.stringify({base,cookie,url,dir,roomId:room.roomId,invite:room.invite}),{mode:0o600});console.log('Holding isolated real host for UI/cross-host validation');await new Promise(r=>{const done=()=>{process.off('SIGTERM',done);child.off('exit',done);r();};process.once('SIGTERM',done);child.once('exit',done);});}
} catch(e){console.error(e.message);try {const log=await readFile(join(dir,'bridge.log'),'utf8');console.error(log.split('\n').filter(l=>!l.includes('  ev ')).slice(-20).join('\n').replaceAll(process.env.DEEPSEEK_API_KEY,'<redacted>'));}catch{}process.exitCode=1;} finally {await stop();if(!process.env.DSH_REAL_KEEP)await rm(dir,{recursive:true,force:true});}
