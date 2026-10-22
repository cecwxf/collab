import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { CollabBridge, normalizeConfig } from '../dist/index.js';
import { CollabClient, MockTransport } from '@collab/sdk';
import { generateIdentity, assertPayload } from '@collab/protocol';
import { executionRows } from '../src/client/execution.js';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
let O, L, S, E, H;
before(async () => {
  const out = await mkdtemp(join(tmpdir(), 'room-execution-build-'));
  await build({ entryPoints: ['orchestrator', 'local-agents', 'state', 'execution', 'http'].map(n => new URL(`../src/${n}.ts`, import.meta.url).pathname), outdir: out, bundle: true, platform: 'node', format: 'esm' });
  [O,L,S,E,H] = await Promise.all(['orchestrator','local-agents','state','execution','http'].map(n => import(join(out, n+'.js'))));
});
const tick = () => new Promise(r => setTimeout(r, 5));
async function until(fn) { for (let i=0;i<400;i++) { if (fn()) return; await tick(); } throw Error('condition timed out'); }
const req = (agentId, extra = {}) => ({ roomId:'r', agentId, threadId:'t', reason:'test', summary:'test', ...extra });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'room-execution-')), events = new Map();
  const ctx = { tools:{register:()=>()=>{}}, logger:{ info(){},warn(){},error(){} }, effect(){}, get(){}, on(name,fn){events.set(name,fn);return()=>events.delete(name);} };
  const b = new CollabBridge(ctx, normalizeConfig({ statePath:join(dir,'state.json'), identityPath:join(dir,'identity.json'), workspacePath:dir, agentName:'human', localAgentRunner:'mock' }));
  await b.start();
  return { b, ctx, events, dir };
}
async function room(b, agents=['architect','reviewer',{name:'Third',scope:'read'},'moderator']) {
  const r=await b.createRoom({localOnly:true,agents});
  await until(()=>b.room(r.roomId).client?.isJoined() && b.room(r.roomId).local.agents.every(a=>b.room(r.roomId).agents.get(a.agentId)?.isJoined()));
  return b.room(r.roomId);
}

test('zero defaults, finite bounds, unlimited budgets and one-time v3 migration', async()=>{
  assert.equal(L.defaultLocalSettings().concurrency,0); assert.equal(L.defaultLocalSettings().turnLimit,0);
  assert.equal(L.normalizeLocalSettings({concurrency:0,turnLimit:0}).concurrency,0);
  assert.equal(L.normalizeLocalSettings({concurrency:Infinity,turnLimit:NaN}).turnLimit,0);
  assert.equal(L.normalizeLocalSettings({concurrency:-1,turnLimit:-2}).concurrency,0);
  const t=new O.ThreadTracker(0); for(let i=0;i<50;i++) assert.equal(t.consume('t',3),3); assert.equal(t.used('t'),150);
  const dir=await mkdtemp(join(tmpdir(),'room-migration-')), file=join(dir,'state.json');
  await writeFile(file,JSON.stringify({version:3,rooms:[{roomId:'r',invite:'test',local:{concurrency:2,turnLimit:6}},{roomId:'s',invite:'test',local:{concurrency:3,turnLimit:8}}]}));
  let state=await S.loadState(file); assert.deepEqual(state.rooms.map(r=>[r.local.concurrency,r.local.turnLimit]),[[0,0],[3,8]]);
  state.rooms[0].local={concurrency:2,turnLimit:6}; await S.saveState(file,state);
  state=await S.loadState(file); assert.equal(state.version,4); assert.equal(state.rooms[0].local.concurrency,2); assert.equal(state.rooms[0].local.turnLimit,6);
  assert.equal(normalizeConfig({}).maxWakesPerMinute,0); assert.equal(normalizeConfig({maxWakesPerMinute:6}).maxWakesPerMinute,6);
  assert.equal(normalizeConfig({maxWakesPerMinute:Infinity}).maxWakesPerMinute,0);
});

