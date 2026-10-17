import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

test('published client loader applies with absent optional snapshot stores and declares session initialization ordering', async()=>{
  const code=await readFile(new URL('../dist/client.js',import.meta.url),'utf8');
  for(const services of [
    {workspaces:{list:{getSnapshot:()=>({items:[]}),subscribe:()=>()=>{}}},sessions:{},layout:{}},
    {workspaces:{},sessions:{list:{}},layout:{panelInfo:{}}},
    {workspaces:{list:{getSnapshot:()=>({items:[]})}},layout:{panelInfo:{getSnapshot:()=>({})}}},
  ]){
    const dom=new JSDOM('<body><div data-row-key="workspace:w"></div></body>',{pretendToBeVisual:true});
    const modules=new Map(),cleanup=[],registered=[];let streams=0;
    class EventSource {constructor(){streams++;}addEventListener(){}close(){streams--;}}
    const sandbox={EventSource,fetch:async()=>({ok:true,text:async()=>JSON.stringify({rooms:[]})}),window:{__ModuleLoader__:{load({id,factory}){modules.set(id,factory(()=>({})));}}},document:dom.window.document,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),setTimeout,clearTimeout};
    try {
      vm.runInNewContext(code,sandbox);
      const client=modules.get('@cecwxf/dsh-room');
      assert.ok(client.inject.includes('sessions'),'service initialization must precede plugin apply');
      const ctx={...services,get(name){return services[name];},effect(fn){const off=fn();if(typeof off==='function')cleanup.push(off);},slots:{inject(name,fn){fn();},register(options){registered.push(options);}}};
      assert.doesNotThrow(()=>client.apply(ctx),'loader must not throw when list.subscribe is missing');
      assert.ok(!registered.some(slot=>slot.name==='sidebar.panellist'),'rooms must not add a standalone sidebar entry');
      assert.ok(registered.some(slot=>slot.name==='main'&&slot.key==='collab'),'workspace rows can still open room content');
      await new Promise(resolve=>setTimeout(resolve,40));
      assert.equal(dom.window.document.querySelector('[data-rm-workspace-rooms]'),null);
    } finally {
      for(const off of cleanup.reverse())off();
      assert.equal(dom.window.document.querySelector('style'),null);
      assert.equal(streams,0,'plugin disposal leaves no SSE stream');
      dom.window.close();
    }
  }
});


test('native workspace toolbar has a persistent New room shortcut in Chinese and English and restores on unload',async()=>{
 const code=(await readFile(new URL('../dist/client.js',import.meta.url),'utf8')).replaceAll('return module.exports;','return { ...module.exports, installWorkspaceDecorator };');
 for(const label of ['添加工作区','Add workspace']){
  const dom=new JSDOM(`<body><div class="native_headerActions"><button aria-label="${label}">Add</button></div></body>`,{pretendToBeVisual:true});let client,dialog;
  const sandbox={window:{__ModuleLoader__:{load({id,factory}){if(id==='@cecwxf/dsh-room')client=factory(()=>({}));}}},document:dom.window.document,Element:dom.window.Element,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)};
  vm.runInNewContext(code,sandbox);const off=client.installWorkspaceDecorator({}, {}, ws=>{dialog={kind:'create',workspace:ws};});
  try {await new Promise(r=>setTimeout(r,40));const button=dom.window.document.querySelector('[data-rm-ws-global-room]');assert.ok(button,'toolbar shortcut must exist even in flat session view');button.click();assert.equal(dialog.kind,'create');assert.equal(dialog.workspace,undefined);}finally{off();assert.equal(dom.window.document.querySelector('[data-rm-ws-global-room]'),null);assert.ok(dom.window.document.querySelector(`[aria-label="${label}"]`));dom.window.close();}
 }
});

test('workspace menu owns create, invite and discovery actions and removes them on unload', async () => {
  const code=(await readFile(new URL('../dist/client.js',import.meta.url),'utf8')).replaceAll('return module.exports;','return { ...module.exports, installWorkspaceDecorator };');
  const dom=new JSDOM('<body><div data-row-key="workspace:chosen"><button id="menu">Workspace actions</button><button aria-label="New session in Project">New session</button></div><div role="menu"><button role="menuitem">Native action</button></div></body>',{pretendToBeVisual:true});
  let client,dialog;
  const ws={workspaceId:'chosen',path:'/project-b',title:'Project B'};
  const store={actions:{openDialog(value){dialog=value;}}};
  const sandbox={window:{__ModuleLoader__:{load({id,factory}){if(id==='@cecwxf/dsh-room')client=factory(()=>({}));}}},document:dom.window.document,Element:dom.window.Element,CSS:{escape:s=>s},MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)};
  vm.runInNewContext(code,sandbox);
  const off=client.installWorkspaceDecorator(store,{list:{getSnapshot:()=>({items:[ws]})}},workspace=>store.actions.openDialog({kind:'create',workspace}));
  try {
    dom.window.document.querySelector('#menu').click();await new Promise(r=>setTimeout(r,40));
    for(const [label,kind] of [['New room','create'],['Join room by invite','join'],['Browse public rooms','browse']]){
      const item=[...dom.window.document.querySelectorAll('[data-rm-ws-menu]')].find(e=>e.textContent===label);assert.ok(item);item.click();
      assert.equal(dialog.kind,kind);assert.equal(dialog.workspace.id,'chosen');assert.equal(dialog.workspace.path,'/project-b');
    }
  } finally {off();assert.equal(dom.window.document.querySelector('[data-rm-ws-menu]'),null);assert.ok(dom.window.document.querySelector('[role=menuitem]'),'native menu remains');dom.window.close();}
});
