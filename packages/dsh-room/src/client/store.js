// Tiny external store for the Rooms UI: /api/collab JSON + SSE.
export const API = "/api/collab";

async function call(path, init) {
  const res = await fetch(API + path, { credentials: "same-origin", ...init, headers: { ...(init && init.body ? { "content-type": "application/json" } : {}), ...((init && init.headers) || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}
const post = (path, body) => call(path, { method: "POST", body: JSON.stringify(body || {}) });

export function createRoomsStore() {
  let snap = {
    self: null, relayUrl: "", lanRelayPort: null, workspaces: [], activeWorkspaceId: null, rooms: [], activeRoomId: null, connected: false,
    selected: null, messages: {}, dialog: null, toast: null, approvals: [],
    search: { open: false, query: "", results: [], loading: false, error: null },
  };
  const subs = new Set();
  const set = (patch) => { snap = { ...snap, ...(typeof patch === "function" ? patch(snap) : patch) }; for (const s of subs) s(); };
  let es = null;
  let searchTimer = null;

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
      set({ selected: roomId });
      if (!snap.messages[roomId]) void loadMessages(roomId);
      void post(`/rooms/${encodeURIComponent(roomId)}/active`).catch(() => {});
    },
    openDialog(dialog) { set({ dialog }); },
    closeDialog() { set({ dialog: null }); },
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
    async create(form) {
      const r = await post("/rooms", { ...form, workspaceId: form.workspaceId || snap.activeWorkspaceId });
      set({ selected: r.roomId, dialog: { kind: "invite", roomId: r.roomId, name: r.name, invite: r.invite, public: r.public, listed: r.listed } });
      void loadMessages(r.roomId);
      return r;
    },
    async join(invite, info) {
      const r = await post("/join", { invite, workspaceId: snap.activeWorkspaceId, ...(info || {}) });
      set((s) => ({ selected: r.roomId, dialog: null, search: { ...s.search, results: s.search.results.map((x) => (x.roomId === r.roomId ? { ...x, joined: true } : x)) } }));
      void loadMessages(r.roomId);
      toast(`Joined ${r.name}`);
      return r;
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
  };

  return {
    getSnapshot: () => snap,
    subscribe(fn) { subs.add(fn); connect(); return () => subs.delete(fn); },
    actions,
    dispose() { if (es) es.close(); es = null; subs.clear(); clearTimeout(searchTimer); },
  };
}
