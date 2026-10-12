import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
async function renderComposer(status){
  const code=(await readFile(new URL('../dist/client.js',import.meta.url),'utf8')).replaceAll('return module.exports;','return { ...module.exports, Composer };');
  let client;const sent=[];let draft='review draft';
  const react={useState:initial=>[initial,()=>{}],useRef:initial=>({current:initial}),useEffect(){},useSyncExternalStore:(subscribe,snapshot)=>snapshot()};
  const jsx=(type,props)=>({type,props});
  vm.runInNewContext(code,{window:{__ModuleLoader__:{load({id,factory}){if(id==='@cecwxf/dsh-room')client=factory(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{});}}}});
  const node=client.Composer({room:{roomId:'r',name:'Offline fixture',status,error:'WebSocket connect timeout',members:[],memberConfig:{}},store:{getSnapshot:()=>({models:[]}),subscribe(){},actions:{async send(...args){sent.push(args);},toast(){}}},draft,setDraft:value=>{draft=value;}});
  const nodes=[];function walk(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}nodes.push(node);walk(node.props?.children);}walk(node);
  return {nodes,sent,get draft(){return draft;}};
}
test('offline and connecting composers allow draft editing but block sends including Enter',async()=>{
  for(const status of ['offline','connecting']){
    const view=await renderComposer(status),textarea=view.nodes.find(n=>n.type==='textarea'),send=view.nodes.find(n=>n.props?.['aria-label']==='Send');
    assert.equal(!!textarea.props.disabled,false,'offline room must not make its draft field uneditable');
    assert.equal(send.props.disabled,true);
    textarea.props.onChange({target:{value:'saved offline draft',selectionStart:19}});assert.equal(view.draft,'saved offline draft');
    textarea.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){}});await Promise.resolve();assert.equal(view.sent.length,0,'Enter must not bypass the offline send guard');
  }
});
test('online composer submits a message and clears the submitted draft',async()=>{
  const view=await renderComposer('online'),send=view.nodes.find(n=>n.props?.['aria-label']==='Send');assert.equal(send.props.disabled,false);await send.props.onClick();assert.equal(view.sent.length,1);assert.equal(view.draft,'');
});