test('unlimited scheduler starts four different agents, serializes duplicates through stop cleanup, and refreshes limits',async()=>{
  const releases=[], started=[]; let limit=1;
  const s=new O.RunScheduler(async run=>{started.push(run.agentId);await new Promise(r=>releases.push(r));},()=>limit);
  for(const id of ['a','b','c','d','a'])s.enqueue(req(id));
  await tick();assert.deepEqual(started,['a']);limit=0;s.refresh();await tick();assert.deepEqual(started,['a','b','c','d']);
  s.stop('r','a');s.enqueue(req('a'));await tick();assert.equal(started.filter(id=>id==='a').length,1);
  releases.shift()();await tick();assert.equal(started.filter(id=>id==='a').length,2);
  for(const release of releases)release();await s.whenIdle();
});

test('UI human @all and plain messages wake all three workers, exclude moderator, and tools do not create broadcast loops',async()=>{
  const {b}=await fixture();const releases=[];try {
    const c=await room(b); const started=[];
    b.localRunner=async({agent})=>{started.push(agent.agentId);await new Promise(r=>releases.push(r));};
    for(const text of ['@all first','plain second']) {
      await b.send(c.meta.roomId,text);await until(()=>started.length===3);
      assert.equal(b.view(c).runs.filter(r=>r.state==='running').length,3);
      assert.ok(!started.includes(c.local.agents.find(a=>a.moderator).agentId));
      for(const release of releases.splice(0))release();await b.scheduler.whenIdle();started.length=0;
    }
    await b.tools().find(t=>t.name==='collab_send').execute({roomId:c.meta.roomId,text:'model reply'},{});
    await tick();assert.equal(started.length,0);
    assert.deepEqual(O.routeLocalTargets({kind:'chat',messageId:'m',sender:'x',mentions:['all']},[c.local.agents.find(a=>a.moderator)]).targets,[]);
  }finally{for(const r of releases)r();await b.dispose();}
});

test('same thread continues past six agent hand-offs by default',async()=>{
  const {b}=await fixture();try{
    const c=await room(b,['architect','reviewer']);let count=0;
    b.localRunner=async({agent,trigger})=>{count++;if(count<10){const other=c.local.agents.find(a=>a.agentId!==agent.agentId);await b.publishAs(c.meta.roomId,agent.agentId,{kind:'chat',text:'next',mentions:[other.agentId],replyTo:trigger.messageId});}};
    await b.send(c.meta.roomId,'@architect start');await b.scheduler.whenIdle();assert.equal(count,10);
    assert.ok(!c.messages.some(m=>m.text.includes('Turn limit')));
    const p={kind:'chat',messageId:'guard',sender:'remote'};
    for(let i=0;i<12;i++)assert.equal(b.passesLoopGuard(c,p),true);
    assert.equal(b.passesLoopGuard(c,{...p,replyTo:'root',human:true}),true);
    assert.equal(b.passesLoopGuard(c,{...p,replyTo:'root',human:false}),false);
    b.config.maxWakesPerMinute=2;c.wakeTimes=[];assert.equal(b.passesLoopGuard(c,p),true);assert.equal(b.passesLoopGuard(c,p),true);assert.equal(b.passesLoopGuard(c,p),false);
  }finally{await b.dispose();}
});

