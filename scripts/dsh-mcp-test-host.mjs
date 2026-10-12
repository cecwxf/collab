#!/usr/bin/env node
// Isolated real Web/Desktop host for cross-machine MCP testing. Key is inherited, never saved.
import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
assert.ok(process.env.DEEPSEEK_API_KEY,'DEEPSEEK_API_KEY required');
assert.ok(process.env.DSH_MCP_CONTROL && process.env.DSH_PLUGIN_SOURCE,'DSH_MCP_CONTROL and DSH_PLUGIN_SOURCE required');
const dir=await mkdtemp(join(process.env.DSH_TEST_TMPDIR||tmpdir(),'collab-mcp-host-'));
const home=join(dir,'dsh'),workspace=join(dir,'workspace'),patch=join(dir,'patch.yml');
const app=process.env.DSH_DESKTOP_APP;
const exe=app?.endsWith('.app')?join(app,'Contents/MacOS/DeepSeek Harness'):app;
const resources=app?.endsWith('.app')?join(app,'Contents/Resources'):app?join(dirname(app),'resources'):null;
const env={...process.env,DSH_HOME:home,DSH_ROOM_MOCK_AGENTS:'0',DSH_ROOM_DEBUG_LOG:join(dir,'bridge.log')};
delete env.ELECTRON_RUN_AS_NODE;
let child,control;
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(r=>{const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);r();});child.kill('SIGTERM');});}
async function boot(){
  child=exe?spawn(exe,['--user-data-dir='+join(dir,'electron')],{env,stdio:['ignore','pipe','pipe']}):spawn('dsh',['web','--patch',patch,'--no-open','--host','127.0.0.1','--port',process.env.DSH_TEST_PORT||'0'],{env,stdio:['ignore','pipe','pipe']});
  const url=await new Promise((res,rej)=>{let s='';const timer=setTimeout(()=>rej(Error('startup timeout')),60000);child.once('exit',c=>{clearTimeout(timer);rej(Error('startup exit '+c));});child.stdout.on('data',d=>{s+=d;const m=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(s);if(m){clearTimeout(timer);res(m[1]);}});child.stderr.on('data',()=>{});});
  const auth=await fetch(url,{redirect:'manual'});
  control={base:new URL(url).origin,url,cookie:auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),dir,home,workspace,host:exe?'desktop':'web',pid:process.pid};
}
try {
  await mkdir(workspace);
  await writeFile(patch,`- id: agent-default-model\n  config: { provider: deepseek-official, model: deepseek-flash, reasoningEffort: low }\n- id: collab\n  config:\n    workspacePath: ${JSON.stringify(workspace)}\n    agentName: ${process.env.DSH_TEST_NAME||'mcp-mac'}\n    relayUrl: ${process.env.DSH_TEST_RELAY||'ws://127.0.0.1:38180'}\n    autoReply: off\n    localAgentRunner: dsh\n`);
  if(exe){
    const profilePatch=join(home,'profiles/desktop/cordis.patch.yml');await mkdir(dirname(profilePatch),{recursive:true});
    await writeFile(profilePatch,'- id: webserver\n  config: { host: 127.0.0.1, port: 0 }\n');
    await boot();await stop();
    execFileSync(exe,['--expose-internals',join(resources,'app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'plugin','--profile','desktop','add',resolve(process.env.DSH_PLUGIN_SOURCE)],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe'});
    await writeFile(profilePatch,'- id: webserver\n  config: { host: 127.0.0.1, port: 0 }\n'+await readFile(patch,'utf8'));
  }else{
    // Explicit paths isolate Web's legacy ~/.collab defaults in this disposable host.
    await writeFile(patch,(await readFile(patch,'utf8'))+`    statePath: ${JSON.stringify(join(dir,'collab/state.json'))}\n    identityPath: ${JSON.stringify(join(dir,'collab/identity.json'))}\n`);
    execFileSync('dsh',['plugin','--profile','web','add',resolve(process.env.DSH_PLUGIN_SOURCE)],{env,stdio:'pipe'});
  }
  await boot();
  const r=await fetch(control.base+'/api/collab/state',{headers:{cookie:control.cookie}});assert.ok(r.ok);const state=await r.json();
  assert.equal(state.defaultModel.model,'deepseek-flash');control.version=state.version;control.model=state.defaultModel;
  await writeFile(process.env.DSH_MCP_CONTROL,JSON.stringify(control),{mode:0o600});
  console.log(`MCP ${control.host} host ready: ${state.version} ${state.defaultModel.name}`);
  await new Promise(r=>{process.once('SIGTERM',r);process.once('SIGINT',r);child.once('exit',r);});
} finally {await stop();await rm(dir,{recursive:true,force:true});await rm(process.env.DSH_MCP_CONTROL,{force:true});}
