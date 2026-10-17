import { sameWorkspacePath } from './files.js';

const ROOM_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M5.5 6.5h5M5.5 9.5h3.5"/></svg>';
const AGENT_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" aria-hidden="true"><rect x="3" y="5" width="10" height="7.5" rx="2"/><path d="M8 2.5V5M6 8.5h.01M10 8.5h.01"/></svg>';

/** Rooms belonging to a native workspace row (by host id or normalized path). */
export function roomsForWorkspace(rooms, workspaceId, workspacePath) {
  return (rooms || []).filter((r) => {
    if (workspaceId && r.hostWorkspaceId && r.hostWorkspaceId === workspaceId) return true;
    return sameWorkspacePath(r.memberConfig?.workspacePath, workspacePath);
  });
}

/** dsh has no workspace-child extension seat. Add only owned nodes; never move React-owned rows.
 * Real tree (ui-workspace): groupSection > HoverCard(span) > workspace row, then session rows.
 * Room groups are first-level peers of sessions under that groupSection. */
export function installRoomGroups(store, native, layout, sessions) {
  if (typeof document === 'undefined' || typeof native?.list?.getSnapshot !== 'function') return () => {};
  const panelInfo = layout?.panelInfo, sessionList = sessions?.list;
  let frame = 0, alive = true;
  const wrappers = new Set();
  const closeMenus = () => { for (const menu of document.querySelectorAll('[data-rm-room-menu]')) { menu.previousElementSibling?.setAttribute('aria-expanded', 'false'); menu.remove(); } };
  const closeOutside = e => { if (!e.target.closest?.('[data-rm-room-menu], [data-rm-room-menu-button]')) closeMenus(); };
  const closeEscape = e => { const menu = document.querySelector('[data-rm-room-menu]'); if (e.key === 'Escape' && menu) { const trigger = menu.previousElementSibling; closeMenus(); trigger?.focus(); e.preventDefault(); e.stopPropagation(); } };
  document.addEventListener('click', closeOutside); document.addEventListener('keydown', closeEscape);
  const markHidden = (row, hidden) => { if (hidden) row.setAttribute('data-rm-grouped-session', ''); else row.removeAttribute('data-rm-grouped-session'); };
  const decorate = () => {
    const state = store.getSnapshot(), workspaces = native.list.getSnapshot()?.items || [];
    const panelActive = panelInfo?.getSnapshot?.()?.activePanelId === 'collab';
    const current = Object.values(sessionList?.getSnapshot?.()?.byId || {}).find(s => (s.retainedBy?.mainView || 0) > 0)?.id;
    const hidden = new Set(), decorated = new Set();
    for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
      const key = row.getAttribute('data-row-key').slice('workspace:'.length);
      const ws = workspaces.find(w => w.workspaceId === key);
      const rooms = roomsForWorkspace(state.rooms, key, ws?.path);
      // Creation lives in the workspace header; child rows are actual rooms only.
      // Real workspace headers are wrapped by the native HoverCard anchor span.
      const anchor = row.parentElement?.tagName === 'SPAN' ? row.parentElement : row;
      const parent = anchor.parentElement;
      if (!parent) continue;
      let group = [...parent.children].find(e => e.getAttribute('data-rm-workspace-rooms') === key);
      if (!rooms.length) { group?.remove(); continue; }
      if (!group) { group = document.createElement('div'); group.className = 'rm-root rm-native-rooms'; group.setAttribute('data-rm-workspace-rooms', key); group.setAttribute('role', 'group'); wrappers.add(group); }
      // Room is a first-level peer of sessions under the workspace: keep the group
      // immediately after the workspace header even after React reorders children.
      if (group.parentElement !== parent || group.previousElementSibling !== anchor) {
        parent.insertBefore(group, anchor.nextSibling);
      }
      decorated.add(group);
      const selectedHere = rooms.some(r => r.roomId === state.selected);
      // Stay visible when this workspace owns the selected room (create/open) even if
      // the native header is still aria-expanded=false — otherwise rooms "vanish".
      group.hidden = row.getAttribute('aria-expanded') === 'false' && !selectedHere;
      const title = ws?.title || ws?.path?.split('/').filter(Boolean).at(-1) || rooms[0]?.memberConfig?.workspaceLabel || key;
      const path = ws?.path || rooms[0]?.memberConfig?.workspacePath || '';
      const signature = JSON.stringify([title, path, panelActive, state.selected, current, rooms.map(r => [r.roomId, r.name, r.status, r.sessionId, r.local?.agents.map(a => [a.agentId, a.name, a.sessionId, a.state, a.online]), state.expandedRooms[r.roomId] !== false])]);
      if (group.getAttribute('data-rm-signature') !== signature) {
        group.setAttribute('data-rm-signature', signature); group.replaceChildren();
        for (const room of rooms) {
          const expanded = state.expandedRooms[room.roomId] !== false;
          const section = document.createElement('div'); section.setAttribute('data-rm-room-group', room.roomId);
          const heading = document.createElement('div'); heading.className = 'rm-native-room-heading';
          const caret = document.createElement('button'); caret.type = 'button'; caret.className = 'rm-native-room-caret'; caret.textContent = expanded ? '⌄' : '›'; caret.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} room ${room.name}`); caret.setAttribute('aria-expanded', String(expanded)); caret.onclick = e => { e.stopPropagation(); store.actions.toggleRoom(room.roomId); };
          const open = document.createElement('button'); open.type = 'button'; open.className = 'rm-native-row'; open.setAttribute('data-rm-open-room', room.roomId); open.setAttribute('aria-current', String(panelActive && state.selected === room.roomId));
          const icon = document.createElement('span'); icon.innerHTML = ROOM_ICON;
          const label = document.createElement('span'); label.className = 'rm-native-row-label'; label.textContent = room.name; open.title = room.name;
          const count = document.createElement('span'); count.className = 'rm-native-row-count'; count.textContent = String((room.local?.agents.length || 0) + (room.sessionId ? 1 : 0));
          open.append(icon, label, count); open.onclick = () => store.actions.select(room.roomId); heading.append(caret, open);
          const actions = document.createElement('button'); actions.type = 'button'; actions.className = 'rm-native-room-menu-button'; actions.textContent = '⋯'; actions.setAttribute('data-rm-room-menu-button', room.roomId); actions.setAttribute('aria-label', `Room actions: ${room.name}`); actions.setAttribute('aria-haspopup', 'menu'); actions.setAttribute('aria-expanded', 'false');
          actions.onclick = e => { e.stopPropagation(); const wasOpen = actions.getAttribute('aria-expanded') === 'true'; closeMenus(); if (wasOpen) return; actions.setAttribute('aria-expanded', 'true'); const menu = document.createElement('div'); menu.className = 'rm-root rm-room-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('data-rm-room-menu', room.roomId);
            for (const [lab, kind] of [['Edit room', 'room-settings'], ['Delete room', 'delete-room']]) { const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.textContent = lab; if (kind === 'delete-room') item.className = 'rm-danger'; item.onclick = event => { event.stopPropagation(); closeMenus(); store.actions.openDialog({ kind, roomId: room.roomId, name: room.name }); }; menu.append(item); } heading.append(menu); menu.firstElementChild?.focus(); };
          heading.append(actions); section.append(heading);
          if (expanded && room.sessionId) {
            const host = document.createElement('button'); host.type = 'button'; host.className = 'rm-native-row rm-native-agent'; host.textContent = 'Room session'; host.setAttribute('data-rm-open-host', room.roomId); host.setAttribute('aria-current', String(!panelActive && current === room.sessionId)); host.onclick = () => { try { store.actions.openRoomSession(room.roomId); } catch (e) { store.actions.toast(e.message); } }; section.append(host);
          }
          if (expanded) for (const agent of room.local?.agents || []) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'rm-native-row rm-native-agent'; button.setAttribute('data-rm-open-agent', agent.agentId); button.setAttribute('aria-current', String(!panelActive && current === agent.sessionId)); button.title = `${agent.name} · native dsh session`;
            const glyph = document.createElement('span'); glyph.innerHTML = AGENT_ICON; const agTitle = document.createElement('span'); agTitle.className = 'rm-native-row-label'; agTitle.textContent = agent.name;
            button.append(glyph, agTitle);
            if (agent.state && agent.state !== 'idle') { const status = document.createElement('span'); status.className = 'rm-native-row-count'; status.textContent = agent.state; button.append(status); }
            button.onclick = () => { button.disabled = true; store.actions.openSession(room.roomId, agent.agentId).catch(e => store.actions.toast(e.message)).finally(() => { button.disabled = false; }); }; section.append(button);
          }
          group.append(section);
        }
      }
      // Keep the real rows mounted for native menus, search and lifetimes, but show one grouped copy.
      for (const room of rooms) if (room.sessionId) for (const sessionRow of parent.querySelectorAll(`[data-row-key="session:${CSS.escape(room.sessionId)}"]`)) hidden.add(sessionRow.parentElement?.tagName === 'SPAN' ? sessionRow.parentElement : sessionRow);
      for (const room of rooms) for (const agent of room.local?.agents || []) {
        if (!agent.sessionId) continue;
        for (const sessionRow of parent.querySelectorAll(`[data-row-key="session:${CSS.escape(agent.sessionId)}"]`)) hidden.add(sessionRow.parentElement?.tagName === 'SPAN' ? sessionRow.parentElement : sessionRow);
      }
    }
    for (const row of document.querySelectorAll('[data-rm-grouped-session]')) if (!hidden.has(row)) markHidden(row, false);
    for (const row of hidden) if (!row.hasAttribute('data-rm-grouped-session')) markHidden(row, true);
    for (const wrapper of wrappers) if (!wrapper.isConnected || !decorated.has(wrapper)) { wrapper.remove(); wrappers.delete(wrapper); }
  };
  const schedule = () => { if (alive && !frame) frame = requestAnimationFrame(() => { frame = 0; decorate(); }); };
  const observer = new MutationObserver(schedule); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
  const unsubscribers = [store, native.list, panelInfo, sessionList]
    .filter(source => typeof source?.subscribe === 'function')
    .map(source => source.subscribe(schedule)).filter(off => typeof off === 'function');
  // Backup poll: React can replace groupSection children without a subscribe tick.
  const poll = typeof globalThis.setInterval === 'function' ? globalThis.setInterval(schedule, 1000) : null;
  schedule();
  return () => { alive = false; observer.disconnect(); if (poll && typeof globalThis.clearInterval === 'function') globalThis.clearInterval(poll); closeMenus(); document.removeEventListener('click', closeOutside); document.removeEventListener('keydown', closeEscape); for (const off of unsubscribers) off(); if (frame) cancelAnimationFrame(frame); for (const wrapper of wrappers) wrapper.remove(); for (const row of document.querySelectorAll('[data-rm-grouped-session]')) markHidden(row, false); };
}