test('real dsh event shapes update phases; signed wire snapshots and SSE contain no reasoning text',async()=>{
  const {b,events}=await fixture();let remote,release;try{
    const c=await room(b,['reviewer']);const a=c.local.agents[0];
    const identity=await generateIdentity('remote-observer'), parsed=CollabClient.parseInvite(c.meta.invite);
    remote=new CollabClient({identity,roomId:c.meta.roomId,roomKey:parsed.roomKeyB64,transport:new MockTransport(b.hub,'observer')});
    const received=[];remote.onPayload((p,meta)=>received.push({p,meta}));await remote.join();
    b.localRunner=async()=>new Promise(r=>{release=r;});
    c.meta.agentSessions={[a.agentId]:'session-worker'};b.sessionAgents.set('session-worker',{roomId:c.meta.roomId,agentId:a.agentId});
    await b.send(c.meta.roomId,'@reviewer run');await until(()=>!!release);
    const subject={session:{id:'session-worker'}};
    events.get('agent/status')({agent:subject,status:'running'});
    events.get('agent/assistant-stream')({agent:subject,frame:{type:'chunk',chunk:{type:'reasoning-delta',text:'PRIVATE_REASONING'}}});
    assert.equal(b.view(c).runs.find(r=>r.state==='running').phase,'thinking');
    await until(()=>received.some(x=>x.p.kind==='execution.status'&&x.p.runs.some(r=>r.phase==='thinking')));
    events.get('agent/assistant-stream')({agent:subject,frame:{type:'chunk',chunk:{type:'text-delta',text:'Public answer'}}});
    assert.equal(b.view(c).runs.find(r=>r.state==='running').phase,'streaming');
    events.get('agent/assistant-stream')({agent:subject,frame:{type:'chunk',chunk:{type:'tool-call-delta',args:'PRIVATE_ARGS'}}});
    assert.equal(b.view(c).runs.find(r=>r.state==='running').phase,'tool');
    assert.ok(!JSON.stringify(received).includes('PRIVATE_'));assert.ok(!JSON.stringify(b.state()).includes('PRIVATE_'));
    const wire=received.find(x=>x.p.kind==='execution.status');assert.equal(wire.meta.from,a.agentId);
    assert.deepEqual(Object.keys(wire.p.runs[0]).sort().filter(k=>!['id','state','phase','enqueuedAt','startedAt','endedAt','activity'].includes(k)),[]);
    release();await b.scheduler.whenIdle();await until(()=>received.some(x=>x.p.kind==='execution.status'&&x.p.runs.some(r=>r.state==='done')));
    let notified=0;const unsub=b.subscribe(()=>notified++);
    await remote.publish({kind:'execution.status',runs:[{id:'remote-run',state:'running',phase:'thinking',enqueuedAt:Date.now(),activity:{output:'Remote answer',tools:[{id:'remote-tool',name:'read',state:'running'}]}}]});
    await until(()=>b.view(c).runs.some(r=>r.id==='remote-run'));assert.ok(notified>0);unsub();
    assert.equal(b.view(c).runs.find(r=>r.id==='remote-run').agentId,identity.agentId);
    assert.equal(b.view(c).runs.find(r=>r.id==='remote-run').activity.output,'Remote answer');
    await remote.publish({kind:'execution.status',runs:[{id:'remote-run',state:'done',enqueuedAt:Date.now(),activity:{output:'Remote answer',tools:[{id:'remote-tool',name:'read',state:'done'}]}}]});
    await until(()=>c.messages.some(m=>m.execution?.id==='remote-run'));
    assert.equal(c.messages.find(m=>m.execution?.id==='remote-run').from,identity.agentId);
    assert.ok(c.messages.some(m=>m.kind==='execution.status' && m.text==='Public answer'));
    await remote.publish({kind:'stream.delta',streamId:'legacy',phase:'streaming',text:'DO_NOT_STORE'});
    await remote.publish({kind:'stream.end',streamId:'legacy',text:'public final'});
    await until(()=>c.messages.some(m=>m.text==='public final'));assert.ok(!JSON.stringify(b.state()).includes('DO_NOT_STORE'));
  }finally{release?.();await remote?.dispose();await b.dispose();assert.equal(events.size,0);}
});

test('remote execution metadata is sender bound, ordered, expired, and validated; delta fallback clears on end',()=>{
  const e=new E.RemoteExecutions('r'), now=Date.now();
  const p={v:1,kind:'execution.status',messageId:'m',sender:'spoof',ts:now,runs:[{id:'x',state:'running',phase:'thinking',enqueuedAt:now,agentId:'victim',summary:'SECRET'}]};
  assertPayload(p);e.receive('actual',p,2,now);e.receive('actual',{...p,runs:[]},1,now);
  assert.equal(e.list(now)[0].agentId,'actual');assert.ok(!JSON.stringify(e.list(now)).includes('SECRET'));
  assert.equal(e.list(now+E.EXECUTION_TTL+1).length,0);
  e.receive('actual',p,3,now+E.EXECUTION_TTL+1);assert.equal(e.list().length,0);
  e.stream('legacy','s','thinking',now);assert.equal(e.list()[0].phase,'thinking');e.endStream('legacy');assert.equal(e.list().length,0);
  assert.throws(()=>assertPayload({...p,runs:[{id:'x',state:'bogus',enqueuedAt:now}]}),/invalid execution/);
});

