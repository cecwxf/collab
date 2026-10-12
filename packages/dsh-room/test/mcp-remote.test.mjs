import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CollabBridge, normalizeConfig } from '../dist/index.js';
import { LanRelayServer } from '@collab/lan-relay';
import { CollabClient, WsTransport } from '@collab/sdk';
import { generateIdentity } from '@collab/protocol';

const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(f) { for (let i=0;i<200;i++) { if(await f()) return; await pause(10); } throw Error('not ready'); }
async function pair(t) {
  const dir=await mkdtemp(join(tmpdir(),'collab-remote-mcp-'));
  const server=new LanRelayServer({port:0,host:'127.0.0.1',mdns:false});
  const {port}=await server.listen();
  const bridges=[];
  t.after(async()=>{await Promise.all(bridges.map(b=>b.dispose()));await server.close();await rm(dir,{recursive:true,force:true});});
  for(const name of ['caller','exporter']) {
    const root=join(dir,name);await mkdir(root);
    const b=new CollabBridge({get:()=>undefined,logger:{info(){},warn(){},error(){}},effect(){},tools:{register:()=>()=>{}}},normalizeConfig({agentName:name,workspacePath:root,statePath:join(root,'state.json'),identityPath:join(root,'identity.json'),localAgentRunner:'mock',autoReply:'off',relayUrl:`ws://127.0.0.1:${port}`}));
    await b.start();bridges.push(b);
  }
  const [a,b]=bridges;
  await writeFile(join(dir,'exporter','hello.txt'),'remote-only-随机内容');
  const room=await b.createRoom({mode:'lan',lanHostPort:`127.0.0.1:${port}`});
  await a.joinInvite(room.invite);
  await until(()=>a.room(room.roomId).client?.isJoined()&&b.room(room.roomId).client?.isJoined()&&a.room(room.roomId).client.getPeers().some(p=>p.agentId===b.identity.agentId));
  return {a,b,id:room.roomId,target:b.identity.agentId,root:join(dir,'exporter'),invite:room.invite,port};
}

test('model-facing remote MCP returns actual workspace content through two authenticated relay members',async t=>{
  const {a,b,id,target}=await pair(t);
  const tool=a.tools().find(t=>t.name==='collab_mcp_call');
  assert.ok(tool,'remote MCP must be registered as a model tool');
  const reply=await tool.execute({roomId:id,target,tool:'workspace_read',args:{path:'hello.txt'}},{});
  assert.equal(reply.ok,true);assert.equal(reply.target,target);
  assert.equal(reply.result.content,'remote-only-随机内容');
  assert.equal(b.approvals.list().length,0);
  assert.doesNotThrow(()=>JSON.stringify(reply));
});

test('remote read tools correlate concurrent results, respect ACL/disabled MCP and reject traversal/symlinks',async t=>{
  const {a,b,id,target,root}=await pair(t);
  const {symlink}=await import('node:fs/promises');
  const read=args=>a.mcpCallPeer(id,target,'workspace_read',args);
  await writeFile(join(root,'second.txt'),'second response');
  const [first,second,list,stat,search]=await Promise.all([
    read({path:'hello.txt'}),read({path:'second.txt'}),
    a.mcpCallPeer(id,target,'workspace_list',{path:'.'}),
    a.mcpCallPeer(id,target,'workspace_stat',{path:'second.txt'}),
    a.mcpCallPeer(id,target,'workspace_search',{path:'.',query:'second response'})
  ]);
  assert.notEqual(first.callId,second.callId);assert.equal(second.result.content,'second response');
  assert.ok(list.result.entries.some(e=>e.name==='hello.txt'));assert.equal(stat.result.size,15);
  assert.ok(JSON.stringify(search.result).includes('second.txt'));
  await symlink(join(root,'../caller'),join(root,'outside'));
  for(const path of ['../caller/identity.json','outside/identity.json']) {const r=await read({path});assert.equal(r.ok,false);assert.match(r.error,/escapes workspace/);}
  await writeFile(join(root,'large.txt'),'x'.repeat(256*1024+1));
  assert.match((await read({path:'large.txt'})).error,/too large/);
  await b.updateMemberConfig(id,{peerGrants:{default:{read:'deny',write:'ask',delete:'ask',exec:'ask'}}});
  assert.match((await read({path:'hello.txt'})).error,/peer grant deny/);
  await b.updateMemberConfig(id,{mcpEnabled:false});
  assert.match((await read({path:'hello.txt'})).error,/MCP disabled/);
  assert.equal(a.room(id).mcpCalls.size,0);
});

test('a model call authenticates as its calling agent and target grants apply to that exact identity',async t=>{
  const {a,b,id,target}=await pair(t);
  const agent=await a.addLocalAgent(id,{name:'Reader',scope:'read'});
  await until(()=>a.room(id).agents.get(agent.agentId)?.isJoined());
  a.room(id).meta.agentSessions={[agent.agentId]:'reader-session'};
  const exec={agent:{session:{id:'reader-session'}}};
  const call=a.tools().find(t=>t.name==='collab_mcp_call');
  await b.updateMemberConfig(id,{peerGrants:{default:{read:'deny',write:'auto',delete:'deny',exec:'deny'},byAgent:{[agent.agentId]:{read:'ask'}}}});
  const pending=call.execute({roomId:id,target,tool:'workspace_read',args:{path:'hello.txt'}},exec);
  await until(()=>b.approvals.list().length===1);
  assert.equal(b.approvals.list()[0].from,agent.agentId);
  b.approvals.decide(b.approvals.list()[0].requestId,'allow');
  assert.equal((await pending).result.content,'remote-only-随机内容');
  assert.match((await a.mcpCallPeer(id,target,'workspace_read',{path:'hello.txt'})).error,/peer grant deny/);
  await assert.rejects(call.execute({roomId:id,target,tool:'workspace_write',args:{path:'bad.txt',content:'bad'}},exec),/read-only agent/);
  // Approval rejection is returned to the model as ok:false, not an empty marker.
  const denied=call.execute({roomId:id,target,tool:'workspace_read',args:{path:'approval.txt'}},exec);
  await until(()=>b.approvals.list().length===1);b.approvals.decide(b.approvals.list()[0].requestId,'deny');
  assert.match((await denied).error,/denied: read/);
  await writeFile(join(a.config.workspacePath,'local.txt'),'own hosting member');
  assert.equal((await call.execute({roomId:id,target:a.identity.agentId,tool:'workspace_read',args:{path:'local.txt'}},exec)).result.content,'own hosting member');
});

