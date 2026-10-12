#!/usr/bin/env node
// A real agent on the caller host reads an unpredictable fixture only present on the exporter.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
assert.ok(process.env.DSH_MCP_EXPORTER && process.env.DSH_MCP_CALLER,'exporter/caller control files required');
const exporter=JSON.parse(await readFile(process.env.DSH_MCP_EXPORTER,'utf8'));
const caller=JSON.parse(await readFile(process.env.DSH_MCP_CALLER,'utf8'));
caller.authHost=new URL(caller.base).host;
if(process.env.DSH_MCP_CALLER_BASE)caller.base=process.env.DSH_MCP_CALLER_BASE;
async function api(h,path,body){return new Promise((resolve,reject)=>{const req=request(h.base+'/api/collab'+path,{method:body===undefined?'GET':'POST',headers:{host:h.authHost||new URL(h.base).host,cookie:h.cookie,'content-type':'application/json'}},res=>{let text='';res.setEncoding('utf8');res.on('data',d=>text+=d);res.on('end',()=>{try{assert.ok(res.statusCode>=200&&res.statusCode<300,`${path}: HTTP ${res.statusCode}`);resolve(JSON.parse(text));}catch(e){reject(e);}});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}
async function until(f,label){const end=Date.now()+240000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,500));}throw Error('timeout: '+label);}
const nonce=randomUUID(),folder='mcp-fixture-'+nonce.slice(0,8),file='proof-'+randomUUID().slice(0,8)+'.txt';
const content='REMOTE_WORKSPACE_NONCE='+nonce+'\n';
const fixture=join(exporter.workspace,folder),outside=join(exporter.dir,'outside-secret.txt');
let room,reader;
try {
  await mkdir(fixture);await writeFile(join(fixture,file),content);await writeFile(outside,'OUTSIDE_MUST_NOT_BE_READ');await symlink(outside,join(fixture,'outside-link.txt'));
  const es=await api(exporter,'/state'),cs=await api(caller,'/state');assert.equal(es.version,cs.version);
  const target=es.self;
  room=await api(exporter,'/rooms',{name:'Real remote MCP '+exporter.host,workspacePath:exporter.workspace,mode:'relay',turnLimit:12,concurrency:2});
  const invite=process.env.DSH_MCP_CALLER_RELAY_HOST?room.invite.replace(process.env.DSH_MCP_EXPORTER_RELAY_HOST||'127.0.0.1:38180',process.env.DSH_MCP_CALLER_RELAY_HOST):room.invite;
  await api(caller,'/join',{invite});
  const p='/rooms/'+encodeURIComponent(room.roomId);
  reader=await api(caller,p+'/agents',{name:'RemoteMcpReader',scope:'read',reasoningEffort:'low',systemPrompt:'Use only collab tools for this validation. Remote workspace reads must use collab_mcp_call, never native file, shell, network or HTTP tools. Report tool errors honestly. Reply via collab_send with no mentions.'});
  await until(async()=> (await api(caller,'/state')).rooms.find(r=>r.roomId===room.roomId).local.agents.find(a=>a.agentId===reader.agentId)?.online,'real reader joined');
  await api(exporter,p+'/config',{peerGrants:{default:{read:'deny',write:'deny',exec:'deny',delete:'deny'},byAgent:{[reader.agentId]:{read:'auto'}}}});
  const messages=async()=>(await api(exporter,p+'/messages')).messages;
  async function idle(){await until(async()=>{const runs=(await api(caller,p+'/runs')).runs;assert.ok(!runs.some(r=>r.state==='failed'),JSON.stringify(runs));return !runs.some(r=>['running','queued','approval'].includes(r.state));},'reader idle');}
  await api(exporter,p+'/send',{text:`@${reader.agentId} Validate remote workspace access. First call collab_peers and collab_mcp_tools. Use collab_mcp_call with target "${target}" for ALL four operations: workspace_list path "${folder}"; workspace_search path "${folder}" query "REMOTE_WORKSPACE_NONCE="; workspace_stat path "${folder}/${file}"; workspace_read path "${folder}/${file}". Read the actual returned content and report it verbatim in collab_send with MCP_READ_PASS and the returned file size. Do not guess or use your local workspace. End your turn after reporting.`});
  await until(async()=> (await messages()).some(m=>m.from===reader.agentId&&m.text.includes('MCP_READ_PASS')&&m.text.includes(nonce)),'unpredictable remote file content');await idle();
  // Host identity is denied while the model agent is allowed: catches accidental host impersonation.
  const deniedHost=await api(caller,p+'/mcp',{target,tool:'workspace_read',args:{path:folder+'/'+file}});assert.equal(deniedHost.ok,false);assert.match(deniedHost.error,/peer grant deny/);
  await api(exporter,p+'/config',{peerGrants:{default:{read:'deny',write:'deny',exec:'deny',delete:'deny'},byAgent:{[reader.agentId]:{read:'deny'}}}});
  await api(exporter,p+'/send',{text:`@${reader.agentId} Call collab_mcp_call target "${target}" tool workspace_read args {"path":"${folder}/${file}"}. Permission was revoked. Report MCP_ACL_DENIED and the actual returned error only if ok=false with peer grant deny. End your turn after reporting.`});
  await until(async()=> (await messages()).some(m=>m.from===reader.agentId&&m.text.includes('MCP_ACL_DENIED')&&m.text.includes('peer grant deny')),'real ACL denial');await idle();
  await api(exporter,p+'/config',{peerGrants:{default:{read:'deny',write:'deny',exec:'deny',delete:'deny'},byAgent:{[reader.agentId]:{read:'auto'}}}});
  await api(exporter,p+'/send',{text:`@${reader.agentId} Call collab_mcp_call target "${target}" tool workspace_read twice: args {"path":"../outside-secret.txt"} and {"path":"${folder}/outside-link.txt"}. Both must return ok=false and path escapes workspace. Report MCP_TRAVERSAL_DENIED MCP_SYMLINK_DENIED plus both actual errors via collab_send. End after reporting.`});
  await until(async()=> (await messages()).some(m=>m.from===reader.agentId&&m.text.includes('MCP_TRAVERSAL_DENIED')&&m.text.includes('MCP_SYMLINK_DENIED')&&m.text.includes('escapes workspace')),'real traversal and symlink denials');await idle();
  const final=(await api(caller,'/state')).rooms.find(r=>r.roomId===room.roomId).local.agents.find(a=>a.agentId===reader.agentId);assert.ok(final.sessionId);
  const evidence={version:es.version,exporterHost:exporter.host,callerHost:caller.host,model:cs.defaultModel,target,reader:reader.agentId,sessionId:final.sessionId,fixture:{path:folder+'/'+file,content,size:Buffer.byteLength(content)},messages:(await messages()).filter(m=>m.from===reader.agentId),runs:(await api(caller,p+'/runs')).runs,hostIdentityDenied:deniedHost};
  await writeFile(process.env.DSH_MCP_EVIDENCE||'../work/mcp-real-evidence.json',JSON.stringify(evidence,null,2));
  console.log(`REAL MCP PASS: ${caller.host} agent → relay → ${exporter.host} workspace; unpredictable content; per-agent ACL; traversal/symlink denials; session ${final.sessionId}`);
} finally {
  if(room){const p='/rooms/'+encodeURIComponent(room.roomId);if(reader)await api(caller,p+'/agents/'+reader.agentId+'?op=delete',{}).catch(()=>{});await api(caller,p+'/leave',{}).catch(()=>{});await api(exporter,p+'/leave',{}).catch(()=>{});}
  await rm(fixture,{recursive:true,force:true});await rm(outside,{force:true});
}