test('host wake shares the scheduler and waits until native session idle; stop cancels it',async()=>{
  const {b,events,ctx}=await fixture();let release;try{
    const c=await room(b,[]);let count=0, cancelled=0, pending=Promise.resolve();
    const agent={session:{id:'host-session',seq:0},followup(){count++;this.session.seq++;pending=new Promise(r=>{release=r;});},whenIdle(){return pending;},cancel(){cancelled++;release?.();}};
    ctx.get=n=>n==='agents'?{get:id=>id==='host-session'?agent:undefined}:undefined;
    b.bind(c,agent);
    const payload=i=>({v:1,kind:'chat',messageId:'host-'+i,sender:'remote',ts:Date.now(),mentions:['all'],text:'go'});
    await b.wake(c,payload(1),'remote');await b.wake(c,payload(2),'remote');await until(()=>count===1);
    assert.equal(b.scheduler.list(c.meta.roomId).filter(r=>r.state==='queued').length,1);
    events.get('agent/assistant-stream')({agent,frame:{type:'chunk',chunk:{type:'reasoning-delta',text:'PRIVATE'}}});
    assert.equal(b.view(c).runs.find(r=>r.state==='running').phase,'thinking');
    release();await until(()=>count===2);b.stopLocal(c.meta.roomId);await b.scheduler.whenIdle();assert.ok(cancelled>0);
  }finally{release?.();await b.dispose();}
});

test('chat strip stays mounted with details closed and labels individual running/queued phases',async()=>{
  const room={members:[{agentId:'a',name:'Alpha'},{agentId:'b',name:'Beta'}],runs:[{agentId:'a',state:'running',phase:'thinking'},{agentId:'a',state:'queued'},{agentId:'b',state:'queued',remote:true}]};
  const rows=executionRows(room);assert.match(rows[0].label,/running.*thinking.*1 queued/);assert.equal(rows[1].state,'queued');
  const code=(await readFile(new URL('../dist/client.js',import.meta.url),'utf8')).replaceAll('return module.exports;','return { ...module.exports, ExecutionStrip, RoomsMain };');
  let client;const jsx=(type,props)=>({type,props}), react={useState:x=>[x,()=>{}],useSyncExternalStore:(s,g)=>g()};
  vm.runInNewContext(code,{window:{__ModuleLoader__:{load({id,factory}){if(id==='@cecwxf/dsh-room')client=factory(n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:{});}}}});
  assert.equal(client.ExecutionStrip({room}).props['data-rm-executions'],'');
  const r={...room,roomId:'r',name:'Room',status:'online'};
  const main=client.RoomsMain({store:{subscribe(){},getSnapshot:()=>({selected:'r',rooms:[r],messages:{},detailsOpen:false}),actions:{}}});
  function has(n){return !!n&&(Array.isArray(n)?n.some(has):typeof n==='object'&&(n.type===client.ExecutionStrip||has(n.props?.children)));}
  assert.ok(has(main));
});


test('SSE and runs endpoint expose merged remote state with a strict text-free payload',async()=>{
  const {b}=await fixture();const request=new EventEmitter(),response=new EventEmitter();let body='';
  try{
    const c=await room(b,[]);request.url='/api/collab/stream';request.method='GET';
    response.writeHead=()=>{};response.write=data=>{body+=data;return true;};
    const handler=H.createApiHandler(b,()=>({requestRejection:()=>undefined}));
    await handler(request,response);
    await b.onPayload(c,{v:1,kind:'execution.status',messageId:'x',ts:Date.now(),sender:'remote',runs:[{id:'rx',state:'running',phase:'thinking',enqueuedAt:Date.now(),summary:'SECRET',text:'SECRET'}]},'remote',1);
    await until(()=>body.includes('"id":"rx"'));
    assert.match(body, /"phase":"thinking"/);assert.ok(!body.includes('SECRET'));
    let json;await handler({url:'/api/collab/rooms/'+c.meta.roomId+'/runs',method:'GET'},{setHeader(){},end(value){json=JSON.parse(value);}});
    assert.equal(json.runs[0].id,'rx');assert.equal(json.runs[0].remote,true);
  }finally{request.emit('close');response.emit('close');await b.dispose();}
});

