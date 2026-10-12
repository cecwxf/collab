#!/usr/bin/env node
// Isolated Web/Desktop hosts from dsh-mcp-test-host.mjs; keys stay inside the host process.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {LanRelayServer} from '@collab/lan-relay';
const paths=process.env.DSH_RECOVERY_HOSTS?.split(',');
assert.ok(paths?.length && process.env.DSH_RECOVERY_EVIDENCE,'DSH_RECOVERY_HOSTS and DSH_RECOVERY_EVIDENCE required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=180000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(300);}throw Error('timeout: '+label);}
await until(async()=>{try{await Promise.all(paths.map(p=>readFile(p)));return true;}catch{return false;}},'host controls',60000);
const hosts=await Promise.all(paths.map(async p=>JSON.parse(await readFile(p,'utf8'))));
const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
let relay;
async function api(host,path,body){const r=await fetch(host.base+'/api/collab'+path,{method:body===undefined?'GET':'POST',headers:{cookie:host.cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.ok(r.ok,`${path}: ${r.status}: ${data.error||''}`);return data;}
try {
 const fixtures=await Promise.all(hosts.map(async h=>{
  execFileSync('git',['init','-q','-b','main'],{cwd:h.workspace});execFileSync('git',['-c','user.name=e2e','-c','user.email=e2e@local','commit','--allow-empty','-qm','fixture'],{cwd:h.workspace});
  const room=await api(h,'/rooms',{name:'Recovered collaboration '+h.host,mode:'lan',lanHostPort:'127.0.0.1:'+port,workspacePath:h.workspace});const p='/rooms/'+room.roomId;
  const view=async()=>(await api(h,'/state')).rooms.find(r=>r.roomId===room.roomId);
  await until(async()=>/WebSocket/.test((await view()).error||''),'visible initial transport failure',5000);
  const author=await api(h,p+'/agents',{name:'Author',scope:'write',reasoningEffort:'low'}),reviewer=await api(h,p+'/agents',{name:'Reviewer',scope:'read',reasoningEffort:'low'});
  await sleep(1500);const failed=await view();assert.match(failed.error,/WebSocket/,'reconnect status retains the initial error');assert.ok(failed.local.agents.every(a=>!a.online));
  return {h,p,roomId:room.roomId,author,reviewer,view,initialError:failed.error};
 }));
 relay=new LanRelayServer({host:'127.0.0.1',port,mdns:false});await relay.listen();
 const evidence=await Promise.all(fixtures.map(async f=>{
  const {h,p,author,reviewer}=f;
  await until(async()=>{const r=await f.view();return r.status==='online'&&r.local.agents.every(a=>a.online);},'automatic host and offline agent recovery',40000);
  const messages=async()=>(await api(h,p+'/messages')).messages;
  async function taskDone(task){await until(async()=> (await messages()).some(m=>m.taskId===task.taskId&&m.status==='done'),'real model task complete');await until(async()=>!(await api(h,p+'/runs')).runs.some(r=>['running','queued','approval'].includes(r.state)),'real agent idle');}
  await taskDone(await api(h,p+'/task',{title:'Write recovery proof',assignee:author.agentId,body:'Create recovery-note.md containing a Markdown heading "Recovered collaboration" and a sentence stating room connectivity recovered. Use the native file tools in your assigned worktree, do not merge. Mark this task done with a link [Recovery note](recovery-note.md), then post the link to the room using collab_send without mentions.'}));
  await taskDone(await api(h,p+'/task',{title:'Review Author recovery proof',assignee:reviewer.agentId,body:'Use collab_history to read the Author completion in this room. Post a brief review confirming that recovery-note.md was reported, then mark this task done. Do not modify files or wake other agents.'}));
  const runs=(await api(h,p+'/runs')).runs;assert.ok(!runs.some(r=>r.state==='failed'));
  const preview=await api(h,p+'/preview',{path:'recovery-note.md',agentId:author.agentId});assert.ok(preview.sessionId);
  const retry=await api(h,p+'/reconnect',{});assert.equal(retry.status,'online');
  const edited=await api(h,p+'/settings',{name:'Edited recovery '+h.host,description:'Persisted room labels',tags:['recovery','verified']});assert.equal(edited.name,'Edited recovery '+h.host);assert.deepEqual(edited.tags,['recovery','verified']);
  assert.equal((await api(h,p+'/preview',{path:'recovery-note.md',agentId:author.agentId})).sessionId,preview.sessionId);
  const vps=await api(h,'/rooms',{name:'VPS transport recovery qualification '+h.host,mode:'relay',workspacePath:h.workspace,agents:[{name:'VPS Reviewer',scope:'read',reasoningEffort:'low'}]});const vp='/rooms/'+vps.roomId;
  await until(async()=>{const r=(await api(h,'/state')).rooms.find(r=>r.roomId===vps.roomId);return r.status==='online'&&r.local.agents.every(a=>a.online);},'VPS host and agent handshake',30000);
  const marker='VPS verified '+h.host;await api(h,vp+'/send',{text:marker});assert.ok((await api(h,vp+'/messages')).messages.some(m=>m.text===marker));
  console.log(`REAL ${h.host} PASS: initial relay failure → automatic recovery → Author/Reviewer model collaboration → native file preview; VPS host/agent join and chat pass.`);
  const state=await api(h,'/state');return {host:h.host,version:state.version,model:state.defaultModel,initialError:f.initialError,automaticRecovery:true,agentsAddedOfflineRecovered:true,vpsJoinAndChat:true,room:await f.view(),messages:await messages(),runs,preview};
 }));
 for (const [i,f] of fixtures.entries()) {
  assert.equal((await api(f.h,f.p+'/delete',{})).left,true);
  assert.ok(!(await api(f.h,'/state')).rooms.some(r=>r.roomId===f.roomId));
  await access(evidence[i].preview.path);evidence[i].deletionKeepsOutput=true;
 }
 if(hosts.length>1){
  const owner=hosts[0],peer=hosts[1],shared=await api(owner,'/rooms',{name:'Deletion peer preservation',mode:'relay',workspacePath:owner.workspace});
  const id=shared.roomId;await api(peer,'/join',{invite:shared.invite,name:'Remote room survives owner removal'});
  await api(owner,'/rooms/'+id+'/delete',{});
  const remaining=(await api(peer,'/state')).rooms.find(r=>r.roomId===id);assert.equal(remaining.status,'online');
  evidence[0].remoteMemberSurvivesDeletion=true;
 }
 await writeFile(process.env.DSH_RECOVERY_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
} finally {await relay?.close();}
