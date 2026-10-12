import { sameWorkspacePath } from './files.js';

const ROOM_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M5.5 6.5h5M5.5 9.5h3.5"/></svg>';
const AGENT_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" aria-hidden="true"><rect x="3" y="5" width="10" height="7.5" rx="2"/><path d="M8 2.5V5M6 8.5h.01M10 8.5h.01"/></svg>';

/** dsh has no workspace-child extension seat. Add only owned nodes; never move React-owned rows. */
export function installRoomGroups(store, native, layout, sessions) {
  if (typeof document === 'undefined' || typeof native?.list?.getSnapshot !== 'function') return () => {};
  // Optional client services differ across dsh runtimes. Their presence does not
  // guarantee that a snapshot store (or its subscription method) is available.
  const panelInfo=layout?.panelInfo,sessionList=sessions?.list;
  let frame=0,alive=true;
  const wrappers=new Set();
  const markHidden=(row,hidden)=>{if(hidden)row.setAttribute('data-rm-grouped-session','');else row.removeAttribute('data-rm-grouped-session');};
  const decorate=()=>{
    const state=store.getSnapshot(),workspaces=native.list.getSnapshot()?.items||[];
    const panelActive=panelInfo?.getSnapshot?.()?.activePanelId==='collab';
    const current=Object.values(sessionList?.getSnapshot?.()?.byId||{}).find(s=>(s.retainedBy?.mainView||0)>0)?.id;
    const hidden=new Set();
    for(const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
      const key=row.getAttribute('data-row-key').slice('workspace:'.length);
      const ws=workspaces.find(w=>w.workspaceId===key);
      const rooms=ws?(state.rooms||[]).filter(r=>sameWorkspacePath(r.memberConfig?.workspacePath,ws.path)):[];
      // Real workspace headers are wrapped by the native HoverCard anchor span.
      const anchor=row.parentElement?.tagName==='SPAN'?row.parentElement:row;
      const parent=anchor.parentElement;
      if(!parent)continue;
      let group=[...parent.children].find(e=>e.getAttribute('data-rm-workspace-rooms')===key);
      if(!rooms.length){group?.remove();continue;}
      if(!group){group=document.createElement('div');group.className='rm-root rm-native-rooms';group.setAttribute('data-rm-workspace-rooms',key);group.setAttribute('role','group');parent.insertBefore(group,anchor.nextSibling);wrappers.add(group);}
      group.hidden=row.getAttribute('aria-expanded')==='false';
      const signature=JSON.stringify([panelActive,state.selected,current,rooms.map(r=>[r.roomId,r.name,r.status,r.sessionId,r.local?.agents.map(a=>[a.agentId,a.name,a.sessionId,a.state,a.online]),state.expandedRooms[r.roomId]!==false])]);
      if(group.getAttribute('data-rm-signature')!==signature){
        group.setAttribute('data-rm-signature',signature);group.replaceChildren();
        for(const room of rooms){
          const expanded=state.expandedRooms[room.roomId]!==false;
          const section=document.createElement('div');section.setAttribute('data-rm-room-group',room.roomId);
          const heading=document.createElement('div');heading.className='rm-native-room-heading';
          const caret=document.createElement('button');caret.type='button';caret.className='rm-native-room-caret';caret.textContent=expanded?'⌄':'›';caret.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} room ${room.name}`);caret.setAttribute('aria-expanded',String(expanded));caret.onclick=e=>{e.stopPropagation();store.actions.toggleRoom(room.roomId);};
          const open=document.createElement('button');open.type='button';open.className='rm-native-row';open.setAttribute('data-rm-open-room',room.roomId);open.setAttribute('aria-current',String(panelActive&&state.selected===room.roomId));
          const icon=document.createElement('span');icon.innerHTML=ROOM_ICON;
          const label=document.createElement('span');label.className='rm-native-row-label';label.textContent=room.name;open.title=room.name;
          const count=document.createElement('span');count.className='rm-native-row-count';count.textContent=String((room.local?.agents.length||0)+(room.sessionId?1:0));
          open.append(icon,label,count);open.onclick=()=>store.actions.select(room.roomId);heading.append(caret,open);section.append(heading);
          if(expanded&&room.sessionId){
            const host=document.createElement('button');host.type='button';host.className='rm-native-row rm-native-agent';host.textContent='Room session';host.setAttribute('data-rm-open-host',room.roomId);host.setAttribute('aria-current',String(!panelActive&&current===room.sessionId));host.onclick=()=>{try{store.actions.openRoomSession(room.roomId);}catch(e){store.actions.toast(e.message);}};section.append(host);
          }
          if(expanded)for(const agent of room.local?.agents||[]){
            const button=document.createElement('button');button.type='button';button.className='rm-native-row rm-native-agent';button.setAttribute('data-rm-open-agent',agent.agentId);button.setAttribute('aria-current',String(!panelActive&&current===agent.sessionId));button.title=`${agent.name} · native dsh session`;
            const glyph=document.createElement('span');glyph.innerHTML=AGENT_ICON;const title=document.createElement('span');title.className='rm-native-row-label';title.textContent=agent.name;
            button.append(glyph,title);
            if(agent.state&&agent.state!=='idle'){const status=document.createElement('span');status.className='rm-native-row-count';status.textContent=agent.state;button.append(status);}
            button.onclick=()=>{button.disabled=true;store.actions.openSession(room.roomId,agent.agentId).catch(e=>store.actions.toast(e.message)).finally(()=>{button.disabled=false;});};section.append(button);
          }
          group.append(section);
        }
      }
      // Keep the real rows mounted for native menus, search and lifetimes, but show one grouped copy.
      for(const room of rooms)if(room.sessionId)for(const sessionRow of parent.querySelectorAll(`[data-row-key="session:${CSS.escape(room.sessionId)}"]`))hidden.add(sessionRow.parentElement?.tagName==='SPAN'?sessionRow.parentElement:sessionRow);
      for(const room of rooms)for(const agent of room.local?.agents||[]){
        if(!agent.sessionId)continue;
        for(const sessionRow of parent.querySelectorAll(`[data-row-key="session:${CSS.escape(agent.sessionId)}"]`))hidden.add(sessionRow.parentElement?.tagName==='SPAN'?sessionRow.parentElement:sessionRow);
      }
    }
    for(const row of document.querySelectorAll('[data-rm-grouped-session]'))if(!hidden.has(row))markHidden(row,false);
    for(const row of hidden)if(!row.hasAttribute('data-rm-grouped-session'))markHidden(row,true);
    for(const wrapper of wrappers)if(!wrapper.isConnected)wrappers.delete(wrapper);
  };
  const schedule=()=>{if(alive&&!frame)frame=requestAnimationFrame(()=>{frame=0;decorate();});};
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-expanded']});
  const unsubscribers=[store,native.list,panelInfo,sessionList]
    .filter(source=>typeof source?.subscribe==='function')
    .map(source=>source.subscribe(schedule)).filter(off=>typeof off==='function');
  schedule();
  return ()=>{alive=false;observer.disconnect();for(const off of unsubscribers)off();if(frame)cancelAnimationFrame(frame);for(const wrapper of wrappers)wrapper.remove();for(const row of document.querySelectorAll('[data-rm-grouped-session]'))markHidden(row,false);};
}
