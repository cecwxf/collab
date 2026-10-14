import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installRoomGroups} from '../src/client/workspace-rooms.js';

async function exerciseGroups(sessions, overrides = {}) {
  const dom=new JSDOM('<body><section><span><div data-row-key="workspace:w" aria-expanded="true">Workspace</div></span><span id="original"><div data-row-key="session:s">Native session</div></span><span id="host"><div data-row-key="session:h">Native host session</div></span></section></body>',{pretendToBeVisual:true});
  const saved={};for(const key of ['document','MutationObserver','requestAnimationFrame','cancelAnimationFrame','CSS'])saved[key]=globalThis[key];
  Object.assign(globalThis,{document:dom.window.document,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),CSS:{escape:s=>s}});
  const callbacks=new Set();const sub=fn=>{callbacks.add(fn);return()=>callbacks.delete(fn);};const tick=()=>new Promise(r=>setTimeout(r,40));
  let state={rooms:[{roomId:'r',name:'Research room',status:'online',sessionId:'h',memberConfig:{workspacePath:'/var/project'},local:{agents:[{agentId:'a',name:'Author',sessionId:'s',state:'idle',online:true}]}}],expandedRooms:{},selected:'r'};
  let dialog;
  const actions={openDialog(value){dialog=value;},select(id){state.selected=id;},toggleRoom(id){state.expandedRooms[id]=state.expandedRooms[id]===false;for(const f of callbacks)f();},async openSession(){}};
  const store={getSnapshot:()=>state,subscribe:sub,actions},native={list:{getSnapshot:()=>({items:[{workspaceId:'w',path:'/private/var/project'}]}),subscribe:sub}},layout={panelInfo:{getSnapshot:()=>({activePanelId:'collab'}),subscribe:sub}};
  Object.assign(native, overrides.native);Object.assign(layout, overrides.layout);
  let dispose;
  try {
    dispose=installRoomGroups(store,native,layout,sessions);await tick();
    const original=document.querySelector('#original'),nativeRow=original.firstElementChild;
    if(overrides.native?.list===undefined&&Object.hasOwn(overrides,'native')) {
      assert.equal(document.querySelectorAll('[data-rm-room-group]').length,0);
      assert.ok(!original.hasAttribute('data-rm-grouped-session'));
      return;
    }
    assert.equal(document.querySelectorAll('[data-rm-room-group]').length,1);
    assert.equal(document.querySelector('[data-rm-workspace-rooms]').parentElement,original.parentElement,'group belongs to the workspace section, not the HoverCard span');
    assert.ok(original.hasAttribute('data-rm-grouped-session'));
    assert.ok(document.querySelector('#host').hasAttribute('data-rm-grouped-session'));
    assert.ok(document.querySelector('[data-rm-open-host]'));
    document.querySelector('[data-rm-new-room-shortcut]').click();
    assert.equal(dialog.kind,'create');assert.equal(dialog.workspace.id,'w');assert.equal(dialog.workspace.path,'/private/var/project');
    document.querySelector('[data-rm-room-menu-button]').click();assert.equal(document.querySelector('[role=menuitem]').textContent,'Edit room');document.querySelector('[role=menuitem]').click();assert.equal(dialog.kind,'room-settings');assert.equal(dialog.roomId,'r');
    document.querySelector('[data-rm-room-menu-button]').click();[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent==='Delete room').click();assert.equal(dialog.kind,'delete-room');assert.equal(document.querySelector('[data-rm-room-menu]'),null);
    await overrides.verify?.(tick);
    document.querySelector('[aria-label="Collapse room Research room"]').click();await tick();
    assert.equal(document.querySelector('[data-rm-open-agent]'),null);assert.ok(original.isConnected);
    document.querySelector('[aria-label="Expand room Research room"]').click();await tick();
    assert.ok(document.querySelector('[data-rm-open-agent]'));
    // React can replace only its native anchor; the plugin must not remove, duplicate or reparent it.
    const replacement=original.cloneNode(true);original.replaceWith(replacement);await tick();
    assert.ok(replacement.hasAttribute('data-rm-grouped-session'));assert.equal(document.querySelectorAll('[data-rm-room-group]').length,1);
    document.querySelector('[data-row-key="workspace:w"]').setAttribute('aria-expanded','false');await tick();assert.equal(document.querySelector('[data-rm-workspace-rooms]').hidden,true);
    document.querySelector('[data-row-key="workspace:w"]').parentElement.remove();await tick();
    assert.equal(document.querySelector('[data-rm-workspace-rooms]'),null,'flat/sidebar rerenders remove orphan shortcuts');
    assert.ok(!replacement.hasAttribute('data-rm-grouped-session'));
    dispose();dispose=null;assert.equal(document.querySelector('[data-rm-workspace-rooms]'),null);assert.ok(!replacement.hasAttribute('data-rm-grouped-session'));assert.ok(replacement.firstElementChild.isSameNode(nativeRow)===false);
  } finally {dispose?.();dom.window.close();for(const key of Object.keys(saved)){if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];}}

}

