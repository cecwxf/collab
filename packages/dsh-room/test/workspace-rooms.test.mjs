import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installRoomGroups} from '../src/client/workspace-rooms.js';

test('native HoverCard wrappers get one room group; original session rows survive fold, rerender and unload',async()=>{
  const dom=new JSDOM('<body><section><span><div data-row-key="workspace:w" aria-expanded="true">Workspace</div></span><span id="original"><div data-row-key="session:s">Native session</div></span><span id="host"><div data-row-key="session:h">Native host session</div></span></section></body>',{pretendToBeVisual:true});
  const saved={};for(const key of ['document','MutationObserver','requestAnimationFrame','cancelAnimationFrame','CSS'])saved[key]=globalThis[key];
  Object.assign(globalThis,{document:dom.window.document,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),CSS:{escape:s=>s}});
  const callbacks=new Set();const sub=fn=>{callbacks.add(fn);return()=>callbacks.delete(fn);};const tick=()=>new Promise(r=>setTimeout(r,40));
  let state={rooms:[{roomId:'r',name:'Research room',status:'online',sessionId:'h',memberConfig:{workspacePath:'/var/project'},local:{agents:[{agentId:'a',name:'Author',sessionId:'s',state:'idle',online:true}]}}],expandedRooms:{},selected:'r'};
  const actions={select(id){state.selected=id;},toggleRoom(id){state.expandedRooms[id]=state.expandedRooms[id]===false;for(const f of callbacks)f();},async openSession(){}};
  const store={getSnapshot:()=>state,subscribe:sub,actions},native={list:{getSnapshot:()=>({items:[{workspaceId:'w',path:'/private/var/project'}]}),subscribe:sub}},layout={panelInfo:{getSnapshot:()=>({activePanelId:'collab'}),subscribe:sub}};
  let dispose;
  try {
    dispose=installRoomGroups(store,native,layout);await tick();
    const original=document.querySelector('#original'),nativeRow=original.firstElementChild;
    assert.equal(document.querySelectorAll('[data-rm-room-group]').length,1);
    assert.equal(document.querySelector('[data-rm-workspace-rooms]').parentElement,original.parentElement,'group belongs to the workspace section, not the HoverCard span');
    assert.ok(original.hasAttribute('data-rm-grouped-session'));
    assert.ok(document.querySelector('#host').hasAttribute('data-rm-grouped-session'));
    assert.ok(document.querySelector('[data-rm-open-host]'));
    document.querySelector('[aria-label="Collapse room Research room"]').click();await tick();
    assert.equal(document.querySelector('[data-rm-open-agent]'),null);assert.ok(original.isConnected);
    document.querySelector('[aria-label="Expand room Research room"]').click();await tick();
    assert.ok(document.querySelector('[data-rm-open-agent]'));
    // React can replace only its native anchor; the plugin must not remove, duplicate or reparent it.
    const replacement=original.cloneNode(true);original.replaceWith(replacement);await tick();
    assert.ok(replacement.hasAttribute('data-rm-grouped-session'));assert.equal(document.querySelectorAll('[data-rm-room-group]').length,1);
    document.querySelector('[data-row-key="workspace:w"]').setAttribute('aria-expanded','false');await tick();assert.equal(document.querySelector('[data-rm-workspace-rooms]').hidden,true);
    dispose();dispose=null;assert.equal(document.querySelector('[data-rm-workspace-rooms]'),null);assert.ok(!replacement.hasAttribute('data-rm-grouped-session'));assert.ok(replacement.firstElementChild.isSameNode(nativeRow)===false);
  } finally {dispose?.();dom.window.close();for(const key of Object.keys(saved)){if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];}}
});
