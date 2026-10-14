import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installRoomGroups, roomsForWorkspace } from '../src/client/workspace-rooms.js';
import { sameWorkspacePath, normalizeWorkspacePath } from '../src/client/files.js';

function tick(ms = 40) { return new Promise(r => setTimeout(r, ms)); }

/** Real ui-workspace shape: AnimatedRows > groupSection > HoverCard(span) > workspace row, then sessions. */
function mountTree(domHtml) {
  const dom = new JSDOM(domHtml, { pretendToBeVisual: true });
  const saved = {};
  for (const key of ['document', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSS']) saved[key] = globalThis[key];
  Object.assign(globalThis, {
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    CSS: { escape: s => s },
  });
  return {
    dom,
    restore() {
      dom.window.close();
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete globalThis[key];
        else globalThis[key] = saved[key];
      }
    },
  };
}

const TREE = `<body><div class="list"><div class="groupSection" style="--dsh-workspace-indent:0px">
  <span class="hover"><div data-row-key="workspace:native-w1" aria-expanded="true" role="treeitem">Project A</div></span>
  <span id="sess"><div data-row-key="session:s1">Session one</div></span>
</div>
<div class="groupSection">
  <span class="hover"><div data-row-key="workspace:native-w2" aria-expanded="true" role="treeitem">Project B</div></span>
</div></div></body>`;

test('normalize treats /private/var and /private/tmp alike', () => {
  assert.equal(normalizeWorkspacePath('/private/var/folders/x'), '/var/folders/x');
  assert.equal(normalizeWorkspacePath('/private/tmp/x'), '/tmp/x');
  assert.ok(sameWorkspacePath('/private/var/project', '/var/project'));
  assert.ok(sameWorkspacePath('/private/tmp/p', '/tmp/p'));
});

test('roomsForWorkspace matches hostWorkspaceId even when paths differ', () => {
  const rooms = [
    { roomId: 'r1', hostWorkspaceId: 'native-w1', memberConfig: { workspacePath: '/elsewhere' } },
    { roomId: 'r2', memberConfig: { workspacePath: '/Users/me/b' } },
  ];
  assert.deepEqual(roomsForWorkspace(rooms, 'native-w1', '/Users/me/a').map(r => r.roomId), ['r1']);
  assert.deepEqual(roomsForWorkspace(rooms, 'native-w2', '/Users/me/b').map(r => r.roomId), ['r2']);
});

test('after create upsert, room appears under the native workspace as session sibling', async () => {
  const { restore } = mountTree(TREE);
  const callbacks = new Set();
  const sub = fn => { callbacks.add(fn); return () => callbacks.delete(fn); };
  let state = {
    rooms: [],
    expandedRooms: {},
    selected: null,
  };
  const actions = {
    openDialog() {},
    select(id) { state.selected = id; for (const f of callbacks) f(); },
    toggleRoom() {},
    async openSession() {},
  };
  const store = { getSnapshot: () => state, subscribe: sub, actions };
  const native = {
    list: {
      getSnapshot: () => ({
        items: [
          { workspaceId: 'native-w1', path: '/Users/me/project-a', title: 'Project A' },
          { workspaceId: 'native-w2', path: '/Users/me/project-b', title: 'Project B' },
        ],
      }),
      subscribe: sub,
    },
  };
  const layout = { panelInfo: { getSnapshot: () => ({ activePanelId: 'collab' }), subscribe: sub } };
  let dispose;
  try {
    dispose = installRoomGroups(store, native, layout, {});
    await tick();
    // Before create: New room shortcut under each workspace, no room groups yet.
    assert.equal(document.querySelectorAll('[data-rm-new-room-shortcut]').length, 2);
    assert.equal(document.querySelectorAll('[data-rm-room-group]').length, 0);

    // Simulate create upsert (what store.actions.create does).
    state = {
      ...state,
      selected: 'room-1',
      rooms: [{
        roomId: 'room-1',
        name: 'release-crew',
        status: 'connecting',
        hostWorkspaceId: 'native-w1',
        memberConfig: { workspacePath: '/Users/me/project-a', workspaceLabel: 'Project A' },
        local: { agents: [{ agentId: 'a1', name: 'Author', sessionId: null, state: 'idle', online: false }] },
      }],
    };
    for (const f of callbacks) f();
    await tick();

    const group = document.querySelector('[data-rm-workspace-rooms="native-w1"]');
    assert.ok(group, 'room group must exist under workspace native-w1');
    assert.equal(group.parentElement.className, 'groupSection');
    const wsAnchor = document.querySelector('[data-row-key="workspace:native-w1"]').parentElement;
    assert.equal(group.previousElementSibling, wsAnchor, 'room group is first sibling after workspace header');
    assert.ok(document.querySelector('[data-rm-open-room="room-1"]'), 'created room row visible');
    assert.equal(document.querySelector('[data-rm-open-room="room-1"]').textContent.includes('release-crew'), true);
    // Not under the other workspace
    assert.equal(document.querySelector('[data-rm-workspace-rooms="native-w2"]')?.querySelector('[data-rm-room-group]'), null);

    // React inserts a new session between header and room group — must re-anchor.
    const injected = document.createElement('span');
    injected.innerHTML = '<div data-row-key="session:new">Injected</div>';
    group.parentElement.insertBefore(injected, group);
    for (const f of callbacks) f();
    await tick();
    assert.equal(document.querySelector('[data-rm-workspace-rooms="native-w1"]').previousElementSibling, wsAnchor);

    // Collapsed workspace still shows the group while the room is selected.
    document.querySelector('[data-row-key="workspace:native-w1"]').setAttribute('aria-expanded', 'false');
    for (const f of callbacks) f();
    await tick();
    assert.equal(document.querySelector('[data-rm-workspace-rooms="native-w1"]').hidden, false, 'selected room keeps group visible when collapsed');
  } finally {
    dispose?.();
    restore();
  }
});

test('path-only rooms (no hostWorkspaceId) still bind via normalized path', async () => {
  const { restore } = mountTree(TREE);
  const callbacks = new Set();
  const sub = fn => { callbacks.add(fn); return () => callbacks.delete(fn); };
  const state = {
    rooms: [{
      roomId: 'legacy',
      name: 'legacy-room',
      status: 'online',
      memberConfig: { workspacePath: '/private/var/project-a' }, // will not match /Users — use w1 path variant
      local: { agents: [] },
    }],
    expandedRooms: {},
    selected: 'legacy',
  };
  // Put matching path on native-w1 as /var form vs /private/var on room — use same project path spelling via private/var on both
  const store = { getSnapshot: () => state, subscribe: sub, actions: { openDialog() {}, select() {}, toggleRoom() {}, async openSession() {} } };
  const native = {
    list: {
      getSnapshot: () => ({ items: [{ workspaceId: 'native-w1', path: '/var/project-a', title: 'A' }, { workspaceId: 'native-w2', path: '/Users/me/project-b', title: 'B' }] }),
      subscribe: sub,
    },
  };
  // Fix room path to match normalize pair
  state.rooms[0].memberConfig.workspacePath = '/private/var/project-a';
  let dispose;
  try {
    dispose = installRoomGroups(store, native, { panelInfo: { getSnapshot: () => ({ activePanelId: 'collab' }), subscribe: sub } }, {});
    await tick();
    assert.ok(document.querySelector('[data-rm-workspace-rooms="native-w1"] [data-rm-open-room="legacy"]'));
  } finally {
    dispose?.();
    restore();
  }
});
