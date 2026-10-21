import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function fixture() {
  const code=(await readFile(new URL('../dist/client.js',import.meta.url),'utf8')).replaceAll('return module.exports;','return { ...module.exports, CreateDialog, TransportSection };');
  let client,cursor=0;const state=[],created=[],switched=[];
  const react={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef:initial=>({current:initial}),useEffect(){},useSyncExternalStore:(_,snapshot)=>snapshot()};
  const jsx=(type,props)=>({type,props});
  vm.runInNewContext(code,{window:{__ModuleLoader__:{load({id,factory}){if(id==='@cecwxf/dsh-room')client=factory(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{});}}}});
  const store={getSnapshot:()=>({version:'test',models:[]}),subscribe(){},actions:{async create(payload){created.push(payload);},async setTransport(...args){switched.push(args);},toast(){}}};
  function render(kind='create',transport='local') {
    cursor=0;
    const root=kind==='create'?client.CreateDialog({store,d:{workspace:{id:'w',path:'/project',title:'Project'}}}):client.TransportSection({store,room:{roomId:'legacy',transport,local:{agents:[]}}});
    const nodes=[];function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}nodes.push(n);walk(n.props?.children);walk(n.props?.footer);}walk(root);
    return nodes;
  }
  return {render,created,switched};
}

test('new rooms default to private Local; Relay uses configured endpoint without address fields',async()=>{
  const f=await fixture();let nodes=f.render();
  assert.equal(nodes.find(n=>n.type==='button'&&n.props.children==='Local').props['aria-pressed'],true);
  assert.equal(nodes.find(n=>n.type==='button'&&n.props.children==='Relay').props['aria-pressed'],false);
  assert.ok(!nodes.some(n=>/VPS|Cloudflare|host:port|LAN relay/.test(String(n.props?.label||n.props?.children||''))));
  nodes.find(n=>n.props?.id==='rm-create-name').props.onChange({target:{value:'Local room'}});
  nodes=f.render();await nodes.find(n=>n.props?.children==='Create').props.onClick();
  assert.equal(f.created[0].concurrency,0);assert.equal(f.created[0].turnLimit,0);assert.equal(f.created[0].localOnly,true);assert.equal(f.created[0].public,false);assert.equal(f.created[0].mode,'relay');assert.equal('lanHostPort' in f.created[0],false);
  nodes.find(n=>n.type==='button'&&n.props.children==='Relay').props.onClick();nodes=f.render();
  assert.equal(nodes.find(n=>n.type==='button'&&n.props.children==='Relay').props['aria-pressed'],true);
  await nodes.find(n=>n.props?.children==='Create').props.onClick();assert.equal(f.created[1].localOnly,false);assert.equal(f.created[1].mode,'relay');assert.equal('lanHostPort' in f.created[1],false);
});

test('legacy LAN rooms display as Relay and keep the existing relay on selection',async()=>{
  const f=await fixture(),nodes=f.render('transport','lan'),buttons=nodes.filter(n=>n.type==='button');
  assert.deepEqual(buttons.map(n=>n.props.children),['Local','Relay']);
  const relay=buttons[1];assert.match(relay.props.className,/is-on/);await relay.props.onClick();
  assert.deepEqual(f.switched,[['legacy','relay']]);
});

test('creating Local opens its conversation directly; Relay offers an invitation',async()=>{
  const {createRoomsStore}=await import('../src/client/store.js');const original=globalThis.fetch;const store=createRoomsStore();
  try {
    globalThis.fetch=async(url,init)=>({ok:true,text:async()=>String(url).endsWith('/messages')?'{}':JSON.stringify({roomId:'created',name:'Test',transport:JSON.parse(init.body).localOnly?'local':'relay',invite:'test-invite'})});
    await store.actions.create({name:'Test',localOnly:true});assert.equal(store.getSnapshot().dialog,null);assert.equal(store.getSnapshot().selected,'created');
    await store.actions.create({name:'Test',localOnly:false});assert.equal(store.getSnapshot().dialog.kind,'invite');
  } finally {globalThis.fetch=original;store.dispose();}
});