test('native HoverCard wrappers get one room group; original session rows survive fold, rerender and unload',()=>exerciseGroups());
test('room groups load with a sessions service lacking the optional list observable',()=>exerciseGroups({}));
test('room groups load without the optional layout observable',()=>exerciseGroups({}, {layout:{panelInfo:undefined}}));
test('missing native workspace list leaves original session rows visible',()=>exerciseGroups({}, {native:{list:undefined}}));
test('snapshot-only services need no subscribe method',()=>exerciseGroups({list:{getSnapshot:()=>({byId:{s:{id:'s',retainedBy:{mainView:1}}}})}}, {layout:{panelInfo:{getSnapshot:()=>({activePanelId:'collab'})}}}));
test('native session observable updates the active grouped agent and unsubscribes on unload', async()=>{
  const callbacks=new Set();let sid='s';
  const list={getSnapshot(){return {byId:{[sid]:{id:sid,retainedBy:{mainView:1}}}};},subscribe(fn){callbacks.add(fn);return()=>callbacks.delete(fn);}};
  await exerciseGroups({list}, {layout:{panelInfo:{getSnapshot:()=>({activePanelId:'native'})}},async verify(tick){
    assert.equal(document.querySelector('[data-rm-open-agent]').getAttribute('aria-current'),'true');
    sid='h';for(const cb of callbacks)cb();await tick();
    assert.equal(document.querySelector('[data-rm-open-host]').getAttribute('aria-current'),'true');
    assert.equal(document.querySelector('[data-rm-open-agent]').getAttribute('aria-current'),'false');
  }});assert.equal(callbacks.size,0);
});

test('room group is re-anchored as first sibling under the workspace after React inserts sessions', async () => {
  const dom = new JSDOM('<body><section><span><div data-row-key="workspace:w" aria-expanded="true">Workspace</div></span><span id="original"><div data-row-key="session:s">Native session</div></span></section></body>', { pretendToBeVisual: true });
  const saved = {};
  for (const key of ['document', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSS']) saved[key] = globalThis[key];
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), CSS: { escape: s => s } });
  const callbacks = new Set();
  const sub = fn => { callbacks.add(fn); return () => callbacks.delete(fn); };
  const tick = () => new Promise(r => setTimeout(r, 40));
  const state = { rooms: [{ roomId: 'r', name: 'Research room', status: 'online', sessionId: 's', memberConfig: { workspacePath: '/var/project' }, local: { agents: [] } }], expandedRooms: {}, selected: 'r' };
  const store = { getSnapshot: () => state, subscribe: sub, actions: { openDialog() {}, select() {}, toggleRoom() {}, async openSession() {} } };
  const native = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w', path: '/private/var/project' }] }), subscribe: sub } };
  const layout = { panelInfo: { getSnapshot: () => ({ activePanelId: 'collab' }), subscribe: sub } };
  let dispose;
  try {
    dispose = installRoomGroups(store, native, layout, {});
    await tick();
    const section = document.querySelector('section');
    const group = document.querySelector('[data-rm-workspace-rooms]');
    const ws = document.querySelector('[data-row-key="workspace:w"]').parentElement;
    assert.equal(group.previousElementSibling, ws);
    // Simulate React inserting a new session between workspace and room group.
    const injected = document.createElement('span');
    injected.innerHTML = '<div data-row-key="session:new">Injected</div>';
    section.insertBefore(injected, group);
    assert.notEqual(group.previousElementSibling, ws);
    for (const cb of callbacks) cb();
    await tick();
    assert.equal(document.querySelector('[data-rm-workspace-rooms]').previousElementSibling, ws, 'group must move back under the workspace header');
  } finally {
    dispose?.();
    dom.window.close();
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete globalThis[key];
      else globalThis[key] = saved[key];
    }
  }
});