test('forged results from another authenticated peer cannot settle a target call',async t=>{
  const {a,b,id,target,invite,port}=await pair(t);
  const parsed=CollabClient.parseInvite(invite);
  const intruder=new CollabClient({identity:await generateIdentity('other-peer'),roomId:id,roomKey:parsed.roomKeyB64,transport:new WsTransport(`ws://127.0.0.1:${port}/ws/${id}`),autoReply:'off'});
  t.after(()=>intruder.dispose());await intruder.join();
  b.handleMcpCall=async()=>{};
  const controller=new AbortController();
  const pending=a.mcpCallPeer(id,target,'workspace_read',{path:'hello.txt'},{signal:controller.signal});
  const rejected=assert.rejects(pending,/aborted/);
  await until(()=>a.room(id).mcpCalls.size===1);
  const callId=[...a.room(id).mcpCalls.keys()][0];
  await intruder.publish({kind:'mcp.result',callId,ok:true,result:{content:'forged'}});
  await pause(30);assert.equal(a.room(id).mcpCalls.size,1);
  controller.abort();await rejected;assert.equal(a.room(id).mcpCalls.size,0);
});

test('timeouts and transport changes settle outstanding calls; leaving clears target approval waits',async t=>{
  const {a,b,id,target}=await pair(t);
  await b.updateMemberConfig(id,{peerGrants:{default:{read:'ask',write:'ask',delete:'ask',exec:'ask'}}});
  await assert.rejects(a.mcpCallPeer(id,target,'workspace_read',{path:'hello.txt'},{timeoutMs:50}),/timed out/);
  await until(()=>b.approvals.list().length===0);
  assert.equal(a.room(id).mcpCalls.size,0);
  const read=()=>a.mcpCallPeer(id,target,'workspace_read',{path:'hello.txt'});
  const pending=read();const rejected=assert.rejects(pending,/transport changed/);
  await until(()=>b.approvals.list().length===1);
  await a.setTransport(id,'local',true);await rejected;
  await b.leave(id);assert.equal(b.approvals.list().length,0);
  await assert.rejects(a.mcpCallPeer(id,'not-online','workspace_read',{}),/not online/);
  await assert.rejects(a.mcpCallPeer(id,target,'unknown',{}),/unknown MCP tool/);
  await assert.rejects(a.mcpCallPeer(id,target,'workspace_read',[],{}),/args must be an object/);
});

test('stopping/removing the calling agent and unloading the plugin release all result waiters',async t=>{
  const {a,b,id,target}=await pair(t);
  b.handleMcpCall=async()=>{};
  const agent=await a.addLocalAgent(id,{name:'WaitingReader',scope:'read'});
  await until(()=>a.room(id).agents.get(agent.agentId)?.isJoined());
  const read=()=>a.mcpCallPeer(id,target,'workspace_read',{path:'hello.txt'},{caller:agent.agentId});
  const stopped=read(),stoppedCheck=assert.rejects(stopped,/agent stopped/);
  await until(()=>a.room(id).mcpCalls.size===1);a.stopLocal(id,agent.agentId);await stoppedCheck;
  const removed=read(),removedCheck=assert.rejects(removed,/agent removed/);
  await until(()=>a.room(id).mcpCalls.size===1);await a.removeLocalAgent(id,agent.agentId);await removedCheck;
  const unloaded=a.mcpCallPeer(id,target,'workspace_read',{path:'hello.txt'}),unloadedCheck=assert.rejects(unloaded,/plugin disposed/);
  await until(()=>a.room(id).mcpCalls.size===1);const conn=a.room(id);await a.dispose();await unloadedCheck;
  assert.equal(conn.mcpCalls.size,0);
});

test('remote write remains pending until target approval then returns the completed write result',async t=>{
  const {a,b,id,target,root}=await pair(t);
  const pending=a.mcpCallPeer(id,target,'workspace_write',{path:'approved.txt',content:'approved remote write'});
  await until(()=>b.approvals.list().length===1);
  b.approvals.decide(b.approvals.list()[0].requestId,'allow');
  assert.equal((await pending).result.ok,true);
  const {readFile}=await import('node:fs/promises');assert.equal(await readFile(join(root,'approved.txt'),'utf8'),'approved remote write');
  await until(()=>a.peerConfigs.get(id)?.get(target)?.mcpEnabled);
  const peers=await a.tools().find(t=>t.name==='collab_peers').execute({roomId:id},{});
  assert.ok(peers.peers.find(p=>p.agentId===target).mcpTools.includes('workspace_read'));
  assert.equal(a.tools().find(t=>t.name==='collab_mcp_tools').execute instanceof Function,true);
});