test('new agent stays connecting in every published snapshot until its join completes', async () => {
  const { b } = await fixture();
  let release;
  try {
    const c = await room(b, []);
    const original = b.transportFor.bind(b);
    const gate = new Promise(resolve => { release = resolve; });
    b.transportFor = (...args) => {
      const transport = original(...args), connect = transport.connect.bind(transport);
      transport.connect = async (...input) => { await gate; return connect(...input); };
      return transport;
    };
    const snapshots = [];
    const off = b.subscribe(() => {
      const view = b.view(c);
      if (view.local.agents.length) snapshots.push(view);
    });
    const a = await b.addLocalAgent(c.meta.roomId, { name: 'Joining worker' });
    await tick();
    off();
    assert.ok(snapshots.length);
    for (const view of snapshots) {
      assert.equal(view.local.agents[0].connectionStatus, 'connecting', 'creation must not publish offline before starting its join');
      assert.equal(view.members.find(m => m.agentId === a.agentId).connectionStatus, 'connecting', 'member list and local agent list must agree');
      assert.equal(executionRows(view).find(r => r.agentId === a.agentId).state, 'connecting', 'the chat strip must preserve connecting instead of claiming offline');
    }
    release();
    await until(() => c.agents.get(a.agentId)?.isJoined());
    assert.equal(executionRows(b.view(c)).find(r => r.agentId === a.agentId).state, 'idle');
  } finally { release?.(); await b.dispose(); }
});

test('room chat receives ordinary output and tool lifecycle without reasoning or arguments, and saves terminal activity', async () => {
  const {b,events}=await fixture();let release;
  try {
    const c=await room(b,['reviewer']); const a=c.local.agents[0];
    b.sessionAgents.set('activity-session',{roomId:c.meta.roomId,agentId:a.agentId});
    b.localRunner=async()=>new Promise(r=>{release=r;});
    await b.send(c.meta.roomId,'@reviewer inspect');await until(()=>!!release);
    const agent={session:{id:'activity-session'}}, stream=frame=>events.get('agent/assistant-stream')({agent,frame});
    stream({type:'start',attemptId:'one'});
    stream({type:'chunk',chunk:{type:'reasoning-delta',text:'PRIVATE_REASONING'}});
    stream({type:'chunk',chunk:{type:'text-delta',text:'Reading the file.'}});
    const exec={agent,callId:'read-1',name:'read',arguments:{secret:'PRIVATE_ARGS'}};
    let delegated=false;
    await events.get('tools/execute')(exec,async()=>{delegated=true;return {isError:false};});
    assert.equal(delegated,true,'observation must delegate tool execution');
    events.get('tools/result')(exec,{isError:false,content:'PRIVATE_RESULT'});
    let run=b.view(c).runs.find(r=>r.state==='running');
    assert.equal(run.activity.output,'Reading the file.');
    assert.deepEqual(run.activity.tools,[{id:'read-1',name:'read',state:'done'}]);
    stream({type:'end',outcome:{kind:'committed',eventType:'assistant/message'}});
    stream({type:'start',attemptId:'two'});
    stream({type:'chunk',chunk:{type:'text-delta',text:'Looks correct.'}});
    stream({type:'end',outcome:{kind:'committed',eventType:'assistant/message'}});
    release();await b.scheduler.whenIdle();
    await until(()=>c.messages.some(m=>m.execution?.id===run.id));
    const message=c.messages.find(m=>m.execution?.id===run.id);
    assert.match(message.text,/Reading the file\.[\s\S]*Looks correct\./);
    assert.equal(message.from,a.agentId);assert.equal(message.execution.state,'done');
    assert.ok(!JSON.stringify(b.state()).includes('PRIVATE_'));
    assert.ok(!JSON.stringify(c.messages).includes('PRIVATE_'));
    await b.saveLocalHistory(c);
    const saved=await readFile(b.historyPath(c.meta.roomId),'utf8');assert.ok(saved.includes('Looks correct.'));
  } finally {release?.();await b.dispose();}
});

