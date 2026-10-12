// Tiny external store for the Rooms UI: /api/collab JSON + SSE.
import { sameWorkspacePath, sessionFileAddress } from './files.js';
export const API = "/api/collab";

async function call(path, init) {
  let res;
  try {
    res = await fetch(API + path, { credentials: "same-origin", ...init, headers: { ...(init && init.body ? { "content-type": "application/json" } : {}), ...((init && init.headers) || {}) } });
  } catch (e) {
    const msg = (e && e.name === "AbortError") ? "Request timed out or was cancelled" : ((e && e.message) || "network error");
    throw new Error(msg);
  }
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text.slice(0, 300) || res.statusText }; }
  if (!res.ok) {
    const detail = body.error || body.message || (typeof body.raw === "string" ? body.raw : "") || `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }
  return body;
}
const post = (path, body, init) => call(path, { method: "POST", body: JSON.stringify(body || {}), ...(init || {}) });

export function createRoomsStore() {
  let snap = {
    version: null, self: null, relayUrl: "", lanRelayPort: null, workspaces: [], activeWorkspaceId: null, rooms: [], activeRoomId: null, connected: false,
    selected: null, messages: {}, dialog: null, toast: null, approvals: [],
    search: { open: false, query: "", results: [], loading: false, error: null },
    detailsOpen: false, expandedRooms: {},
  };
  const subs = new Set();
  const set = (patch) => { snap = { ...snap, ...(typeof patch === "function" ? patch(snap) : patch) }; for (const s of subs) s(); };
  let es = null;
  let searchTimer = null;
  let navigation = 0;

  function connect() {
    if (es) return;
    es = new EventSource(API + "/stream");
    es.addEventListener("rooms", (e) => {
      const st = JSON.parse(e.data);
      set((s) => {
        const selected = s.selected && st.rooms.some((r) => r.roomId === s.selected) ? s.selected : st.activeRoomId || (st.rooms[0] && st.rooms[0].roomId) || null;
        return { ...st, connected: true, selected };
      });
      const sel = snap.selected;
      if (sel && !snap.messages[sel]) void loadMessages(sel);
    });
    es.addEventListener("message", (e) => {
      const { roomId, message } = JSON.parse(e.data);
      set((s) => {
        const cur = s.messages[roomId];
        if (!cur || cur.some((m) => m.id === message.id)) return {};
        return { messages: { ...s.messages, [roomId]: [...cur, message].sort((a, b) => a.ts - b.ts) } };
      });
    });
    es.onerror = () => set({ connected: false });
  }

  async function loadMessages(roomId) {
    try {
      const r = await call(`/rooms/${encodeURIComponent(roomId)}/messages`);
      set((s) => ({ messages: { ...s.messages, [roomId]: r.messages } }));
    } catch (e) { toast(e.message); }
  }
  function toast(text) { set({ toast: text }); }

  async function runSearch(query) {
    set((s) => ({ search: { ...s.search, loading: true, error: null } }));
    try {
      const q = query.trim();
      const tag = (/(^|\s)#([\w-]+)/.exec(q) || [])[2];
      const text = q.replace(/(^|\s)#[\w-]+/g, " ").trim();
      const p = new URLSearchParams();
      if (text) p.set("q", text);
      if (tag) p.set("tag", tag);
      const r = await call(`/directory?${p}`);
      const rooms = Array.isArray(r.rooms) ? r.rooms.map((x) => ({
        ...x,
        tags: Array.isArray(x.tags) ? x.tags : [],
        members: typeof x.members === "number" ? x.members : 0,
        description: x.description || "",
      })) : [];
      set((s) => (s.search.query === query ? { search: { ...s.search, results: rooms, loading: false, error: null } } : {}));
    } catch (e) {
      set((s) => ({ search: { ...s.search, loading: false, error: e.message } }));
    }
  }

  const actions = {
    select(roomId) {
      navigation++;
      try { api.onRoomOpened && api.onRoomOpened(); } catch { /* layout busy */ }
      set({ selected: roomId });
      if (!snap.messages[roomId]) void loadMessages(roomId);
      void post(`/rooms/${encodeURIComponent(roomId)}/active`).catch(() => {});
    },
    openDialog(dialog) { set({ dialog }); },
    closeDialog() { set({ dialog: null }); },
    toggleDetails() { set(s => ({ detailsOpen: !s.detailsOpen })); },
    toggleRoom(roomId) { set(s => ({ expandedRooms: { ...s.expandedRooms, [roomId]: s.expandedRooms[roomId] === false } })); },
    toast,
    clearToast() { set({ toast: null }); },
    setSearchOpen(open) {
      set((s) => ({ search: { ...s.search, open, query: open ? s.search.query : "", results: open ? s.search.results : [] } }));
      if (open) void runSearch(snap.search.query);
    },
    setQuery(query) {
      set((s) => ({ search: { ...s.search, query } }));
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void runSearch(query), 300);
    },
    async create(form, opts) {
      const ac = opts && opts.signal ? null : new AbortController();
      const signal = (opts && opts.signal) || ac.signal;
      const timer = ac ? setTimeout(() => ac.abort(), (opts && opts.timeoutMs) || 12_000) : null;
      try {
        const r = await post("/rooms", { ...form, workspaceId: form.workspacePath ? undefined : (form.workspaceId || snap.activeWorkspaceId) }, { signal });
        try { api.onRoomOpened && api.onRoomOpened(); } catch { /* layout busy */ }
        set({ selected: r.roomId, dialog: { kind: "invite", roomId: r.roomId, name: r.name, invite: r.invite, public: r.public, listed: r.listed } });
        void loadMessages(r.roomId);
        return r;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async join(invite, info) {
      const r = await post("/join", { invite, ...(info && info.workspacePath ? {} : { workspaceId: snap.activeWorkspaceId }), ...(info || {}) });
      try { api.onRoomOpened && api.onRoomOpened(); } catch { /* layout busy */ }
      set((s) => ({ selected: r.roomId, dialog: null, search: { ...s.search, results: s.search.results.map((x) => (x.roomId === r.roomId ? { ...x, joined: true } : x)) } }));
      void loadMessages(r.roomId);
      toast(`Joined ${r.name}`);
      return r;
    },
    async deleteRoom(roomId) {
      const result = await post(`/rooms/${encodeURIComponent(roomId)}/delete`);
      navigation++;
      set(s => { const messages = { ...s.messages }; delete messages[roomId]; const rooms = s.rooms.filter(r => r.roomId !== roomId); return { rooms, messages, selected: s.selected === roomId ? rooms[0]?.roomId || null : s.selected, dialog: null }; });
      toast(result.directoryWarning ? `Room deleted from this dsh · ${result.directoryWarning}` : "Room deleted from this dsh");
    },
    async leave(roomId) {
      await post(`/rooms/${encodeURIComponent(roomId)}/leave`);
      set((s) => { const m = { ...s.messages }; delete m[roomId]; return { messages: m, selected: s.selected === roomId ? null : s.selected, dialog: null }; });
      toast("Left the room");
    },
    async send(roomId, text) { return post(`/rooms/${encodeURIComponent(roomId)}/send`, { text }); },
    async task(roomId, title, assignee, body) { return post(`/rooms/${encodeURIComponent(roomId)}/task`, { title, assignee, body }); },
    async invite(roomId) { return (await call(`/rooms/${encodeURIComponent(roomId)}/invite`)).invite; },
    async browseLan() { return call("/lan/browse"); },
    async ensureWorkspace(form) {
      const w = await post("/workspaces", form);
      set((s) => ({ activeWorkspaceId: w.id, workspaces: s.workspaces.some((x) => x.id === w.id) ? s.workspaces.map((x) => (x.id === w.id ? w : x)) : [w, ...s.workspaces] }));
      return w;
    },
    async setActiveWorkspace(id) {
      const w = await post("/workspaces/active", { id });
      set({ activeWorkspaceId: id, selected: null });
      return w;
    },

    async getConfig(roomId) { return call(`/rooms/${encodeURIComponent(roomId)}/config`); },
    async saveConfig(roomId, patch) { return post(`/rooms/${encodeURIComponent(roomId)}/config`, patch); },
    async decideApproval(requestId, decision) { return post("/approvals/decide", { requestId, decision }); },
    async mcp(roomId, tool, args, target) { return post(`/rooms/${encodeURIComponent(roomId)}/mcp`, { tool, args, target }); },
    // ── local multi-agent ──
    async presets() { return (await call("/presets")).presets; },
    async addAgent(roomId, body) { return post(`/rooms/${encodeURIComponent(roomId)}/agents`, body); },
    async updateAgent(roomId, id, body) { return post(`/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(id)}`, body); },
    async removeAgent(roomId, id) { return post(`/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(id)}?op=delete`); },
    async saveLocal(roomId, patch) { return post(`/rooms/${encodeURIComponent(roomId)}/local`, patch); },
    async saveRoom(roomId, patch) {
      const room = await post(`/rooms/${encodeURIComponent(roomId)}/settings`, patch);
      set(s => ({ rooms: s.rooms.map(r => r.roomId === roomId ? room : r) }));
      return room;
    },
    async reconnect(roomId) {
      const room = await post(`/rooms/${encodeURIComponent(roomId)}/reconnect`);
      set(s => ({ rooms: s.rooms.map(r => r.roomId === roomId ? room : r) }));
      return room;
    },
    async setTransport(roomId, target, force) { return post(`/rooms/${encodeURIComponent(roomId)}/transport`, { target, force: !!force }); },
    async stop(roomId, agentId) { return post(`/rooms/${encodeURIComponent(roomId)}/stop`, agentId ? { agentId } : {}); },
    async diffs(roomId) { return call(`/rooms/${encodeURIComponent(roomId)}/diffs`); },
    async openSession(roomId, agentId) {
      const request = ++navigation;
      const result = await post(`/rooms/${encodeURIComponent(roomId)}/session`, { agentId });
      if (request !== navigation) return result;
      if (!api.uiWorkspace) throw new Error("Native dsh session navigation is unavailable");
      api.uiWorkspace.openSession(result.sessionId);
      return result;
    },
    openRoomSession(roomId) {
      navigation++;
      const id = snap.rooms.find(r => r.roomId === roomId)?.sessionId;
      if (!id || !api.uiWorkspace) throw new Error("Room session is unavailable");
      api.uiWorkspace.openSession(id);
    },
    async inspectFiles(roomId, paths, agentId) { return post(`/rooms/${encodeURIComponent(roomId)}/files`, { paths, agentId }); },
    async preview(roomId, path, agentId, line) {
      const request = ++navigation;
      const result = await post(`/rooms/${encodeURIComponent(roomId)}/preview`, { path, agentId });
      if (request !== navigation) return;
      if (!api.uiWorkspace || !api.sidebarRight) throw new Error("Native dsh preview is unavailable");
      // Native previews live with a native conversation session, not a custom main panel.
      let sessionId = result.sessionId;
      if (sessionId) api.uiWorkspace.openSession(sessionId);
      else {
        const workspace = api.native?.list.getSnapshot().items.find(w => sameWorkspacePath(w.path, result.workspacePath));
        if (!workspace) throw new Error("Open this room's workspace in dsh before previewing files");
        await api.uiWorkspace.openWorkspace(workspace.workspaceId, id => { sessionId = id; });
      }
      if (!sessionId) throw new Error("No native session available for preview");
      const address = sessionFileAddress(sessionId, result.path);
      // Wait for the native session's preview store to be mounted by React.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (request !== navigation) return;
        if (api.sidebarRight.mounted?.getSnapshot() === sessionId) {
          try { api.sidebarRight.openResource(address, line ? { params: { line } } : undefined); api.actions.closeDialog(); return; }
          catch (e) { if (attempt === 99) throw e; }
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Native preview did not become ready");
    },
    async merge(roomId, agentId) { return post(`/rooms/${encodeURIComponent(roomId)}/merge`, { agentId, approve: true }); },
    async discard(roomId, agentId) { return post(`/rooms/${encodeURIComponent(roomId)}/discard`, { agentId, approve: true }); },
  };

  const api = {
    getSnapshot: () => snap,
    subscribe(fn) { subs.add(fn); connect(); return () => subs.delete(fn); },
    actions,
    dispose() { navigation++; if (es) es.close(); es = null; subs.clear(); clearTimeout(searchTimer); },
    /** Native dsh workspaces service (set by apply). */
    native: null,
    nativeList: null,
    uiWorkspace: null,
    sidebarRight: null,
    /** Called after a room is created/joined (apply switches to the DSH Room panel). */
    onRoomOpened: null,
  };
  return api;
}
