#!/usr/bin/env node
// Run against an already upgraded REAL dsh web. The control file has {base,cookie};
// use the private control file emitted by e2e-dsh-real.mjs with DSH_REAL_KEEP=1,
// or supply one for the normal ~/.dsh/profiles/web host. Never prints credentials.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const control = process.env.DSH_P0_CONTROL;
assert.ok(control, 'Set DSH_P0_CONTROL to a private JSON file with base and cookie for the upgraded dsh web');
const { base, cookie } = JSON.parse(await readFile(control, 'utf8'));
const out = resolve(process.env.DSH_P0_EVIDENCE || 'artifacts/p0/real');
await mkdir(out, { recursive: true });
const version = JSON.parse(await readFile(new URL('../packages/dsh-room/package.json', import.meta.url), 'utf8')).version;
async function api(path, body) {
  const r = await fetch(base + '/api/collab' + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const v = await r.json(); assert.ok(r.ok, `${path}: ${r.status} ${v.error || ''}`); return v;
}
assert.equal((await api('/version')).version, version, 'web must load the new published version');
const workspace = await mkdtemp(join(tmpdir(), 'dsh-p0-real-'));
const names = ['P0 Alpha', 'P0 Beta', 'P0 Gamma', 'P0 Delta'];
const r = await api('/rooms', { name: 'P0 real execution validation', workspacePath: workspace, localOnly: true,
  agents: [...names.map(name => ({ name, scope: 'read', reasoningEffort: 'high', systemPrompt: 'Do not edit files. For ordinary requests, solve the requested arithmetic and use collab_send to post the requested marker, with no mentions. Do not create tasks.' })), { name: 'P0 Moderator', moderator: true, scope: 'read' }] });
assert.equal(r.local.concurrency, 0); assert.equal(r.local.turnLimit, 0);
const p = '/rooms/' + encodeURIComponent(r.roomId), ac = new AbortController(), observed = new Map(), phaseSeen = new Set();
let current, allRunning = false, streamError;
function record(room) {
  if (!room) return; current = room;
  for (const run of room.runs || []) { observed.set(run.id, run); if (run.phase) phaseSeen.add(run.phase); }
  if ((room.runs || []).filter(run => run.state === 'running' && names.includes(room.local.agents.find(a => a.agentId === run.agentId)?.name)).length === names.length) allRunning = true;
}
const stream = (async () => {
  const res = await fetch(base + '/api/collab/stream', { headers: { cookie }, signal: ac.signal });
  assert.ok(res.ok); const decoder = new TextDecoder(); let buffer = '';
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end; while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
      if (data) { const event = JSON.parse(data); record((event.rooms || event.state?.rooms || []).find(room => room.roomId === r.roomId)); }
    }
  }
})().catch(e => { if (!ac.signal.aborted) streamError = e; });
async function wait(check, label, ms = 300_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (streamError) throw streamError;
    record((await api('/state')).rooms.find(room => room.roomId === r.roomId));
    assert.ok(!current.runs.some(run => run.state === 'failed'), 'real run failed: ' + JSON.stringify(current.runs.filter(run => run.state === 'failed')));
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('timeout: ' + label);
}
const idle = () => !current.runs.some(run => ['running', 'queued', 'approval'].includes(run.state));
const messages = async () => (await api(p + '/messages')).messages;
let passed = false;
try {
  await wait(() => current.local.agents.every(a => a.online), 'all agents online', 30_000);
  for (const [prefix, marker] of [['@all ', 'P0_ALL_PASS'], ['', 'P0_PLAIN_PASS']]) {
    allRunning = false;
    await api(p + '/send', { text: `${prefix}Independently calculate 12347*9823, then check by a second method. Post ${marker} and the result with collab_send, no mentions, no files.` });
    await wait(async () => { const ms = await messages(); return names.every(name => ms.some(m => m.from === current.local.agents.find(a => a.name === name).agentId && m.text.includes(marker))) && idle(); }, marker);
    assert.ok(allRunning, `${marker}: all four workers must be running simultaneously`);
    const moderator = current.local.agents.find(a => a.moderator);
    assert.ok(![...observed.values()].some(run => run.agentId === moderator.agentId), 'implicit broadcast must exclude moderator');
  }
  const workers = current.local.agents.filter(a => !a.moderator);
  const protocol = `For a P0_CHAIN message, read integer N after P0_CHAIN. If N < 10, call collab_send exactly once, text 'P0_CHAIN ' followed by N+1, mentions containing the next agent ID in this circular list: ${workers.map(a => a.agentId).join(', ')}. Always set replyTo to the triggering messageId. At N=10, send P0_CHAIN_DONE_10 with replyTo and no mentions. Do not do other work or create tasks.`;
  for (const worker of workers) await api(p + '/agents/' + encodeURIComponent(worker.agentId), { systemPrompt: protocol });
  const before = new Set(observed.keys());
  await api(p + '/send', { text: `@${workers[0].agentId} P0_CHAIN 1` });
  await wait(async () => (await messages()).some(m => m.text.includes('P0_CHAIN_DONE_10')) && idle(), 'ten real agent hand-offs', 600_000);
  const chain = [...observed.values()].filter(run => !before.has(run.id));
  assert.ok(chain.length >= 10, `expected at least ten runs; observed ${chain.length}`);
  assert.equal(new Set(chain.map(run => run.threadId)).size, 1, 'hand-offs must stay in one thread');
  assert.ok(phaseSeen.has('thinking'), 'real reasoning stream must report thinking');
  assert.ok(phaseSeen.has('streaming'), 'real output stream must report streaming');
  assert.ok(current.local.agents.filter(a => !a.moderator).every(a => a.sessionId), 'real native session IDs required');
  assert.ok(!(await messages()).some(m => /\[mock /.test(m.text)));
  passed = true;
  console.log(`PASS: ${version}; four simultaneous workers for @all and plain text; thinking/streaming; ten turns in one thread. Room ${r.roomId}`);
} finally {
  ac.abort(); await stream;
  // Execution metadata only; no credentials, prompts, or reasoning text in evidence.
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed, version, roomId: r.roomId, workspace, phases: [...phaseSeen], runs: [...observed.values()].map(({ summary, error, ...run }) => run) }, null, 2), { mode: 0o600 });
  if (!passed) await api(p + '/stop', {}).catch(() => {});
}
