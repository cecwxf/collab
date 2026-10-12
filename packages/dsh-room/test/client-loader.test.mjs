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
    const modules=new Map(),cleanup=[];let streams=0;
    class EventSource {constructor(){streams++;}addEventListener(){}close(){streams--;}}
    const sandbox={EventSource,fetch:async()=>({ok:true,text:async()=>JSON.stringify({rooms:[]})}),window:{__ModuleLoader__:{load({id,factory}){modules.set(id,factory(()=>({})));}}},document:dom.window.document,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),setTimeout,clearTimeout};
    try {
      vm.runInNewContext(code,sandbox);
      const client=modules.get('@cecwxf/dsh-room');
      assert.ok(client.inject.includes('sessions'),'service initialization must precede plugin apply');
      const ctx={...services,get(name){return services[name];},effect(fn){const off=fn();if(typeof off==='function')cleanup.push(off);},slots:{inject(name,fn){fn();},register(){}}};
      assert.doesNotThrow(()=>client.apply(ctx),'loader must not throw when list.subscribe is missing');
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

