/**
 * Collab Rooms — browser UI for the dsh-collab plugin.
 * Independent product surface inside the dsh shell (sidebar entry + main panel).
 * Visual identity, layout, and copy are Rooms-specific (rooms / members / invites /
 * search / tasks). Own visual identity — not a clone of other dsh panel UIs.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Input, Modal, StateDot, Switch, Tag, Toast, writeClipboard } from "@deepseek-ai/dsh-client-ui-primitives";
import roomsCss from "./rooms.css";
import { createRoomsStore } from "./store.js";

export const name = "dsh-collab-client";
export const inject = ["slots", "layout"];
const PANEL_ID = "collab";

const Svg = ({ size = 16, children }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const RoomsIcon = ({ size }) => (
  <Svg size={size}><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="M5.5 6.5h5M5.5 9.5h3.5" /></Svg>
);
const SearchIcon = () => <Svg><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.3 3.3" /></Svg>;
const PlusIcon = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>;
const CloseIcon = () => <Svg size={14}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></Svg>;
const SendIcon = () => <Svg><path d="M8 13V3.5M4 7.5l4-4 4 4" /></Svg>;
const LinkIcon = () => <Svg><path d="M6.5 9.5l3-3M7 4.75l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.25l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" /></Svg>;
const TaskIcon = () => <Svg><rect x="3" y="2.75" width="10" height="10.5" rx="2" /><path d="M5.75 7.75l1.5 1.5 3-3" /></Svg>;
const GlobeIcon = () => <Svg size={12}><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.6 1.6 2.25 3.5 2.25 5.5S9.6 11.9 8 13.5C6.4 11.9 5.75 10 5.75 8S6.4 4.1 8 2.5z" /></Svg>;
const LockIcon = () => <Svg size={12}><rect x="3.5" y="7" width="9" height="6.25" rx="1.5" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></Svg>;
const PeopleIcon = () => <Svg size={14}><circle cx="6" cy="5.5" r="2.25" /><path d="M2.5 13c.4-2 1.8-3.25 3.5-3.25S9.1 11 9.5 13" /><path d="M10.5 3.6a2.2 2.2 0 0 1 0 4.1M11.5 9.9c1 .4 1.7 1.5 2 3.1" /></Svg>;

const HUES = [212, 262, 152, 28, 340, 190, 48, 290];
function hueOf(s) { let h = 0; for (const c of s || "") h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; }
function initials(s) {
  const w = (s || "?").replace(/[^\p{L}\p{N} _-]/gu, "").split(/[\s_-]+/).filter(Boolean);
  return ((w[0] || "?")[0] + (w[1] ? w[1][0] : (w[0] || "").slice(1, 2))).toUpperCase();
}
export function Avatar({ name, size = 32 }) {
  const h = hueOf(name);
  return (
    <span className="rm-avatar" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), fontSize: Math.round(size * 0.36), background: `hsl(${h} 55% 90%)`, color: `hsl(${h} 40% 30%)` }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
function fmtTime(ts) {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtDay(ts) { return new Date(ts).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" }); }
const STATUS_TONE = { open: "info", claimed: "warning", done: "success", failed: "danger", cancelled: "quiet" };
function useStore(store) { return useSyncExternalStore(store.subscribe, store.getSnapshot); }
function renderMentions(text) {
  return text.split(/(@[A-Za-z0-9][\w.:-]*)/g).map((part, i) => (part.startsWith("@") ? <span key={i} className="rm-mention">{part}</span> : part));
}

function PanelIcon({ size }) { return <RoomsIcon size={size} />; }

function RoomsSidebar({ store, ensurePanel }) {
  const s = useStore(store);
  const a = store.actions;
  const [menu, setMenu] = useState(null);
  const [joining, setJoining] = useState(null);
  const inputRef = useRef(null);
  const searching = s.search.open;
  const q = s.search.query.trim().toLowerCase();
  const mine = q
    ? s.rooms.filter((r) => [r.name, r.description, ...(r.tags || [])].some((v) => (v || "").toLowerCase().includes(q.replace(/^#/, ""))))
    : s.rooms;

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!(e.target.closest && e.target.closest(".rm-menu, [data-rm-new]"))) setMenu(null); };
    const esc = (e) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", esc); };
  }, [menu]);
  useEffect(() => { if (searching && inputRef.current) inputRef.current.focus(); }, [searching]);

  const join = async (r) => {
    setJoining(r.roomId);
    try { await a.join(r.invite, { name: r.name, description: r.description, tags: r.tags, public: true }); ensurePanel(); }
    catch (e) { a.toast(e.message); }
    finally { setJoining(null); }
  };

  return (
    <div className="rm-root rm-side" data-collab-sidebar="">
      <div className="rm-side-toolbar">
        <span className="rm-side-title">Rooms</span>
        <button type="button" className="rm-icon-btn" aria-label={searching ? "Close search" : "Search rooms"} aria-pressed={searching} onClick={() => a.setSearchOpen(!searching)}>
          {searching ? <CloseIcon /> : <SearchIcon />}
        </button>
        <button type="button" className="rm-icon-btn" data-rm-new="" aria-label="New room" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { top: r.bottom + 4, left: Math.max(8, r.right - 180) }); }}>
          <PlusIcon />
        </button>
        {menu ? (
          <div className="rm-root rm-menu" role="menu" style={{ top: menu.top, left: menu.left }}>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); a.openDialog({ kind: "create" }); }}><PlusIcon />Create room</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); a.openDialog({ kind: "join" }); }}><LinkIcon />Join by invite</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); a.setSearchOpen(true); }}><GlobeIcon />Browse public rooms</button>
          </div>
        ) : null}
      </div>
      {searching ? (
        <div className="rm-search">
          <SearchIcon />
          <input ref={inputRef} type="text" placeholder="Search rooms or #tags" value={s.search.query} onChange={(e) => a.setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && a.setSearchOpen(false)} aria-label="Search rooms" />
        </div>
      ) : null}
      <div className="rm-side-scroll">
        <div>
          <div className="rm-group-label">Joined</div>
          <div className="rm-room-list">
            {mine.map((r) => (
              <button key={r.roomId} type="button" className="rm-room-item" aria-current={r.roomId === s.selected ? "true" : undefined} data-room-id={r.roomId}
                onClick={() => { a.select(r.roomId); ensurePanel(); }}>
                <span className="rm-avatar-wrap"><Avatar name={r.name} size={30} /><span className={"rm-dot rm-dot-" + r.status} style={{ position: "absolute", right: -1, bottom: -1, border: "2px solid var(--rm-bg)" }} /></span>
                <span className="rm-room-item-body">
                  <span className="rm-room-item-name">{r.name}</span>
                  <span className="rm-room-item-meta">{r.last ? `${r.last.from}: ${r.last.text}` : (r.description || (r.public ? "Public room" : "Private · invite only"))}</span>
                </span>
                <span className="rm-room-item-trail">
                  {r.public ? <span className="rm-badge rm-badge-public"><GlobeIcon />Public</span> : <span className="rm-badge"><LockIcon />Private</span>}{r.transport === "lan" ? <span className="rm-badge">LAN</span> : null}
                  {r.last ? <span style={{ fontSize: 10.5, color: "var(--rm-quiet)" }}>{fmtTime(r.last.ts)}</span> : null}
                </span>
              </button>
            ))}
            {!mine.length ? <div className="rm-empty-hint">{s.rooms.length ? "No joined room matches." : "No rooms yet. Create one, join by invite, or search public rooms."}</div> : null}
          </div>
        </div>
        {searching ? (
          <div>
            <div className="rm-group-label">Public directory {s.search.loading ? "· searching…" : ""}</div>
            {s.search.results.map((r) => (
              <div key={r.roomId} className="rm-dir-item" data-dir-room-id={r.roomId}>
                <Avatar name={r.name} size={30} />
                <div className="rm-dir-item-body">
                  <div className="rm-room-item-name">{r.name}</div>
                  <div className="rm-room-item-meta">{r.description || "No description"} · {r.members} online</div>
                  {r.tags.length ? <div className="rm-dir-tags">{r.tags.map((t) => <span key={t} className="rm-tag">#{t}</span>)}</div> : null}
                </div>
                <Button size="sm" variant={r.joined ? "ghost" : "outline"} disabled={r.joined || joining === r.roomId} onClick={() => join(r)}>
                  {r.joined ? "Joined" : joining === r.roomId ? "…" : "Join"}
                </Button>
              </div>
            ))}
            {!s.search.loading && !s.search.results.length ? <div className="rm-empty-hint">{s.search.error ? `Directory error: ${s.search.error}` : "No public rooms match."}</div> : null}
            <div className="rm-empty-hint">Public rooms publish their invite key in the directory — they are not confidential.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Message({ m, showAuthor }) {
  if (m.kind === "task.create") {
    return (
      <div className="rm-msg rm-msg-event" data-message-id={m.id}>
        <div className="rm-task-card">
          <div className="rm-task-head"><TaskIcon /><span>Task · {m.from}</span><Tag tone="info">open</Tag><span className="rm-msg-time">{fmtTime(m.ts)}</span></div>
          <div className="rm-task-title">{m.title}</div>
          <div className="rm-note" style={{ margin: 0 }}>{m.assignee ? `Assigned to @${m.assignee}` : "Unassigned — any agent may claim"}</div>
        </div>
      </div>
    );
  }
  if (m.kind === "task.claim" || m.kind === "task.update") {
    return (
      <div className="rm-msg rm-msg-event" data-message-id={m.id}>
        <div className="rm-task-head">
          <TaskIcon /><span>{m.self ? "You" : m.from} {m.kind === "task.claim" ? "claimed" : "updated"} task</span>
          <Tag tone={STATUS_TONE[m.status] || "neutral"}>{m.status}</Tag>
          {m.kind === "task.update" && m.text.includes(": ") ? <span>{m.text.slice(m.text.indexOf(": ") + 2)}</span> : null}
          <span className="rm-msg-time">{fmtTime(m.ts)}</span>
        </div>
      </div>
    );
  }
  if (m.self) {
    return (
      <div className="rm-msg rm-msg-self" data-message-id={m.id}>
        <div className="rm-msg-body">{renderMentions(m.text)}</div>
        <div className="rm-msg-time" style={{ textAlign: "right", marginTop: 2 }}>{fmtTime(m.ts)}</div>
      </div>
    );
  }
  return (
    <div className="rm-msg" data-message-id={m.id}>
      {showAuthor ? <Avatar name={m.from} size={28} /> : <span />}
      <div>
        {showAuthor ? <div className="rm-msg-head"><span className="rm-msg-author">{m.from}</span><span className="rm-msg-time">{fmtTime(m.ts)}</span></div> : null}
        <div className="rm-msg-body">{renderMentions(m.text)}</div>
      </div>
    </div>
  );
}

function ChatBody({ messages }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);
  const nodes = [];
  let day = null, prev = null;
  for (const m of messages) {
    const d = fmtDay(m.ts);
    if (d !== day) { nodes.push(<div key={"d" + m.ts} className="rm-day">{d}</div>); day = d; prev = null; }
    const showAuthor = !prev || prev.from !== m.from || m.ts - prev.ts > 5 * 60_000;
    nodes.push(<Message key={m.id} m={m} showAuthor={showAuthor} />);
    prev = m;
  }
  return (
    <div className="rm-messages" ref={ref}>
      {nodes.length ? nodes : <div className="rm-chat-hint">No messages yet. Send a message, @mention an agent to wake it, or create a task from the composer.</div>}
    </div>
  );
}

function Composer({ room, store, draft, setDraft }) {
  const a = store.actions;
  const [mode, setMode] = useState("chat");
  const [busy, setBusy] = useState(false);
  const offline = room.status !== "online";
  const submit = async () => {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (mode === "task") {
        const m = /^@([A-Za-z0-9][\w.:-]*)\s+/.exec(t);
        await a.task(room.roomId, m ? t.slice(m[0].length) : t, m ? m[1] : undefined);
        setMode("chat");
      } else await a.send(room.roomId, t);
      setDraft("");
    } catch (e) { a.toast(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="rm-composer">
      <div className="rm-composer-box">
        <button type="button" className="rm-composer-mode" aria-pressed={mode === "task"} title={mode === "task" ? "Creating a task (click for chat)" : "Create a task"} onClick={() => setMode(mode === "task" ? "chat" : "task")}><TaskIcon /></button>
        <textarea rows={1} disabled={offline} aria-label="Message the room"
          placeholder={offline ? "Room is offline" : mode === "task" ? "Task: @assignee title (optional assignee)" : `Message ${room.name} · @agent wakes it`}
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
      </div>
      <Button variant="primary" size="sm" aria-label={mode === "task" ? "Create task" : "Send"} disabled={!draft.trim() || busy || offline} onClick={submit} icon={<SendIcon />} />
    </div>
  );
}

function RoomDetail({ room, messages, store, mention, assign }) {
  const a = store.actions;
  const tasks = useMemo(() => {
    const map = new Map();
    for (const m of messages) {
      if (!m.taskId) continue;
      const t = map.get(m.taskId) || { taskId: m.taskId, title: m.taskId, status: "open" };
      if (m.kind === "task.create") Object.assign(t, { title: m.title, assignee: m.assignee });
      if (m.status) t.status = m.status;
      map.set(m.taskId, t);
    }
    return [...map.values()].reverse();
  }, [messages]);
  const copyInvite = async () => { const inv = await a.invite(room.roomId); a.toast((await writeClipboard(inv)) ? "Invite copied" : inv); };
  return (
    <aside className="rm-detail" aria-label="Room details">
      <div className="rm-detail-section">
        <div className="rm-detail-h"><PeopleIcon />Members · {room.members.length}</div>
        {room.members.map((m) => (
          <div key={m.agentId} className="rm-member" data-agent-id={m.agentId}>
            <span className="rm-avatar-wrap"><Avatar name={m.agentId} size={26} /><span className="rm-dot rm-dot-online" style={{ position: "absolute", right: -1, bottom: -1, border: "2px solid var(--rm-bg)" }} /></span>
            <span className="rm-member-name">{m.agentId}</span>
            {m.self ? <Tag tone="quiet">you</Tag> : (
              <span className="rm-member-actions">
                <button type="button" className="rm-mini" title={`@mention ${m.agentId}`} onClick={() => mention(m.agentId)}>@</button>
                <button type="button" className="rm-mini" title={`Assign a task to ${m.agentId}`} onClick={() => assign(m.agentId)}><TaskIcon /></button>
              </span>
            )}
          </div>
        ))}
        {!room.members.length ? <p className="rm-note">{room.status === "online" ? "Only you are here." : "Offline."}</p> : null}
      </div>
      <div className="rm-detail-section">
        <div className="rm-detail-h"><TaskIcon />Tasks · {tasks.length}</div>
        {tasks.map((t) => (
          <div key={t.taskId} className="rm-task-row">
            <span className="rm-task-row-title">{t.title}</span>
            <Tag tone={STATUS_TONE[t.status] || "neutral"}>{t.status}</Tag>
            {t.assignee ? <span className="rm-note" style={{ margin: 0 }}>@{t.assignee}</span> : null}
          </div>
        ))}
        {!tasks.length ? <p className="rm-note">No tasks. Use the task button in the composer.</p> : null}
      </div>
      <div className="rm-detail-section">
        <div className="rm-detail-h"><LinkIcon />Invite</div>
        <p className="rm-note">{room.public
          ? "Public: listed in the relay directory with its key. Anyone can find, join, and read this room."
          : "Private: only agents holding the invite can join. The invite contains the room key — share it only with agents you trust."}</p>
        <div className="rm-actions"><Button size="sm" variant="outline" onClick={copyInvite} icon={<LinkIcon />}>Copy invite</Button></div>
      </div>
      <div className="rm-detail-section">
        <div className="rm-detail-h">About</div>
        <dl className="rm-about">
          <dt>Visibility</dt><dd>{room.public ? <><GlobeIcon /> Public</> : <><LockIcon /> Private</>}</dd>
          <dt>Transport</dt><dd>{room.transport === "lan" ? "LAN / mDNS" : "Relay (Cloudflare)"}</dd>
          {room.description ? <><dt>Description</dt><dd>{room.description}</dd></> : null}
          {room.tags?.length ? <><dt>Tags</dt><dd>{room.tags.map((t) => "#" + t).join(" ")}</dd></> : null}
          <dt>Room id</dt><dd className="rm-mono">{room.roomId}</dd>
          <dt>Session</dt><dd className="rm-mono">{room.sessionTitle}</dd>
          <dt>Encryption</dt><dd>E2EE (AES-GCM); relay sees ciphertext only</dd>
        </dl>
        <div className="rm-actions">
          <Button size="sm" variant="outline" onClick={() => a.openDialog({ kind: "config", roomId: room.roomId })}>Agent config</Button>
          <Button size="sm" variant="ghost" className="rm-danger" onClick={() => a.openDialog({ kind: "leave", roomId: room.roomId, name: room.name })}>Leave room</Button>
        </div>
      </div>
    </aside>
  );
}

function EmptyMain({ store }) {
  const a = store.actions;
  return (
    <div className="rm-root rm-welcome-wrap" data-collab-main="">
      <div className="rm-welcome">
        <div className="rm-badge">Collab · E2EE · no accounts</div>
        <h1>Rooms for multi-agent collaboration</h1>
        <p>A room is one-to-many: every member sees every message. An @mention or a task wakes the agent it names. Rooms are private (invite only) unless you list them in the public directory.</p>
        <div className="rm-welcome-actions">
          <button type="button" className="rm-welcome-action" onClick={() => a.openDialog({ kind: "create" })}>
            <PlusIcon /><span><b>Create room</b><span>Private by default; optionally list it publicly</span></span>
          </button>
          <button type="button" className="rm-welcome-action" onClick={() => a.openDialog({ kind: "join" })}>
            <LinkIcon /><span><b>Join by invite</b><span>Paste a collab://join/… invite</span></span>
          </button>
          <button type="button" className="rm-welcome-action" onClick={() => a.setSearchOpen(true)}>
            <SearchIcon /><span><b>Browse public rooms</b><span>Search the relay directory by name or #tag</span></span>
          </button>
        </div>
      </div>
    </div>
  );
}

function RoomsMain({ store }) {
  // approvals rendered in ActiveRoom
  const s = useStore(store);
  const [drafts, setDrafts] = useState({});
  const room = s.rooms.find((r) => r.roomId === s.selected);
  if (!room) return <EmptyMain store={store} />;
  const messages = s.messages[room.roomId] || [];
  const draft = drafts[room.roomId] || "";
  const setDraft = (v) => setDrafts((d) => ({ ...d, [room.roomId]: typeof v === "function" ? v(d[room.roomId] || "") : v }));
  return (
    <div className="rm-root rm-main" data-collab-main="">
      <ApprovalBanner store={store} />
      <div className="rm-workspace">
        <section className="rm-chat">
          <header className="rm-chat-header">
            <Avatar name={room.name} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rm-chat-header-title">{room.name}</div>
              <div className="rm-chat-header-sub">{room.members.length} online · {room.public ? "public" : "private"}</div>
            </div>
            {room.public ? <span className="rm-badge rm-badge-public"><GlobeIcon />Public</span> : <span className="rm-badge"><LockIcon />Private</span>}{room.transport === "lan" ? <span className="rm-badge">LAN</span> : null}
            <StateDot state={room.status === "online" ? "done" : room.status === "connecting" ? "ongoing" : "error"} size={8} />
          </header>
          <ChatBody messages={messages} />
          <Composer room={room} store={store} draft={draft} setDraft={setDraft} />
        </section>
        <RoomDetail room={room} messages={messages} store={store}
          mention={(id) => setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${id} `)}
          assign={(id) => { setDraft(`@${id} `); store.actions.toast(`Switch to task mode, then describe the task for @${id}`); }} />
      </div>
    </div>
  );
}

function Field({ label, hint, children, htmlFor }) {
  return <div className="rm-field"><label className="rm-field-label" htmlFor={htmlFor}>{label}</label>{children}{hint ? <div className="rm-field-hint">{hint}</div> : null}</div>;
}

function CreateDialog({ store }) {
  const a = store.actions;
  const [f, setF] = useState({ name: "", description: "", tags: "", public: false, mode: "relay", lanHostPort: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lanPeers, setLanPeers] = useState([]);
  const ok = f.name.trim() && !busy;
  const submit = async () => {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      await a.create({
        name: f.name.trim(), description: f.description.trim(), tags: f.tags,
        public: f.mode === "relay" && f.public, mode: f.mode,
        lanHostPort: f.mode === "lan" && f.lanHostPort.trim() ? f.lanHostPort.trim() : undefined,
      });
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const browseLan = async () => {
    try { const r = await a.browseLan(); setLanPeers(r.peers || []); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Create room" closeLabel="Close"
      description="Pick Relay (Cloudflare) or LAN (local relay + Tailscale/mDNS). The room key never goes to the relay."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={submit}>{busy ? "Creating…" : "Create"}</Button></>}>
      <div className="rm-root rm-form" onKeyDown={(e) => e.key === "Enter" && e.target.tagName === "INPUT" && submit()}>
        <Field label="Transport" hint="Relay uses the public CF Durable Object. LAN starts a local relay on this machine and advertises via mDNS (_collab._tcp).">
          <div className="rm-mode-row">
            <button type="button" className={"rm-mode-btn" + (f.mode === "relay" ? " is-on" : "")} onClick={() => setF({ ...f, mode: "relay" })}>Relay</button>
            <button type="button" className={"rm-mode-btn" + (f.mode === "lan" ? " is-on" : "")} onClick={() => setF({ ...f, mode: "lan", public: false })}>LAN</button>
          </div>
        </Field>
        <Field label="Name" htmlFor="rm-create-name">
          <div className="rm-name-row"><Avatar name={f.name || "room"} size={36} /><Input id="rm-create-name" autoFocus placeholder="e.g. release-crew" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        </Field>
        <Field label="Description (optional)" htmlFor="rm-create-desc" hint="Shown to members and, if public, in search results.">
          <Input id="rm-create-desc" placeholder="e.g. Agents that review and ship releases" maxLength={280} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Tags (optional)" htmlFor="rm-create-tags" hint="Spaces or commas, up to 8. Used by public room search.">
          <Input id="rm-create-tags" placeholder="e.g. review rust" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
        </Field>
        {f.mode === "lan" ? (
          <Field label="LAN host:port (optional)" htmlFor="rm-lan-hp" hint="Leave blank to use this machine's LAN/Tailscale IP and embedded relay. Or pick a discovered peer.">
            <Input id="rm-lan-hp" placeholder="100.x.x.x:7421" value={f.lanHostPort} onChange={(e) => setF({ ...f, lanHostPort: e.target.value })} />
            <div className="rm-lan-browse"><Button size="sm" variant="outline" onClick={browseLan}>Browse mDNS</Button>
              {lanPeers.map((p) => (
                <button key={p.hostPort} type="button" className="rm-lan-peer" onClick={() => setF({ ...f, lanHostPort: p.hostPort })}>{p.hostPort}{p.name ? ` · ${p.name}` : ""}</button>
              ))}
            </div>
          </Field>
        ) : (
          <div className="rm-switch-row">
            <div>
              <div className="rm-field-label">List in public directory</div>
              <div className="rm-field-hint">{f.public
                ? "Anyone can find this room by name or tag and join it. Its key is published with the listing — NOT confidential."
                : "Private: invite only. Nothing about the room is published."}</div>
            </div>
            <Switch checked={f.public} onChange={(v) => setF({ ...f, public: v })} label="List in public directory" />
          </div>
        )}
        {err ? <div className="rm-error">{err}</div> : null}
      </div>
    </Modal>
  );
}

function JoinDialog({ store }) {
  const a = store.actions;
  const [invite, setInvite] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const valid = /^collab:\/\/(join|lan|relay)\/.+#\S+$/.test(invite.trim());
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try { await a.join(invite.trim()); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Join room" closeLabel="Close"
      description="Paste an invite another agent shared. It contains the room key, which never leaves your machine except inside the invite."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={!valid || busy} onClick={submit}>{busy ? "Joining…" : "Join"}</Button></>}>
      <div className="rm-root rm-form">
        <Input autoFocus aria-label="Invite" placeholder="collab://join/… or collab://lan/<host>:<port>/<roomId>#…" value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {invite && !valid ? <div className="rm-field-hint">Invites: collab://join/…#key, collab://lan/host:port/room#key, or collab://relay/host/join/room#key</div> : null}
        {err ? <div className="rm-error">{err}</div> : null}
      </div>
    </Modal>
  );
}

function InviteDialog({ store, d }) {
  const a = store.actions;
  const [copied, setCopied] = useState(false);
  return (
    <Modal open onClose={a.closeDialog} title={`Room "${d.name}" created`} closeLabel="Close"
      description={d.public
        ? (d.listed ? "Listed in the public directory: other agents can find it with search and join with one click." : "Directory listing failed; the room still works by invite.")
        : "Private room. Share this invite with the agents you want in it."}
      footer={<><Button variant="outline" onClick={a.closeDialog}>Done</Button><Button variant="primary" onClick={async () => setCopied(await writeClipboard(d.invite))}>{copied ? "Copied" : "Copy invite"}</Button></>}>
      <div className="rm-root rm-form">
        <code className="rm-invite" data-invite="">{d.invite}</code>
        <div className="rm-field-hint">Anyone holding the invite can join and read the room.</div>
      </div>
    </Modal>
  );
}

function LeaveDialog({ store, d }) {
  const a = store.actions;
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={a.closeDialog} title={`Leave "${d.name}"?`} closeLabel="Close"
      description="This machine forgets the room and its invite. If you listed it publicly, the listing is removed."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await a.leave(d.roomId); } catch (e) { a.toast(e.message); setBusy(false); } }}>{busy ? "Leaving…" : "Leave"}</Button></>} />
  );
}


function ConfigDialog({ store, d }) {
  const a = store.actions;
  const room = (store.getSnapshot().rooms || []).find((r) => r.roomId === d.roomId);
  const mc = room?.memberConfig || {};
  const [f, setF] = useState({
    model: mc.model || "", provider: mc.provider || "", reasoningEffort: mc.reasoningEffort || "medium",
    workspacePath: "", workspaceLabel: mc.workspaceLabel || "",
    autoRead: mc.permissions?.autoRead !== false, autoWrite: !!mc.permissions?.autoWrite,
    autoShell: !!mc.permissions?.autoShell, autoNetwork: !!mc.permissions?.autoNetwork,
    mcpEnabled: mc.mcpEnabled !== false,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { a.getConfig(d.roomId).then((c) => setF((x) => ({ ...x, workspacePath: c.workspacePath || "", workspaceLabel: c.workspaceLabel || x.workspaceLabel, model: c.model || "", provider: c.provider || "", reasoningEffort: c.reasoningEffort || "medium", autoRead: c.permissions?.autoRead !== false, autoWrite: !!c.permissions?.autoWrite, autoShell: !!c.permissions?.autoShell, autoNetwork: !!c.permissions?.autoNetwork, mcpEnabled: c.mcpEnabled !== false }))).catch(() => {}); }, [d.roomId]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await a.saveConfig(d.roomId, {
        model: f.model || undefined, provider: f.provider || undefined, reasoningEffort: f.reasoningEffort,
        workspacePath: f.workspacePath || undefined, workspaceLabel: f.workspaceLabel || undefined, mcpEnabled: f.mcpEnabled,
        permissions: { autoRead: f.autoRead, autoWrite: f.autoWrite, autoShell: f.autoShell, autoNetwork: f.autoNetwork },
      });
      a.closeDialog(); a.toast("Agent config saved (announced to room; no API keys shared)");
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Room agent config" closeLabel="Close"
      description="Local to this member. Peers see model, effort, workspace label, permissions, and MCP tools — never API keys."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save"}</Button></>}>
      <div className="rm-root rm-form">
        <Field label="Model" htmlFor="rm-cfg-model"><Input id="rm-cfg-model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="e.g. deepseek-chat" /></Field>
        <Field label="Provider" htmlFor="rm-cfg-prov"><Input id="rm-cfg-prov" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="e.g. deepseek" /></Field>
        <Field label="Reasoning effort">
          <select className="rm-input" value={f.reasoningEffort} onChange={(e) => setF({ ...f, reasoningEffort: e.target.value })}>
            {["low","medium","high","max"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Workspace path" htmlFor="rm-cfg-ws" hint="Absolute path on this machine. Peers only see the label.">
          <Input id="rm-cfg-ws" value={f.workspacePath} onChange={(e) => setF({ ...f, workspacePath: e.target.value })} />
        </Field>
        <Field label="Workspace label" htmlFor="rm-cfg-wsl"><Input id="rm-cfg-wsl" value={f.workspaceLabel} onChange={(e) => setF({ ...f, workspaceLabel: e.target.value })} /></Field>
        <div className="rm-switch-row"><div><div className="rm-field-label">Expose MCP workspace</div><div className="rm-field-hint">Same-room peers can call workspace_* tools over E2EE.</div></div><Switch checked={f.mcpEnabled} onChange={(v) => setF({ ...f, mcpEnabled: v })} label="MCP" /></div>
        <div className="rm-switch-row"><div><div className="rm-field-label">Auto-allow reads</div></div><Switch checked={f.autoRead} onChange={(v) => setF({ ...f, autoRead: v })} label="autoRead" /></div>
        <div className="rm-switch-row"><div><div className="rm-field-label">Auto-allow writes</div><div className="rm-field-hint">Off → approval UI for write/mkdir/delete.</div></div><Switch checked={f.autoWrite} onChange={(v) => setF({ ...f, autoWrite: v })} label="autoWrite" /></div>
        <div className="rm-switch-row"><div><div className="rm-field-label">Auto-allow shell</div></div><Switch checked={f.autoShell} onChange={(v) => setF({ ...f, autoShell: v })} label="autoShell" /></div>
        <div className="rm-switch-row"><div><div className="rm-field-label">Auto-allow network</div></div><Switch checked={f.autoNetwork} onChange={(v) => setF({ ...f, autoNetwork: v })} label="autoNetwork" /></div>
        {err ? <div className="rm-error">{err}</div> : null}
      </div>
    </Modal>
  );
}

function ApprovalBanner({ store }) {
  const s = useStore(store);
  const list = s.approvals || [];
  if (!list.length) return null;
  const a = store.actions;
  return (
    <div className="rm-approvals">
      {list.map((p) => (
        <div key={p.requestId} className="rm-approval">
          <div className="rm-approval-body">
            <b>Approval needed</b> · {p.action} · {p.summary}
            <div className="rm-field-hint">from {p.from}{p.detail ? ` — ${p.detail}` : ""}</div>
          </div>
          <div className="rm-approval-actions">
            <Button size="sm" variant="outline" onClick={() => a.decideApproval(p.requestId, "deny")}>Deny</Button>
            <Button size="sm" variant="primary" onClick={() => a.decideApproval(p.requestId, "allow")}>Allow</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Overlay({ store }) {
  const s = useStore(store);
  const d = s.dialog;
  return (
    <>
      {d?.kind === "create" ? <CreateDialog store={store} /> : null}
      {d?.kind === "join" ? <JoinDialog store={store} /> : null}
      {d?.kind === "invite" ? <InviteDialog store={store} d={d} /> : null}
      {d?.kind === "leave" ? <LeaveDialog store={store} d={d} /> : null}
      {d?.kind === "config" ? <ConfigDialog store={store} d={d} /> : null}
      {s.toast ? <Toast text={s.toast} onDone={store.actions.clearToast} holdMs={2200} /> : null}
    </>
  );
}

function installStyles() {
  if (typeof document === "undefined") return () => {};
  const style = document.createElement("style");
  style.setAttribute("data-dsh-collab", "rooms");
  style.textContent = roomsCss;
  document.head.appendChild(style);
  return () => style.remove();
}

export function apply(ctx) {
  const store = createRoomsStore();
  ctx.effect(() => installStyles(), "dsh-collab: styles");
  ctx.effect(() => () => store.dispose(), "dsh-collab: store");
  const info = () => ctx.layout.panelInfo;
  const ensurePanel = () => { try { if (info().getSnapshot().activePanelId !== PANEL_ID) ctx.layout.selectPanel(PANEL_ID); } catch { /* layout busy */ } };

  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 11, label: () => "Rooms" }, PanelIcon));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, inject: () => ({ store }) }, RoomsMain));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-collab-dialogs", inject: () => ({ store }) }, Overlay));
  // While Rooms is the active panel, replace the Workspaces region with the room list.
  ctx.slots.inject("sidebar.workspaces", () => {
    let dispose;
    const reconcile = () => {
      const active = info().getSnapshot().activePanelId === PANEL_ID;
      if (active && !dispose) dispose = ctx.slots.register({ name: "sidebar.workspaces", priority: -100, inject: () => ({ store, ensurePanel }) }, RoomsSidebar);
      else if (!active && dispose) { dispose(); dispose = undefined; }
    };
    const off = info().subscribe(reconcile);
    reconcile();
    return () => { off(); if (dispose) dispose(); dispose = undefined; };
  });
}
