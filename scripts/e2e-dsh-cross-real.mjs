#!/usr/bin/env node
// Requires two already-running isolated dsh hosts with real-provider credentials.
// Control JSON files contain {base,cookie}; local also contains {roomId,invite}.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
assert.ok(process.env.DSH_MAC_CONTROL && process.env.DSH_VPS_CONTROL,'DSH_MAC_CONTROL and DSH_VPS_CONTROL required');
const mac=JSON.parse(await readFile(process.env.DSH_MAC_CONTROL,'utf8')),vps=JSON.parse(await readFile(process.env.DSH_VPS_CONTROL,'utf8'));
async function api(h,path,body){const r=await fetch(h.base+'/api/collab'+path,{method:body===undefined?'GET':'POST',headers:{cookie:h.cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();assert.ok(r.ok,`${path}: ${r.status} ${v.error||''}`);return v;}
async function until(f,label){const end=Date.now()+240000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,500));}throw Error('timeout: '+label);}
const p='/rooms/'+encodeURIComponent(mac.roomId);
const state=await api(vps,'/state');assert.equal(state.version,'0.3.4');assert.equal(state.defaultModel.model,'deepseek-flash');
await api(vps,'/join',{invite:mac.invite});
const joined=(await api(vps,'/state')).rooms.find(r=>r.roomId===mac.roomId);
const remote=joined.local.agents.find(a=>a.name==='VpsCalculator') || await api(vps,p+'/agents',{name:'VpsCalculator',scope:'read',reasoningEffort:'low',systemPrompt:'First call collab_history and collab_rooms and verify their results are readable. For this test, when asked by coder.lmac to calculate 7+8, use collab_send with text VPS_RESULT_15 and mentions ["coder.lmac"]. Do not mention others. Do not use any shell or file tools.'});
await until(async()=> (await api(mac,'/state')).rooms.find(r=>r.roomId===mac.roomId).members.some(m=>m.agentId===remote.agentId),'VPS agent joined Mac room');
const baseline=new Set((await api(mac,p+'/messages')).messages.map(m=>m.id));
await api(mac,p+'/send',{text:`@coder.lmac Delegate calculation 7+8 to ${remote.agentId} using collab_send with mentions ["${remote.agentId}"]. Do not answer the calculation yourself. Immediately end your turn after sending the delegation. Do not wait, sleep or poll history. In your next turn, when ${remote.agentId} replies VPS_RESULT_15, acknowledge via collab_send with text MAC_CONFIRMED_15 and no mentions. No file changes.`});
const messages=async()=>(await api(mac,p+'/messages')).messages.filter(m=>!baseline.has(m.id));
await until(async()=> (await messages()).some(m=>m.from===remote.agentId&&m.text.includes('VPS_RESULT_15')),'VPS real model response');
await until(async()=> (await messages()).some(m=>m.from==='coder.lmac'&&m.text.includes('MAC_CONFIRMED_15')),'Mac real model confirmation');
await until(async()=>{for(const h of [mac,vps]){const runs=(await api(h,p+'/runs')).runs;assert.ok(!runs.some(r=>r.state==='failed'),JSON.stringify(runs));if(runs.some(r=>['running','queued','approval'].includes(r.state)))return false;}return true;},'cross-host sessions idle');
const room=(await api(vps,'/state')).rooms.find(r=>r.roomId===mac.roomId);assert.ok(room.local.agents[0].sessionId);assert.ok(!(await messages()).some(m=>m.text.includes('[mock')));
const evidence={version:state.version,model:state.defaultModel,remoteSession:room.local.agents[0].sessionId,messages:(await messages()).filter(m=>m.from===remote.agentId||m.text.includes('MAC_CONFIRMED_15')),runs:(await api(vps,p+'/runs')).runs};
await writeFile(process.env.DSH_CROSS_EVIDENCE||'../work/cross-real-evidence.json',JSON.stringify(evidence,null,2),{mode:0o600});
console.log('DSH CROSS REAL E2E PASS: Mac agent delegates through VPS relay; VPS DeepSeek agent calculates; Mac DeepSeek agent confirms; real session id; no mock output');