test('activity projection rejects oversize input, strips private fields, rolls back failed attempts and separates agents', async () => {
  const tracker=new E.ExecutionActivityTracker(), releases=[];
  const s=new O.RunScheduler(()=>new Promise(r=>releases.push(r)),()=>0);
  const a=s.enqueue(req('a')),b=s.enqueue(req('b'));await tick();
  tracker.stream(a,{type:'start',attemptId:'retry'});
  tracker.stream(a,{type:'chunk',attemptId:'retry',chunk:{type:'text-delta',text:'discarded'}});
  tracker.stream(a,{type:'end',attemptId:'retry',outcome:{kind:'committed',eventType:'assistant/attempt'}});
  assert.equal(a.activity.output,'');
  tracker.stream(a,{type:'start',attemptId:'success'});
  tracker.stream(a,{type:'chunk',attemptId:'old',chunk:{type:'text-delta',text:'wrong'}});
  tracker.stream(a,{type:'chunk',attemptId:'success',chunk:{type:'text-delta',text:'A answer'}});
  tracker.stream(b,{type:'chunk',chunk:{type:'text-delta',text:'B answer'}});
  tracker.tool(a,'1','read','running');tracker.tool(a,'1','read','failed');
  tracker.tool(a,'2','bash','running');s.stop('r','a');
  assert.deepEqual(a.activity.tools.map(t=>t.state),['failed','stopped']);
  assert.equal(b.activity.output,'B answer');assert.equal(a.activity.output,'A answer');
  const projected=E.publicRuns([{...a,activity:{...a.activity,reasoning:'SECRET',tools:[{id:'1',name:'read',state:'done',args:'SECRET'}]}}]);
  assert.ok(!JSON.stringify(projected).includes('SECRET'));
  const payload={v:1,kind:'execution.status',messageId:'m',sender:'a',ts:Date.now(),runs:projected};assertPayload(payload);
  assert.throws(()=>assertPayload({...payload,runs:[{...projected[0],activity:{output:'x'.repeat(16385),tools:[]}}]}),/activity/);
  for(const r of releases)r();await s.whenIdle();
});

test('chat renders per-agent live activity and replaces it with one persisted execution card',async()=>{
  const code=(await readFile(new URL('../dist/client.js',import.meta.url),'utf8')).replaceAll('return module.exports;','return { ...module.exports, ChatBody, ExecutionMessage };');
  let client;const jsx=(type,props)=>({type,props}),react={useMemo:f=>f(),useRef:()=>({current:null}),useEffect(){}};
  vm.runInNewContext(code,{window:{__ModuleLoader__:{load({id,factory}){if(id==='@cecwxf/dsh-room')client=factory(n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:{});}}}});
  const run={id:'r',agentId:'a',state:'running',phase:'thinking',enqueuedAt:Date.now(),activity:{output:'Answer',tools:[{id:'t',name:'read',state:'done'}]}};
  function cards(n){return !n?[]:Array.isArray(n)?n.flatMap(cards):typeof n==='object'?[...(n.type===client.ExecutionMessage?[n]:[]),...cards(n.props?.children)]:[];}
  const props={members:[{agentId:'a',name:'Alpha'}],room:{runs:[run]},store:{}};
  let tree=client.ChatBody({...props,messages:[]});assert.equal(cards(tree).length,1);
  const card=client.ExecutionMessage(cards(tree)[0].props);assert.equal(card.props['aria-label'],'Alpha · Thinking…');
  tree=client.ChatBody({...props,messages:[{id:'saved',from:'a',ts:run.enqueuedAt,execution:{...run,state:'done'}}]});assert.equal(cards(tree).length,1);assert.equal(cards(tree)[0].props.run.state,'done');
});
