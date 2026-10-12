import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomsStore} from '../src/client/store.js';

test('preview opens the author native session before its file; later navigation cancels an old response',async()=>{
  const original=globalThis.fetch;
  const opened=[];let mounted;
  const store=createRoomsStore();
  store.uiWorkspace={openSession(id){opened.push(['session',id]);mounted=id;}};
  store.sidebarRight={mounted:{getSnapshot:()=>mounted},openResource(address,opts){opened.push(['file',address,opts]);}};
  try {
    globalThis.fetch=async()=>({ok:true,text:async()=>JSON.stringify({sessionId:'author-session',path:'/project/.dsh-room/worktree/report #1.md'})});
    await store.actions.preview('room','report #1.md','author',12);
    assert.deepEqual(opened,[['session','author-session'],['file','dsh-resource://file/session/author-session//project/.dsh-room/worktree/report%20%231.md',{params:{line:12}}]]);
    let release;globalThis.fetch=url=>String(url).endsWith('/preview')?new Promise(r=>{release=()=>r({ok:true,text:async()=>JSON.stringify({sessionId:'old-session',path:'/old.md'})});}):Promise.resolve({ok:true,text:async()=>JSON.stringify({messages:[]})});
    const pending=store.actions.preview('room','old.md');
    store.actions.select('another-room');release();await pending;
    assert.equal(opened.length,2,'a stale preview cannot replace the later room navigation');
  } finally {globalThis.fetch=original;store.dispose();}
});

test('shared room output uses the owning native workspace and waits for the preview store',async()=>{
  const original=globalThis.fetch;const store=createRoomsStore();const opened=[];let mounted;
  try {
    globalThis.fetch=async()=>({ok:true,text:async()=>JSON.stringify({path:'/private/var/project/report.html',workspacePath:'/var/project'})});
    store.native={list:{getSnapshot:()=>({items:[{workspaceId:'w',path:'/private/var/project'}]})}};
    store.uiWorkspace={async openWorkspace(id,before){assert.equal(id,'w');before('blank-session');setTimeout(()=>{mounted='blank-session';},30);}};
    store.sidebarRight={mounted:{getSnapshot:()=>mounted},openResource(address){opened.push(address);}};
    await store.actions.preview('room','report.html');
    assert.deepEqual(opened,['dsh-resource://file/session/blank-session//private/var/project/report.html']);
  } finally {globalThis.fetch=original;store.dispose();}
});
