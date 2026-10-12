#!/usr/bin/env node
// Verify persisted real-model tool events, not only the agent's final chat. Requires the zstd CLI.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const [sessionFile,evidenceFile]=process.argv.slice(2);assert.ok(sessionFile&&evidenceFile,'session.v4.jsonl.zstd and evidence.json required');
const evidence=JSON.parse(await readFile(evidenceFile,'utf8'));
const events=execFileSync('zstd',['-dc',sessionFile],{maxBuffer:10*1024*1024}).toString().trim().split('\n').map(JSON.parse);
const calls=events.filter(e=>e.type==='tool/call');
assert.ok(calls.every(e=>e.data.name.startsWith('collab_')),'test agent must not read through native shell/file/network tools');
const results=new Map(events.filter(e=>e.type==='tool/result').map(e=>[e.data.message.toolCallId,e.data.message]));
const trace=calls.filter(e=>e.data.name==='collab_mcp_call').map(e=>{
  const m=results.get(e.data.callId);assert.ok(m,`result missing for ${e.data.callId}`);assert.equal(m.isError,false);
  return {callId:e.data.callId,args:JSON.parse(e.data.arguments),response:JSON.parse(m.content.filter(b=>b.type==='text').map(b=>b.text).join(''))};
});
for(const tool of ['workspace_list','workspace_search','workspace_stat','workspace_read'])assert.ok(trace.some(c=>c.args.tool===tool&&c.response.ok),`successful ${tool} result missing`);
assert.ok(trace.some(c=>c.args.tool==='workspace_read'&&c.response.result?.content===evidence.fixture.content),'actual remote content missing in persisted tool output');
const folder=evidence.fixture.path.split('/')[0];
assert.equal(trace.find(c=>c.args.tool==='workspace_list'&&c.response.ok).response.result.path,folder);
assert.ok(trace.find(c=>c.args.tool==='workspace_search'&&c.response.ok).response.result.hits.some(h=>h.path===evidence.fixture.path));
assert.ok(trace.some(c=>!c.response.ok&&/peer grant deny/.test(c.response.error)));
assert.ok(trace.some(c=>c.args.args.path==='../outside-secret.txt'&&!c.response.ok&&/escapes workspace/.test(c.response.error)));
assert.ok(trace.some(c=>c.args.args.path.endsWith('/outside-link.txt')&&!c.response.ok&&/symlink/.test(c.response.error)));
evidence.toolCalls=trace;evidence.persistedToolEventsVerified=true;
await writeFile(evidenceFile,JSON.stringify(evidence,null,2));
console.log(`Persisted MCP session verified: ${trace.length} calls; four read tools; exact content and relative paths; three denials; no native file/shell tools`);
