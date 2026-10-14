/**
 * DSH Room — browser UI for the dsh room plugin.
 * Rooms share the native workspace navigation, sessions and document previews.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Input, Modal, StateDot, Switch, Tag, Toast, MarkdownText, MarkdownDelegateProvider, writeClipboard } from "@deepseek-ai/dsh-client-ui-primitives";
import roomsCss from "./rooms.css";
import { createRoomsStore } from "./store.js";
import { sameWorkspacePath, fileCandidates, inlineFile } from "./files.js";
import { installRoomGroups } from "./workspace-rooms.js";

export const name = "dsh-room-client";
export const inject = ["slots", "layout", "workspaces", "sessions", "uiWorkspace", "sidebarRight"];
const PANEL_ID = "collab";

const Svg = ({ size = 16, children }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const RoomsIcon = ({ size }) => (
  <Svg size={size}><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="M5.5 6.5h5M5.5 9.5h3.5" /></Svg>
);
const FolderIcon = ({ size }) => (
  <Svg size={size}><path d="M2.5 4.5h4l1.5 1.5H13.5v7.5H2.5z" /></Svg>
);
const SearchIcon = () => <Svg><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.3 3.3" /></Svg>;
const PlusIcon = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>;
const CloseIcon = () => <Svg size={14}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></Svg>;
const SendIcon = () => <Svg><path d="M8 13V3.5M4 7.5l4-4 4 4" /></Svg>;
const LinkIcon = () => <Svg><path d="M6.5 9.5l3-3M7 4.75l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.25l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" /></Svg>;
const TaskIcon = () => <Svg><rect x="3" y="2.75" width="10" height="10.5" rx="2" /><path d="M5.75 7.75l1.5 1.5 3-3" /></Svg>;
const GlobeIcon = () => <Svg size={12}><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.6 1.6 2.25 3.5 2.25 5.5S9.6 11.9 8 13.5C6.4 11.9 5.75 10 5.75 8S6.4 4.1 8 2.5z" /></Svg>;
const LockIcon = () => <Svg size={12}><rect x="3.5" y="7" width="9" height="6.25" rx="1.5" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></Svg>;
const BotIcon = ({ size = 14 }) => <Svg size={size}><rect x="3" y="5" width="10" height="7.5" rx="2" /><path d="M8 2.5V5M6 8.5h.01M10 8.5h.01M6.25 10.75h3.5" /></Svg>;
const StopIcon = () => <Svg size={12}><rect x="4" y="4" width="8" height="8" rx="1.5" /></Svg>;
const MergeIcon = () => <Svg size={14}><circle cx="5" cy="3.75" r="1.5" /><circle cx="5" cy="12.25" r="1.5" /><circle cx="11" cy="8" r="1.5" /><path d="M5 5.25v5.5M5 5.5c0 2 1.5 2.5 4.5 2.5" /></Svg>;
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

/** Native dsh workspaces (Host registry) — the same list the native sidebar shows. */
const EMPTY_WS = { items: [] };
const NO_SUB = () => () => {};
const NO_SNAP = () => EMPTY_WS;
function useNativeWorkspaces(store) {
  const src = store.nativeList; // bound { subscribe, getSnapshot } prepared in apply()
  const snap = useSyncExternalStore(src ? src.subscribe : NO_SUB, src ? src.getSnapshot : NO_SNAP);
  return (snap && snap.items) || [];
}
const samePath = sameWorkspacePath;
/** Group joined rooms under the native workspace whose path they are attached to. */
function groupRooms(rooms, workspaces) {
  const groups = workspaces.map((w) => ({ ws: w, rooms: [] }));
  const other = [];
  for (const r of rooms) {
    const byHost = r.hostWorkspaceId && groups.find((x) => x.ws.workspaceId === r.hostWorkspaceId);
    const path = r.memberConfig && r.memberConfig.workspacePath;
    const g = byHost || groups.find((x) => samePath(x.ws.path, path));
    if (g) g.rooms.push(r); else other.push(r);
  }
  return { groups, other };
}
const wsTitle = (w) => w.title || (w.path || "").split(/[\\/]/).filter(Boolean).pop() || w.path;

function RoomItem({ r, selected, onClick }) {
  return (
    <button type="button" className="rm-room-item" aria-current={selected ? "true" : undefined} data-room-id={r.roomId} onClick={onClick}>
      <span className="rm-avatar-wrap"><Avatar name={r.name} size={26} /><span className={"rm-dot rm-dot-" + r.status} style={{ position: "absolute", right: -1, bottom: -1, border: "2px solid var(--rm-bg)" }} /></span>
      <span className="rm-room-item-body">
        <span className="rm-room-item-name">{r.name}</span>
        <span className="rm-room-item-meta">{r.last ? `${r.last.from}: ${r.last.text}` : (r.description || (r.public ? "Public room" : "Private · invite only"))}</span>
      </span>
      {r.public ? <span className="rm-badge rm-badge-public"><GlobeIcon /></span> : <span className="rm-badge"><LockIcon /></span>}
    </button>
  );
}

/** DSH Room panel navigation: rooms grouped by native dsh workspace (sidebar list stays native). */
function RoomsNav({ store }) {
  const s = useStore(store);
  const a = store.actions;
  const workspaces = useNativeWorkspaces(store);
  const [q, setQ] = useState("");
  const qq = q.trim().toLowerCase();
  const match = (r) => !qq || r.name.toLowerCase().includes(qq) || (r.description || "").toLowerCase().includes(qq) || (r.tags || []).some((t) => ("#" + t).includes(qq));
  const { groups, other } = groupRooms((s.rooms || []).filter(match), workspaces);
  const sel = (r) => { a.select(r.roomId); if (s.dialog?.kind === "rooms") a.closeDialog(); };
  return (
    <nav className="rm-nav" aria-label="Rooms by workspace" data-rm-nav="">
      <div className="rm-nav-head">
        <span className="rm-side-title">Rooms</span>
        <button type="button" className="rm-icon-btn" title="Browse public rooms" aria-label="Browse public rooms" onClick={() => a.openDialog({ kind: "browse" })}><GlobeIcon /></button>
        <button type="button" className="rm-icon-btn" title="Join by invite" aria-label="Join by invite" onClick={() => a.openDialog({ kind: "join" })}><LinkIcon /></button>
      </div>
      <div className="rm-search">
        <SearchIcon />
        <input type="text" placeholder="Filter rooms or #tags" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter rooms" />
      </div>
      <div className="rm-nav-scroll">
        {groups.map(({ ws, rooms }) => (
          <div key={ws.workspaceId} className="rm-ws-group" data-rm-ws-group={ws.workspaceId}>
            <div className="rm-ws-head" title={ws.path}>
              <FolderIcon /><span className="rm-ws-name">{wsTitle(ws)}</span>
              <button type="button" className="rm-icon-btn rm-ws-add" title={`New room in ${wsTitle(ws)}`} aria-label={`New room in ${wsTitle(ws)}`}
                onClick={() => a.openDialog({ kind: "create", workspace: { id: ws.workspaceId, path: ws.path, title: wsTitle(ws) } })}><PlusIcon /></button>
            </div>
            {rooms.map((r) => <RoomItem key={r.roomId} r={r} selected={r.roomId === s.selected} onClick={() => sel(r)} />)}
            {!rooms.length && !qq ? <div className="rm-empty-hint rm-ws-empty">No rooms · use + to create one here</div> : null}
          </div>
        ))}
        {other.length ? (
          <div className="rm-ws-group">
            <div className="rm-ws-head"><FolderIcon /><span className="rm-ws-name">Other rooms</span></div>
            {other.map((r) => <RoomItem key={r.roomId} r={r} selected={r.roomId === s.selected} onClick={() => sel(r)} />)}
          </div>
        ) : null}
        {!workspaces.length ? (
          <div className="rm-empty-hint">No workspaces yet. Add one with the native “Add workspace” in the left sidebar, then use “New room” on it.
            <div style={{ marginTop: 8 }}><Button size="sm" variant="outline" onClick={() => a.openDialog({ kind: "workspace" })}>Add workspace…</Button></div>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

/** Marker in a native Session row (leading seat) when that Session is a room's agent session. */
function RoomSessionMark({ store, sessionId }) {
  const s = useStore(store);
  for (const r of s.rooms || []) {
    const ag = ((r.local && r.local.agents) || []).find((x) => x.sessionId === sessionId);
    if (ag) return <span className="rm-session-mark rm-session-agent" title={`DSH Room · ${r.name} · ${ag.name} (${ag.agentId})`} aria-label={`DSH Room ${r.name} agent ${ag.name}`}><BotIcon size={13} /></span>;
  }
  const room = (s.rooms || []).find((r) => r.sessionId === sessionId);
  if (!room) return null;
  return <span className="rm-session-mark" title={`DSH Room · ${room.name}`} aria-label={`DSH Room ${room.name}`}><RoomsIcon size={13} /></span>;
}

/** Workspace selector for create/join/browse dialogs (native workspaces). */
function WorkspaceSelect({ store, value, onChange, id }) {
  const workspaces = useNativeWorkspaces(store);
  const pathsKey = workspaces.map((w) => w.workspaceId + ":" + w.path).join("|");
  // Default only when empty; never force the first workspace over a user/dialog choice.
  useEffect(() => {
    if (value || !workspaces.length) return;
    const w = workspaces[0];
    onChange({ id: w.workspaceId, path: w.path, title: wsTitle(w) });
  }, [pathsKey]);
  // Re-sync path spelling (e.g. /private/var vs /var) onto the native entry without changing workspace.
  useEffect(() => {
    if (!value || !value.path || !workspaces.length) return;
    const w = workspaces.find((x) => sameWorkspacePath(x.path, value.path));
    if (w && (w.path !== value.path || w.workspaceId !== value.id)) onChange({ id: w.workspaceId, path: w.path, title: wsTitle(w) });
  }, [pathsKey, value && value.path, value && value.id]);
  if (!workspaces.length) return <div className="rm-field-hint">No dsh workspace yet — add one in the left sidebar (Add workspace).</div>;
  const matched = workspaces.find((x) => sameWorkspacePath(x.path, value && value.path));
  const selectedPath = matched ? matched.path : "";
  return (
    <select id={id} className="rm-input" value={selectedPath} onChange={(e) => {
      const w = workspaces.find((x) => x.path === e.target.value || sameWorkspacePath(x.path, e.target.value));
      if (w) onChange({ id: w.workspaceId, path: w.path, title: wsTitle(w) });
    }}>
      {!selectedPath ? <option value="">Select a workspace…</option> : null}
      {workspaces.map((w) => <option key={w.workspaceId} value={w.path}>{wsTitle(w)} — {w.path}</option>)}
    </select>
  );
}

function PanelIcon({ size }) { return <RoomsIcon size={size} />; }


const MARKDOWN_LABELS = { code: { copyLabel: "Copy", copiedLabel: "Copied" }, footnotes: "Footnotes" };
function MessageBody({ text, room, store, from }) {
  const agent = room.local?.agents.find(a => a.agentId === from);
  const candidates = useMemo(() => fileCandidates(text), [text]);
  const [files, setFiles] = useState({});
  useEffect(() => {
    let active = true;
    setFiles({});
    if (candidates.paths.length) store.actions.inspectFiles(room.roomId, candidates.paths, agent?.agentId).then(r => { if (active) setFiles(r.files || {}); }).catch(() => {});
    return () => { active = false; };
  }, [room.roomId, agent?.agentId, candidates]);
  const open = (path, options) => store.actions.preview(room.roomId, path, agent?.agentId, options?.line).catch(e => store.actions.toast(e.message));
  const mentions = { resolve(value) {
    const parsed = inlineFile(value);
    return Object.hasOwn(files, parsed.path) ? { title: files[parsed.path], label: `Preview ${value}`, open: () => open(parsed.path, { line: parsed.line }) } : undefined;
  } };
  return <MarkdownDelegateProvider openFile={open}>
    <MarkdownText text={text} labels={MARKDOWN_LABELS} fileMentions={mentions} />
    {candidates.images.filter(path => files[path]).map(path => <button key={path} className="rm-output-link" type="button" onClick={() => open(path)} data-rm-preview={path}>Preview {path}</button>)}
  </MarkdownDelegateProvider>;
}

function Message({ m, showAuthor, who, room, store }) {
  if (m.kind === "task.create") {
    return (
      <div className="rm-msg rm-msg-event" data-message-id={m.id}>
        <div className="rm-task-card">
          <div className="rm-task-head"><TaskIcon /><span>Task · {(who && who.name) || m.from}</span><Tag tone="info">open</Tag><span className="rm-msg-time">{fmtTime(m.ts)}</span></div>
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
          <TaskIcon /><span>{m.self ? "You" : (who && who.name) || m.from} {m.kind === "task.claim" ? "claimed" : "updated"} task</span>
          <Tag tone={STATUS_TONE[m.status] || "neutral"}>{m.status}</Tag>
          {m.kind === "task.update" && m.text.includes(": ") ? <MessageBody text={m.text.slice(m.text.indexOf(": ") + 2)} room={room} store={store} from={m.from} /> : null}
          <span className="rm-msg-time">{fmtTime(m.ts)}</span>
        </div>
      </div>
    );
  }
  if (m.self) {
    return (
      <div className="rm-msg rm-msg-self" data-message-id={m.id}>
        <div className="rm-msg-body"><MessageBody text={m.text} room={room} store={store} from={m.from} /></div>
        <div className="rm-msg-time" style={{ textAlign: "right", marginTop: 2 }}>{fmtTime(m.ts)}</div>
      </div>
    );
  }
  return (
    <div className="rm-msg" data-message-id={m.id}>
      {showAuthor ? <Avatar name={m.from} size={28} /> : <span />}
      <div>
        {showAuthor ? (
          <div className="rm-msg-head">
            <span className="rm-msg-author">{who && who.name ? who.name : m.from}</span>
            {who && who.name ? <span className="rm-msg-id">{m.from}</span> : null}
            {who && who.local ? <span className="rm-agent-tag"><BotIcon size={11} />{who.moderator ? "moderator" : "local agent"}</span> : null}
            <span className="rm-msg-time">{fmtTime(m.ts)}</span>
          </div>
        ) : null}
        <div className="rm-msg-body"><MessageBody text={m.text} room={room} store={store} from={m.from} /></div>
      </div>
    </div>
  );
}

function ChatBody({ messages, members, room, store }) {
  const byId = useMemo(() => Object.fromEntries((members || []).map((x) => [x.agentId, x])), [members]);
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);
  const nodes = [];
  let day = null, prev = null;
  for (const m of messages) {
    const d = fmtDay(m.ts);
    if (d !== day) { nodes.push(<div key={"d" + m.ts} className="rm-day">{d}</div>); day = d; prev = null; }
    const showAuthor = !prev || prev.from !== m.from || m.ts - prev.ts > 5 * 60_000;
    nodes.push(<Message key={m.id} m={m} showAuthor={showAuthor} who={byId[m.from]} room={room} store={store} />);
    prev = m;
  }
  return (
    <div className="rm-messages" ref={ref}>
      {nodes.length ? nodes : <div className="rm-chat-hint">No messages yet. Send a message, @mention an agent to wake it, or create a task from the composer.</div>}
    </div>
  );
}


/** Active @query at caret: { start, end, query } or null */
function mentionQueryAt(text, caret) {
  const before = text.slice(0, caret);
  const m = /(^|[\s([{])@([A-Za-z0-9._:-]*)$/.exec(before);
  if (!m) return null;
  const at = before.lastIndexOf("@");
  return { start: at, end: caret, query: m[2] || "" };
}

function MentionMenu({ items, active, onPick, onHover }) {
  if (!items.length) return null;
  return (
    <div className="rm-mention-menu" role="listbox" aria-label="Mention someone">
      {items.map((it, i) => (
        <button key={it.id} type="button" role="option" aria-selected={i === active}
          className={"rm-mention-item" + (i === active ? " is-active" : "")}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => { e.preventDefault(); onPick(it); }}>
          <Avatar name={it.id === "all" ? "all" : it.name || it.id} size={22} />
          <span className="rm-mention-item-body">
            <span className="rm-mention-item-name">@{it.id}</span>
            <span className="rm-mention-item-meta">{it.hint}</span>
          </span>
          {it.local ? <span className="rm-agent-tag"><BotIcon size={11} />local</span> : null}
          {it.online === false ? <Tag tone="quiet">offline</Tag> : null}
        </button>
      ))}
    </div>
  );
}

function Composer({ room, store, draft, setDraft }) {
  const a = store.actions;
  const [mode, setMode] = useState("chat");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [peerOpen, setPeerOpen] = useState(false);
  const [mentionActive, setMentionActive] = useState(0);
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const taRef = useRef(null);
  const offline = room.status !== "online";
  const mqRaw = mentionQueryAt(draft, caret);
  const mq = mentionDismissed ? null : mqRaw;
  const mentionItems = (() => {
    if (!mq) return [];
    const q = mq.query.toLowerCase();
    const members = (room.members || []).filter((m) => !m.self);
    const localAgents = (room.local && room.local.agents) || [];
    const seen = new Set();
    const known = [];
    // local agents first (hosted by this dsh), then remote members
    for (const la of localAgents) {
      seen.add(la.agentId);
      known.push({ id: la.agentId, name: la.name, local: true, hint: `${la.name} · local agent${la.moderator ? " · moderator" : ""}${la.state && la.state !== "idle" ? ` · ${la.state}` : ""}`, online: la.online !== false });
    }
    for (const m of members) {
      if (seen.has(m.agentId)) continue;
      known.push({ id: m.agentId, name: m.name, hint: `${m.name ? m.name + " · " : ""}${m.hostedBy ? "remote agent" : "member"}${m.online === false ? " · offline" : " · wake"}`, online: m.online !== false });
    }
    const all = { id: "all", hint: localAgents.length ? "Everyone · wakes all local agents in parallel" : "Everyone · wake all members", online: true };
    const list = [all, ...known];
    return list.filter((it) => !q || it.id.toLowerCase().startsWith(q) || (it.name && it.name.toLowerCase().startsWith(q)));
  })();
  const mc = room.memberConfig || {};
  const catalog = useStore(store).models || [];
  const modelLabel = mc.resolvedModel?.name || mc.model || "Model unavailable";
  const effort = mc.reasoningEffort || mc.effectiveReasoningEffort || "medium";
  const permSummary = (() => {
    const p = mc.permissions || {};
    const bits = [];
    if (p.autoRead !== false) bits.push("read");
    if (p.autoWrite) bits.push("write");
    if (p.autoShell) bits.push("shell");
    if (p.autoNetwork) bits.push("net");
    return bits.length ? `Auto · ${bits.join("+")}` : "Ask to run";
  })();
  useEffect(() => { setMentionActive(0); setMentionDismissed(false); }, [mqRaw && mqRaw.query, mqRaw && mqRaw.start]);
  const MODELS = catalog;
  const EFFORTS = [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["max", "Max"]];
  const effortLabel = EFFORTS.find(([value]) => value === effort)?.[1] || effort;

  const patchConfig = async (patch) => {
    try {
      await a.saveConfig(room.roomId, patch);
    } catch (e) { a.toast(e.message); }
  };


  const syncCaret = (el) => { if (el) setCaret(el.selectionStart == null ? el.value.length : el.selectionStart); };
  const insertMention = (it) => {
    if (!mq || !it) return;
    const next = draft.slice(0, mq.start) + "@" + it.id + " " + draft.slice(mq.end);
    const pos = mq.start + it.id.length + 2;
    setDraft(next);
    setCaret(pos);
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(pos, pos); } });
  };
  const submit = async () => {
    const text = draft.trim();
    if (!text || busy || offline) return;
    setBusy(true);
    try {
      if (mode === "task") {
        const m = /^@([A-Za-z0-9][\w.:-]*)\s+/.exec(text);
        await a.task(room.roomId, m ? text.slice(m[0].length) : text, m ? m[1] : undefined);
        setMode("chat");
      } else await a.send(room.roomId, text);
      setDraft("");
    } catch (e) { a.toast(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="rm-composer-card" data-rm-composer="">
      {offline ? <div className="rm-connection-notice" role="status">
        <span>{room.status === "connecting" ? "Connecting to room…" : "Room is offline"}{room.error ? ` · ${room.error}` : ""}. You can edit your draft; reconnect to send.</span>
        <button type="button" className="rm-mini" disabled={retrying} onClick={async () => {
          setRetrying(true);
          try { await a.reconnect(room.roomId); } catch (e) { a.toast(e.message); }
          finally { setRetrying(false); }
        }}>{retrying ? "Connecting…" : "Retry connection"}</button>
      </div> : null}
      <div className="rm-composer-grow">
        {mq && mentionItems.length ? (
          <MentionMenu items={mentionItems} active={mentionActive} onHover={setMentionActive} onPick={insertMention} />
        ) : null}
        <textarea ref={taRef} rows={1} aria-label="Message the room"
          placeholder={offline ? "Draft a message · reconnect to send" : mode === "task" ? "Task: @assignee title (optional assignee)" : `Message ${room.name} · @agent or @all`}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); syncCaret(e.target); }}
          onClick={(e) => syncCaret(e.target)}
          onKeyUp={(e) => syncCaret(e.target)}
          onSelect={(e) => syncCaret(e.target)}
          onKeyDown={(e) => {
            if (mq && mentionItems.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setMentionActive((i) => (i + 1) % mentionItems.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setMentionActive((i) => (i - 1 + mentionItems.length) % mentionItems.length); return; }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insertMention(mentionItems[mentionActive] || mentionItems[0]);
                return;
              }
              if (e.key === "Escape") { e.preventDefault(); setMentionDismissed(true); return; }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
          }} />
      </div>
      <div className="rm-composer-row">
        <div className="rm-composer-tools">
          <button type="button" className="rm-composer-add" title={mode === "task" ? "Switch to chat" : "Create a task"} aria-pressed={mode === "task"} onClick={() => setMode(mode === "task" ? "chat" : "task")}><TaskIcon /></button>
        </div>
        <div className="rm-composer-modes">
          <div className="rm-composer-popwrap">
            <button type="button" className="rm-composer-select" disabled={offline} onClick={() => { setModelOpen(!modelOpen); setEffortOpen(false); setPermOpen(false); setPeerOpen(false); }} aria-label={`Model: ${modelLabel}`} aria-expanded={modelOpen} title="Room agent model">
              <span className="rm-composer-model-text">{modelLabel}</span>
              <span className="rm-composer-model-icon" aria-hidden>◆</span>
            </button>
            {modelOpen ? (
              <div className="rm-composer-menu" role="menu" aria-label="Model">
                <div className="rm-composer-menu-label">Model</div>
                {MODELS.map((m) => (
                  <button key={`${m.provider}/${m.model}`} type="button" role="menuitem" className={mc.resolvedModel?.model === m.model && mc.resolvedModel?.provider === m.provider ? "is-active" : ""} onClick={() => { void patchConfig({ model: m.model, provider: m.provider }); setModelOpen(false); }}>{m.name}</button>
                ))}
                <button type="button" role="menuitem" onClick={() => { setModelOpen(false); a.openDialog({ kind: "config", roomId: room.roomId }); }}>More agent settings…</button>
              </div>
            ) : null}
          </div>
          <div className="rm-composer-popwrap">
            <button type="button" className="rm-composer-select" disabled={offline} onClick={() => { setEffortOpen(!effortOpen); setModelOpen(false); setPermOpen(false); setPeerOpen(false); }} aria-label={`Reasoning effort: ${effortLabel}`} aria-expanded={effortOpen} title="Room reasoning effort">
              Reasoning · {effortLabel}
            </button>
            {effortOpen ? (
              <div className="rm-composer-menu" role="menu" aria-label="Reasoning effort">
                <div className="rm-composer-menu-label">Reasoning effort</div>
                {EFFORTS.map(([value, label]) => (
                  <button key={value} type="button" role="menuitem" className={effort === value ? "is-active" : ""} onClick={() => { void patchConfig({ reasoningEffort: value }); setEffortOpen(false); }}>{label}</button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="rm-composer-popwrap">
            <button type="button" className="rm-composer-select" disabled={offline} onClick={() => { setPermOpen(!permOpen); setModelOpen(false); setEffortOpen(false); setPeerOpen(false); }} title="Your auto-permissions">
              {permSummary}
            </button>
            {permOpen ? (
              <div className="rm-composer-menu" role="menu">
                <div className="rm-composer-menu-label">Auto-allow (you)</div>
                {[["autoRead","Read"],["autoWrite","Write"],["autoShell","Shell"],["autoNetwork","Network"]].map(([k, label]) => (
                  <label key={k} className="rm-composer-check">
                    <input type="checkbox" checked={!!(mc.permissions || {})[k] || (k === "autoRead" && (mc.permissions?.autoRead !== false))}
                      onChange={(e) => void patchConfig({ permissions: { [k]: e.target.checked } })} />
                    {label}
                  </label>
                ))}
                <button type="button" role="menuitem" onClick={() => { setPermOpen(false); a.openDialog({ kind: "config", roomId: room.roomId }); }}>Open full settings…</button>
              </div>
            ) : null}
          </div>
          <div className="rm-composer-popwrap">
            <button type="button" className="rm-composer-select rm-composer-peers" disabled={offline} onClick={() => { setPeerOpen(!peerOpen); setModelOpen(false); setEffortOpen(false); setPermOpen(false); }} title="Peer MCP limits on this workspace">
              Peer MCP
            </button>
            {peerOpen ? (
              <PeerGrantsMenu room={room} store={store} onClose={() => setPeerOpen(false)} patchConfig={patchConfig} />
            ) : null}
          </div>
        </div>
        <div className="rm-composer-trailing">
          <button type="button" className="rm-composer-send" aria-label={mode === "task" ? "Create task" : "Send"} disabled={!draft.trim() || busy || offline} onClick={submit}><SendIcon /></button>
        </div>
      </div>
    </div>
  );
}

function PeerGrantsMenu({ room, store, onClose, patchConfig }) {
  const mc = room.memberConfig || {};
  const def = (mc.peerGrants && mc.peerGrants.default) || { read: "auto", write: "ask", exec: "ask", delete: "ask" };
  const byAgent = (mc.peerGrants && mc.peerGrants.byAgent) || {};
  const peers = (room.members || []).filter((m) => !m.self);
  const setDefault = (cap, v) => {
    void patchConfig({ peerGrants: { default: { ...def, [cap]: v }, byAgent: { ...byAgent } } });
  };
  const setPeer = (agentId, cap, v) => {
    const cur = { ...(byAgent[agentId] || {}) };
    cur[cap] = v;
    void patchConfig({ peerGrants: { default: { ...def }, byAgent: { ...byAgent, [agentId]: cur } } });
  };
  const GRANT = ["auto", "ask", "deny"];
  return (
    <div className="rm-composer-menu rm-composer-menu-wide" role="menu">
      <div className="rm-composer-menu-label">Default peer limits (this workspace)</div>
      <div className="rm-note" style={{ margin: "0 8px 6px" }}>Controls what same-room peers may do via MCP on your path. Never shares API keys.</div>
      {["read", "write", "exec", "delete"].map((cap) => (
        <div key={cap} className="rm-grant-row">
          <span>{cap}</span>
          <select value={def[cap] || "ask"} onChange={(e) => setDefault(cap, e.target.value)} aria-label={`Default ${cap}`}>
            {GRANT.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      ))}
      {peers.length ? <div className="rm-composer-menu-label">Per peer</div> : <div className="rm-note" style={{ margin: 8 }}>No other peers online yet.</div>}
      {peers.map((m) => (
        <div key={m.agentId} className="rm-peer-grant-block">
          <div className="rm-peer-grant-name">{m.agentId}</div>
          {["read", "write", "exec", "delete"].map((cap) => (
            <div key={cap} className="rm-grant-row">
              <span>{cap}</span>
              <select value={(byAgent[m.agentId] && byAgent[m.agentId][cap]) || def[cap] || "ask"} onChange={(e) => setPeer(m.agentId, cap, e.target.value)} aria-label={`${m.agentId} ${cap}`}>
                {GRANT.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          ))}
        </div>
      ))}
      <button type="button" role="menuitem" onClick={onClose}>Done</button>
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
      <div className="rm-detail-heading"><b>Room details</b><button className="rm-icon-btn" type="button" aria-label="Close room details" onClick={a.toggleDetails}><CloseIcon /></button></div>
      <div className="rm-detail-section">
        <div className="rm-detail-h"><PeopleIcon />Members · {room.members.length}</div>
        {room.members.map((m) => (
          <div key={m.agentId} className="rm-member" data-agent-id={m.agentId}>
            <span className="rm-avatar-wrap"><Avatar name={m.agentId} size={26} /><span className={"rm-dot rm-dot-" + (m.online === false ? "offline" : "online")} style={{ position: "absolute", right: -1, bottom: -1, border: "2px solid var(--rm-bg)" }} /></span>
            <span className="rm-member-name">{m.name ? <>{m.name} <span className="rm-msg-id">{m.agentId}</span></> : m.agentId}</span>
            {m.local ? <span className="rm-agent-tag"><BotIcon size={11} />{m.moderator ? "moderator" : "local"}</span> : m.hostedBy && !m.self ? <span className="rm-agent-tag">remote agent</span> : null}
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
      <LocalAgentsSection room={room} store={store} mention={mention} />
      <OrchestrationSection room={room} store={store} />
      <IsolationSection room={room} store={store} />
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
        {room.transport === "local" ? <p className="rm-note">Local-only room: switch Transport to Relay or LAN before inviting remote hosts.</p> : null}
        <div className="rm-actions"><Button size="sm" variant="outline" onClick={copyInvite} icon={<LinkIcon />}>Copy invite</Button></div>
      </div>
      <TransportSection room={room} store={store} />
      <div className="rm-detail-section">
        <div className="rm-detail-h">About</div>
        <dl className="rm-about">
          <dt>Visibility</dt><dd>{room.public ? <><GlobeIcon /> Public</> : <><LockIcon /> Private</>}</dd>
          <dt>Transport</dt><dd>{room.transport === "local" ? "Local only (in-process loopback)" : room.transport === "lan" ? "LAN / VPS (Node relay)" : "Relay"}</dd>
          {room.memberConfig?.workspaceLabel ? <><dt>Workspace</dt><dd>{room.memberConfig.workspaceLabel}</dd></> : null}
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

/* ── local multi-agent UI ─────────────────────────────────────────────── */
const RUN_TONE = { running: "warning", queued: "info", approval: "info", done: "success", failed: "danger", stopped: "quiet" };
function ModelSelect({ catalog = [], inherited, model, provider, onChange }) {
  const route = model ? JSON.stringify([provider || inherited?.provider || "", model]) : "";
  const choices = [...catalog];
  if (model && !choices.some((m) => m.model === model && m.provider === (provider || inherited?.provider))) {
    choices.push({ model, provider: provider || inherited?.provider || "", name: model });
  }
  return <select className="rm-input" aria-label="Model" value={route} onChange={(e) => {
    const [provider, model] = e.target.value ? JSON.parse(e.target.value) : ["", ""];
    onChange({ provider, model });
  }}>
    <option value="">{inherited?.name ? `Inherit · ${inherited.name}` : "Model unavailable"}</option>
    {choices.map((m) => <option key={`${m.provider}/${m.model}`} value={JSON.stringify([m.provider, m.model])}>{m.name}</option>)}
  </select>;
}

function LocalAgentsSection({ room, store, mention }) {
  const a = store.actions;
  const local = room.local || { agents: [] };
  return (
    <div className="rm-detail-section" data-rm-local-agents="">
      <div className="rm-detail-h"><BotIcon />Local agents · {local.agents.length}</div>
      {local.agents.map((ag) => (
        <div key={ag.agentId} className="rm-agent-row" data-agent-id={ag.agentId}>
          <span className="rm-avatar-wrap"><Avatar name={ag.name} size={26} /><span className={"rm-dot rm-dot-" + (ag.state === "running" ? "busy" : ag.online ? "online" : "offline")} style={{ position: "absolute", right: -1, bottom: -1, border: "2px solid var(--rm-bg)" }} /></span>
          <span className="rm-agent-main">
            <span className="rm-agent-name">{ag.name}{ag.moderator ? <span className="rm-agent-tag">moderator</span> : null}</span>
            <span className="rm-agent-sub rm-mono">@{ag.agentId}</span>
            <span className="rm-agent-sub">{ag.connectionStatus || (ag.online ? "online" : "offline")}{ag.error ? ` · ${ag.error}` : !ag.online && room.status !== "online" ? " · waiting for room connection" : ""}</span>
            <span className="rm-agent-sub">{ag.scope === "write" ? (ag.isolation === "worktree" ? "writes · own worktree" : ag.isolation === "locks" ? "writes · file locks" : "writes") : "read-only"}{ag.approvalRequired ? " · approval" : ""}{ag.resolvedModel?.name ? ` · ${ag.resolvedModel.name}` : ag.model ? ` · ${ag.model}` : ""}{ag.reasoningEffort ? ` · ${ag.reasoningEffort}` : ""}</span>
          </span>
          {ag.state !== "idle" ? <Tag tone={RUN_TONE[ag.state] || "neutral"}>{ag.state}</Tag> : null}
          <span className="rm-member-actions">
            <button type="button" className="rm-mini" title={`@mention ${ag.name}`} onClick={() => mention(ag.agentId)}>@</button>
            <button type="button" className="rm-mini" title={`Edit ${ag.name}`} aria-label={`Edit ${ag.name}`} onClick={() => a.openDialog({ kind: "agent", roomId: room.roomId, agentId: ag.agentId })}>✎</button>
          </span>
        </div>
      ))}
      {!local.agents.length ? <p className="rm-note">Add a custom agent (free-form name, prompt, model, scope) or start from a preset. Each gets its own identity, session and scope.</p> : null}
      <div className="rm-actions"><Button size="sm" variant="outline" icon={<PlusIcon />} onClick={() => a.openDialog({ kind: "agent", roomId: room.roomId })}>Add agent</Button></div>
    </div>
  );
}

function NumberSetting({ label, value, min, max, onSave, hint }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Number(v); if (Number.isFinite(n) && n !== value) onSave(Math.min(max, Math.max(min, Math.round(n)))); else setV(String(value)); };
  return (
    <label className="rm-num-setting" title={hint}>
      <span>{label}</span>
      <input type="number" min={min} max={max} value={v} aria-label={label} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
    </label>
  );
}

function RunQueue({ room, store, compact }) {
  const a = store.actions;
  const runs = room.runs || [];
  const nameOf = (id) => ((room.local && room.local.agents) || []).find((x) => x.agentId === id)?.name || id;
  const active = runs.filter((r) => r.state === "running" || r.state === "queued" || r.state === "approval");
  const recent = runs.filter((r) => !active.includes(r)).slice(-3).reverse();
  return (
    <div className="rm-runs" data-rm-runs="">
      {active.map((r, i) => (
        <div key={r.id} className={"rm-run rm-run-" + r.state}>
          <span className="rm-run-pos">{r.state === "running" ? "▶" : r.state === "approval" ? "?" : `#${i + 1 - active.filter((x) => x.state === "running").length}`}</span>
          <span className="rm-run-who">{nameOf(r.agentId)}</span>
          <span className="rm-run-what" title={r.summary}>{r.summary}</span>
          <Tag tone={RUN_TONE[r.state]}>{r.state === "approval" ? "needs approval" : r.state}</Tag>
        </div>
      ))}
      {!compact ? recent.map((r) => (
        <div key={r.id} className={"rm-run rm-run-" + r.state}>
          <span className="rm-run-pos">✓</span>
          <span className="rm-run-who">{nameOf(r.agentId)}</span>
          <span className="rm-run-what" title={r.error || r.summary}>{r.error || r.summary}</span>
          <Tag tone={RUN_TONE[r.state]}>{r.state}</Tag>
        </div>
      )) : null}
      {!active.length && !recent.length ? <p className="rm-note">No agent runs yet.</p> : null}
      {active.length ? <div className="rm-actions"><Button size="sm" variant="outline" className="rm-danger" icon={<StopIcon />} onClick={() => a.stop(room.roomId).then((r) => a.toast(`Stopped ${r.stopped} run(s)`)).catch((e) => a.toast(e.message))}>Stop all agents</Button></div> : null}
    </div>
  );
}

function OrchestrationSection({ room, store }) {
  const a = store.actions;
  const local = room.local;
  if (!local || !local.agents.length) return null;
  const save = (patch) => a.saveLocal(room.roomId, patch).catch((e) => a.toast(e.message));
  const active = (room.runs || []).filter((r) => r.state === "running" || r.state === "queued" || r.state === "approval");
  return (
    <div className="rm-detail-section" data-rm-orchestration="">
      <div className="rm-detail-h">Runs · {active.filter((r) => r.state === "running").length}/{local.concurrency} running{active.length > local.concurrency ? ` · ${active.length - Math.min(local.concurrency, active.filter((r) => r.state === "running").length)} queued` : ""}</div>
      <div className="rm-num-row">
        <NumberSetting label="Parallel runs" value={local.concurrency} min={1} max={16} onSave={(n) => save({ concurrency: n })} hint="Max local agent runs at once; the rest wait in the queue." />
        <NumberSetting label="Turn limit" value={local.turnLimit} min={1} max={100} onSave={(n) => save({ turnLimit: n })} hint="Max agent-to-agent hand-offs per task/thread. A human message resets it." />
      </div>
      <RunQueue room={room} store={store} />
    </div>
  );
}

function IsolationSection({ room, store }) {
  const a = store.actions;
  const local = room.local;
  if (!local || !local.agents.some((x) => x.scope === "write")) return null;
  return (
    <div className="rm-detail-section" data-rm-isolation="">
      <div className="rm-detail-h"><MergeIcon />Workspace isolation</div>
      <select className="rm-input" aria-label="Isolation mode" value={local.isolation} onChange={(e) => a.saveLocal(room.roomId, { isolation: e.target.value }).catch((x) => a.toast(x.message))}>
        <option value="auto">Auto — git worktree per writing agent, else file locks</option>
        <option value="worktree">Git worktree per agent</option>
        <option value="locks">File locks (shared workspace)</option>
        <option value="off">Off (shared, no locks)</option>
      </select>
      {local.locks && local.locks.length ? <div className="rm-note">{local.locks.length} file lock(s): {local.locks.slice(0, 4).map((l) => `${l.path} (${l.owner})`).join(", ")}</div> : null}
      <div className="rm-actions"><Button size="sm" variant="outline" icon={<MergeIcon />} onClick={() => a.openDialog({ kind: "merge", roomId: room.roomId })}>Review &amp; merge</Button></div>
    </div>
  );
}

const localOffline = room => room.local?.agents.some(a => !a.online);

function TransportSection({ room, store }) {
  const a = store.actions;
  const [busy, setBusy] = useState(null);
  const cur = room.transport === "local" ? "local" : room.transport === "lan" ? "relay" : "relay";
  const go = async (target) => {
    setBusy(target);
    try {
      await a.setTransport(room.roomId, target);
      a.toast(target === "local" ? "Local only — in-process, no network" : target === "lan" ? "Now on this machine's LAN relay — invite remote hosts" : "Now on the relay — invite remote hosts");
    } catch (e) { a.toast(e.message); }
    finally { setBusy(null); }
  };
  return (
    <div className="rm-detail-section" data-rm-transport="">
      <div className="rm-detail-h">Transport</div>
      {room.status === "online" && localOffline(room) ? <button type="button" className="rm-mini" onClick={() => a.reconnect(room.roomId).catch(e => a.toast(e.message))}>Retry offline agents</button> : null}
      <div className="rm-mode-row">
        <button type="button" disabled={!!busy || room.public} className={"rm-mode-btn" + (cur === "local" ? " is-on" : "")} onClick={() => go("local")} title={room.public ? "Public rooms need a relay" : "In-process loopback: no network"}>{busy === "local" ? "…" : "Local only"}</button>
        <button type="button" disabled={!!busy} className={"rm-mode-btn" + (cur === "relay" && room.transport !== "local" ? " is-on" : "")} onClick={() => go("relay")}>{busy === "relay" ? "…" : "Relay (VPS)"}</button>
        <button type="button" disabled={!!busy} className="rm-mode-btn" onClick={() => go("lan")} title="Embedded LAN relay on this machine (mDNS)">{busy === "lan" ? "…" : "LAN"}</button>
      </div>
      <p className="rm-note">{room.transport === "local" ? "All members are on this dsh — nothing leaves the process. Switch to Relay or LAN to invite remote hosts; local agents stay members." : "Local agents connect as separate members over this transport, alongside remote hosts."}</p>
    </div>
  );
}

function AgentDialog({ store, d }) {
  const a = store.actions;
  const s = useStore(store);
  const room = (s.rooms || []).find((r) => r.roomId === d.roomId);
  const existing = room && room.local ? room.local.agents.find((x) => x.agentId === d.agentId) : null;
  const [presets, setPresets] = useState([]);
  const blank = () => ({ preset: "", name: "", persona: "", systemPrompt: "", model: "", provider: "", reasoningEffort: "medium", scope: "read", approvalRequired: false, moderator: false });
  const [f, setF] = useState(() => existing
    ? { preset: "", name: existing.name, persona: existing.persona || "", systemPrompt: existing.systemPrompt || "", model: existing.model || "", provider: existing.provider || "", reasoningEffort: existing.reasoningEffort || "medium", scope: existing.scope, approvalRequired: !!existing.approvalRequired, moderator: !!existing.moderator }
    : blank());
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { a.presets().then(setPresets).catch(() => {}); }, []);
  const pick = (p) => setF({ ...f, preset: p.key, name: p.name, persona: p.persona || "", systemPrompt: p.systemPrompt || "", scope: p.scope, moderator: !!p.moderator, reasoningEffort: p.reasoningEffort || "medium" });
  const clearPreset = () => setF({ ...f, preset: "" });
  const submit = async () => {
    if (!f.name.trim()) { setErr("Name required"); return; }
    setBusy(true); setErr(null);
    try {
      const body = { name: f.name.trim(), persona: f.persona, systemPrompt: f.systemPrompt, model: f.model, provider: f.provider, reasoningEffort: f.reasoningEffort, scope: f.scope, approvalRequired: f.approvalRequired, moderator: f.moderator };
      if (existing) await a.updateAgent(d.roomId, existing.agentId, body);
      else {
        const r = await a.addAgent(d.roomId, f.preset ? { ...body, preset: f.preset } : body);
        a.toast(`${r.name} added as @${r.agentId} (joining in background)`);
      }
      a.closeDialog();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { const r = await a.removeAgent(d.roomId, existing.agentId); a.toast(`Removed ${existing.name}${r.branchKept ? ` · branch ${r.branchKept} kept` : ""}`); a.closeDialog(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal open onClose={a.closeDialog} title={existing ? `Edit ${existing.name}` : "Add local agent"} closeLabel="Close" className="rm-modal-wide rm-modal-scrollable"
      contentClassName="rm-modal-scroll"
      description={existing ? `Member @${existing.agentId} · own identity and dsh session in this room's workspace.` : "Free-form agent: own name, persona, prompt, model, scope. Presets only fill the form — you can edit every field. Remote peers see it as a separate member."}
      footer={<>{existing ? <Button variant="ghost" className="rm-danger" disabled={busy} onClick={remove}>Remove</Button> : null}<span style={{ flex: 1 }} /><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : existing ? "Save" : "Add agent"}</Button></>}>
      <div className="rm-root rm-form rm-form-wide" data-rm-agent-form="">
        {!existing ? (
          <div className="rm-span-2">
            <div className="rm-field-label">Start from</div>
            <div className="rm-field-hint">Presets fill the fields below; switch to Custom anytime and edit freely.</div>
            <div className="rm-preset-row">
              <button type="button" className={"rm-preset" + (!f.preset ? " is-on" : "")} onClick={() => setF(blank())}>
                <b>Custom</b><span>Blank form — your name, prompt, model</span>
              </button>
              {presets.map((p) => (
                <button key={p.key} type="button" className={"rm-preset" + (f.preset === p.key ? " is-on" : "")} onClick={() => pick(p)}>
                  <b>{p.name}</b><span>{p.persona}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Field label="Name" htmlFor="rm-ag-name" hint="Member id is derived from it (e.g. coder.ab12)."><Input id="rm-ag-name" value={f.name} maxLength={40} onChange={(e) => { const name = e.target.value; const presetName = (presets.find((p) => p.key === f.preset) || {}).name; setF({ ...f, name, preset: f.preset && name !== presetName ? "" : f.preset }); }} placeholder="e.g. Data wrangler" /></Field>
        <Field label="Persona" htmlFor="rm-ag-persona" hint="One line other members see."><Input id="rm-ag-persona" value={f.persona} maxLength={200} onChange={(e) => setF({ ...f, persona: e.target.value, ...(f.preset ? { preset: "" } : {}) })} placeholder="e.g. Cleans CSVs and writes summaries" /></Field>
        <div className="rm-span-2"><Field label="System prompt" htmlFor="rm-ag-sp" hint="Prepended to every wake of this agent.">
          <textarea id="rm-ag-sp" className="rm-input rm-textarea" rows={4} value={f.systemPrompt} maxLength={4000} onChange={(e) => setF({ ...f, systemPrompt: e.target.value, ...(f.preset ? { preset: "" } : {}) })} placeholder="You are … Focus on … Report back with …" />
        </Field></div>
        <Field label="Model">
          <ModelSelect catalog={s.models} inherited={room?.memberConfig?.resolvedModel || s.defaultModel} model={f.model} provider={f.provider} onChange={(patch) => setF({ ...f, ...patch })} />
        </Field>
        <Field label="Reasoning effort">
          <select className="rm-input" aria-label="Reasoning effort" value={f.reasoningEffort} onChange={(e) => setF({ ...f, reasoningEffort: e.target.value })}>
            {["low", "medium", "high", "max"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Workspace scope">
          <div className="rm-mode-row">
            <button type="button" className={"rm-mode-btn" + (f.scope === "read" ? " is-on" : "")} onClick={() => setF({ ...f, scope: "read" })}>Read-only</button>
            <button type="button" className={"rm-mode-btn" + (f.scope === "write" ? " is-on" : "")} onClick={() => setF({ ...f, scope: "write" })}>Read + write</button>
          </div>
        </Field>
        <div className="rm-switch-col">
          <div className="rm-switch-row"><div><div className="rm-field-label">Approval required</div><div className="rm-field-hint">Each run waits for your OK.</div></div><Switch checked={f.approvalRequired} onChange={(v) => setF({ ...f, approvalRequired: v })} label="Approval required" /></div>
          <div className="rm-switch-row"><div><div className="rm-field-label">Moderator</div><div className="rm-field-hint">Splits requests into tasks and summarizes. One per room.</div></div><Switch checked={f.moderator} onChange={(v) => setF({ ...f, moderator: v })} label="Moderator" /></div>
        </div>
        {f.scope === "write" ? <div className="rm-span-2 rm-note">Writes go to its own git worktree (branch room/&lt;room&gt;/&lt;agent&gt;) when the workspace is a git repo; you merge from “Review &amp; merge”. Non-git workspaces use file locks.</div> : null}
        {f.preset ? <div className="rm-span-2 rm-note">Filled from the <b>{f.preset}</b> preset — editing any field switches to Custom. <button type="button" className="rm-linkish" onClick={clearPreset}>Clear preset tag</button></div> : null}
        {err ? <div className="rm-span-2 rm-error">{err}</div> : null}
      </div>
    </Modal>
  );
}

function DiffView({ patch }) {
  if (!patch) return <p className="rm-note">No changes.</p>;
  return (
    <pre className="rm-diff" data-rm-diff="">
      {patch.split("\n").map((l, i) => (
        <div key={i} className={l.startsWith("+++") || l.startsWith("---") ? "rm-diff-file" : l.startsWith("+") ? "rm-diff-add" : l.startsWith("-") ? "rm-diff-del" : l.startsWith("@@") ? "rm-diff-hunk" : l.startsWith("diff ") ? "rm-diff-head" : ""}>{l || " "}</div>
      ))}
    </pre>
  );
}

function MergeDialog({ store, d }) {
  const a = store.actions;
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const load = async () => {
    try { const r = await a.diffs(d.roomId); setData(r); setSel((cur) => cur && r.agents.some((x) => x.agentId === cur) ? cur : (r.agents.find((x) => x.ahead) || r.agents[0] || {}).agentId || null); }
    catch (e) { setData({ error: e.message, agents: [] }); }
  };
  useEffect(() => { void load(); }, [d.roomId]);
  const ag = data && data.agents.find((x) => x.agentId === sel);
  const run = async (kind) => {
    setBusy(true); setResult(null);
    try {
      const r = kind === "merge" ? await a.merge(d.roomId, sel) : await a.discard(d.roomId, sel);
      setResult(kind === "merge"
        ? (r.merged ? { ok: true, text: `Merged into the main workspace (${r.commit}).` } : { ok: false, text: `${r.error || "Not merged"}${r.conflicts && r.conflicts.length ? ": " + r.conflicts.join(", ") : ""}` })
        : { ok: true, text: r.discarded ? `Discarded ${r.branch}.` : "Nothing to discard." });
      await load();
    } catch (e) { setResult({ ok: false, text: e.message }); }
    finally { setBusy(false); setConfirm(null); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Review & merge agent changes" closeLabel="Close" className="rm-modal-wide rm-modal-xl"
      description="Each writing agent works on its own branch. Review the diff, then merge into (or discard from) your main workspace. Nothing is merged without your confirmation."
      footer={<Button variant="outline" onClick={a.closeDialog}>Close</Button>}>
      <div className="rm-root rm-merge" data-rm-merge="">
        {!data ? <p className="rm-note">Loading diffs…</p> : data.error ? <div className="rm-error">{data.error}</div> : !data.agents.length ? <p className="rm-note">No writing agents in this room.</p> : (
          <>
            <div className="rm-merge-list">
              {data.agents.map((x) => (
                <button key={x.agentId} type="button" className={"rm-merge-agent" + (x.agentId === sel ? " is-on" : "")} onClick={() => { setSel(x.agentId); setConfirm(null); setResult(null); }}>
                  <Avatar name={x.name} size={24} />
                  <span className="rm-merge-agent-body"><b>{x.name}</b><span className="rm-mono">{x.branch || (x.isolation === "locks" ? "shared workspace · locks" : "no worktree yet")}</span></span>
                  {x.conflicts && x.conflicts.length ? <Tag tone="danger">conflict</Tag> : x.ahead ? <Tag tone="info">{x.files.length} file{x.files.length === 1 ? "" : "s"}</Tag> : <Tag tone="quiet">clean</Tag>}
                </button>
              ))}
            </div>
            <div className="rm-merge-main">
              {ag ? (
                <>
                  <div className="rm-merge-head">
                    <div><b>{ag.name}</b> <span className="rm-mono">{ag.branch || ""}</span>{ag.ahead ? <span className="rm-note" style={{ margin: "0 0 0 8px" }}>{ag.ahead} commit(s) ahead</span> : null}</div>
                    <div className="rm-actions" style={{ margin: 0 }}>
                      {confirm ? (
                        <>
                          <span className="rm-confirm-text">{confirm === "merge" ? `Merge ${ag.files.length} file(s) into the main workspace?` : `Discard ${ag.name}'s branch and worktree?`}</span>
                          <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
                          <Button size="sm" variant="primary" disabled={busy} onClick={() => run(confirm)}>{busy ? "Working…" : confirm === "merge" ? "Confirm merge" : "Confirm discard"}</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" className="rm-danger" disabled={!ag.branch || busy} onClick={() => setConfirm("discard")}>Discard</Button>
                          <Button size="sm" variant="primary" icon={<MergeIcon />} disabled={!ag.ahead || busy} onClick={() => setConfirm("merge")}>Merge into main</Button>
                        </>
                      )}
                    </div>
                  </div>
                  {result ? <div className={result.ok ? "rm-ok" : "rm-error"}>{result.text}</div> : null}
                  {ag.conflicts && ag.conflicts.length ? <div className="rm-error">Would conflict with the main workspace: {ag.conflicts.join(", ")} — resolve on the branch or discard.</div> : null}
                  {ag.mainDirty && ag.mainDirty.length ? <div className="rm-error">Uncommitted changes in the main workspace touch: {ag.mainDirty.join(", ")}</div> : null}
                  {ag.files && ag.files.length ? (
                    <div className="rm-merge-files">{ag.files.map((f) => <button key={f.path} type="button" className="rm-merge-file rm-output-link" data-rm-preview={f.path} onClick={() => a.preview(d.roomId, f.path, ag.agentId).catch(e => a.toast(e.message))}><span className="rm-mono">{f.path}</span> <span className="rm-diff-addn">+{f.adds}</span> <span className="rm-diff-deln">−{f.dels}</span></button>)}</div>
                  ) : null}
                  <DiffView patch={ag.patch} />
                  {ag.truncated ? <p className="rm-note">Diff truncated.</p> : null}
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function EmptyMain({ store }) {
  const a = store.actions;
  const workspaces = useNativeWorkspaces(store);
  const hasWs = workspaces.length > 0;
  return (
    <div className="rm-welcome-wrap">
      <div className="rm-welcome">
        <div className="rm-badge">Collab · E2EE · no accounts</div>
        <h1>Rooms live in your workspaces</h1>
        <p>Your dsh workspaces stay in the left sidebar as usual. Hover a workspace there and click the room icon (next to “New session”), or use its “…” menu → New room. Peers join and point their agent at the same project; @mention or tasks wake agents.</p>
        <div className="rm-welcome-actions">
          <button type="button" className="rm-welcome-action" disabled={!hasWs} onClick={() => a.openDialog({ kind: "create" })}>
            <PlusIcon /><span><b>New room</b><span>{hasWs ? `Pick any of ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} · default relay 62.234.113.56:80` : "Add a workspace in the left sidebar first"}</span></span>
          </button>
          <button type="button" className="rm-welcome-action" onClick={() => a.openDialog({ kind: "join" })}>
            <LinkIcon /><span><b>Join by invite</b><span>Paste a collab://… invite</span></span>
          </button>
          <button type="button" className="rm-welcome-action" onClick={() => a.openDialog({ kind: "browse" })}>
            <SearchIcon /><span><b>Browse public rooms</b><span>Search the VPS directory by name or #tag</span></span>
          </button>
        </div>
      </div>
    </div>
  );
}

function RoomsMain({ store }) {
  const s = useStore(store);
  // approvals rendered in ActiveRoom
  const [drafts, setDrafts] = useState({});
  const room = s.rooms.find((r) => r.roomId === s.selected);
  if (!room) return (
    <div className="rm-root rm-main" data-collab-main="">
      <div className="rm-main-body"><ApprovalBanner store={store} /><EmptyMain store={store} /></div>
    </div>
  );
  const messages = s.messages[room.roomId] || [];
  const draft = drafts[room.roomId] || "";
  const setDraft = (v) => setDrafts((d) => ({ ...d, [room.roomId]: typeof v === "function" ? v(d[room.roomId] || "") : v }));
  return (
    <div className="rm-root rm-main" data-collab-main="">
      <div className="rm-main-body">
      <ApprovalBanner store={store} />
      <div className="rm-workspace">
        <section className="rm-chat">
          <header className="rm-chat-header">
            <Avatar name={room.name} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rm-chat-header-title">{room.name}<button type="button" className="rm-mini rm-room-edit" aria-label="Edit room settings" title="Edit room name, description and tags" onClick={() => store.actions.openDialog({ kind: "room-settings", roomId: room.roomId })}>✎</button></div>
              <div className="rm-chat-header-sub">{room.members.filter((m) => m.online !== false).length} online{room.local && room.local.agents.length ? ` · ${room.local.agents.length} local agent${room.local.agents.length === 1 ? "" : "s"}` : ""} · {room.public ? "public" : "private"}{room.status !== "online" ? ` · room ${room.status}` : ""}</div>
            </div>
            {(() => {
              const act = (room.runs || []).filter((r) => r.state === "running" || r.state === "queued" || r.state === "approval");
              if (!act.length) return null;
              const running = act.filter((r) => r.state === "running").length;
              return (
                <button type="button" className="rm-stop-btn" data-rm-stop="" title="Stop all local agent runs" onClick={() => store.actions.stop(room.roomId).then((r) => store.actions.toast(`Stopped ${r.stopped} run(s)`)).catch((e) => store.actions.toast(e.message))}>
                  <StopIcon />Stop · {running} running{act.length > running ? `, ${act.length - running} queued` : ""}
                </button>
              );
            })()}
            {room.public ? <span className="rm-badge rm-badge-public"><GlobeIcon />Public</span> : <span className="rm-badge"><LockIcon />Private</span>}{room.transport === "local" ? <span className="rm-badge rm-badge-local">Local only</span> : room.transport === "lan" ? <span className="rm-badge">LAN/VPS</span> : null}
            <StateDot state={room.status === "online" ? "done" : room.status === "connecting" ? "ongoing" : "error"} size={8} />
            <Button size="sm" variant="ghost" onClick={() => store.actions.openDialog({ kind: "rooms" })}>Rooms</Button>
            <button type="button" className="rm-icon-btn" aria-label="Room members and settings" aria-expanded={s.detailsOpen} title="Room members and settings" data-rm-details-toggle="" onClick={store.actions.toggleDetails}><PeopleIcon /></button>
          </header>
          <ChatBody messages={messages} members={room.members} room={room} store={store} />
          <Composer room={room} store={store} draft={draft} setDraft={setDraft} />
        </section>
        {s.detailsOpen ? <RoomDetail room={room} messages={messages} store={store}
          mention={(id) => setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${id} `)}
          assign={(id) => { setDraft(`@${id} `); store.actions.toast(`Switch to task mode, then describe the task for @${id}`); }} /> : null}
      </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children, htmlFor }) {
  return <div className="rm-field"><label className="rm-field-label" htmlFor={htmlFor}>{label}</label>{children}{hint ? <div className="rm-field-hint">{hint}</div> : null}</div>;
}

function CreateDialog({ store, d }) {
  const s = useStore(store);
  const a = store.actions;
  const [tab, setTab] = useState("room"); // room | agents | limits
  const [f, setF] = useState({
    name: "", description: "", tags: "", public: false,
    transport: "relay", // local | relay | lan | cloudflare
    lanHostPort: "62.234.113.56:80",
    turnLimit: 6, concurrency: 2, isolation: "auto",
    agents: [], // draft agents: { key?, name, persona, systemPrompt, scope, moderator, reasoningEffort, approvalRequired, model }
  });
  const [draft, setDraft] = useState({ name: "", persona: "", systemPrompt: "", scope: "read", moderator: false, reasoningEffort: "medium", approvalRequired: false, model: "" });
  const [showCustom, setShowCustom] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lanPeers, setLanPeers] = useState([]);
  const [presets, setPresets] = useState([]);
  const ok = f.name.trim() && !busy;
  const [ws, setWs] = useState(d && d.workspace ? d.workspace : null);
  useEffect(() => { a.presets().then(setPresets).catch(() => {}); }, []);
  const togglePreset = (p) => {
    const has = f.agents.some((x) => x.key === p.key);
    setF({
      ...f,
      agents: has
        ? f.agents.filter((x) => x.key !== p.key)
        : [...f.agents, { key: p.key, name: p.name, persona: p.persona, systemPrompt: p.systemPrompt, scope: p.scope, moderator: !!p.moderator, reasoningEffort: p.reasoningEffort || "medium", approvalRequired: false, model: "" }],
    });
  };
  const addCustomDraft = () => {
    if (!draft.name.trim()) { setErr("Custom agent needs a name"); setTab("agents"); return; }
    setF({
      ...f,
      agents: [...f.agents, { ...draft, name: draft.name.trim(), key: undefined }],
    });
    setDraft({ name: "", persona: "", systemPrompt: "", scope: "read", moderator: false, reasoningEffort: "medium", approvalRequired: false, model: "" });
    setShowCustom(false);
    setErr(null);
  };
  const removeDraft = (i) => setF({ ...f, agents: f.agents.filter((_, j) => j !== i) });
  const submit = async () => {
    if (!ok) return;
    if (!ws) { setErr("Pick a workspace"); setTab("room"); return; }
    setBusy(true); setErr(null);
    const transport = f.transport;
    const localOnly = transport === "local";
    const mode = transport === "cloudflare" ? "relay" : "lan";
    const lanHostPort = transport === "relay" ? (f.lanHostPort.trim() || "62.234.113.56:80") : transport === "lan" ? "" : undefined;
    try {
      await a.create({
        name: f.name.trim(), description: f.description.trim(), tags: f.tags,
        public: localOnly ? false : f.public, mode,
        lanHostPort,
        workspacePath: ws.path, workspaceName: ws.title, hostWorkspaceId: ws.id,
        localOnly,
        turnLimit: f.turnLimit, concurrency: f.concurrency, isolation: f.isolation,
        agents: f.agents.map((ag) => ag.key
          ? ag.key
          : { name: ag.name, persona: ag.persona, systemPrompt: ag.systemPrompt, scope: ag.scope, moderator: ag.moderator, reasoningEffort: ag.reasoningEffort, approvalRequired: ag.approvalRequired, model: ag.model || undefined, provider: ag.provider || undefined }),
      }, { timeoutMs: 12_000 });
      // success swaps the dialog to the invite card via the store; busy clears on unmount
    } catch (e) {
      const msg = (e && e.message) || "Create failed";
      setErr(/timed out|timeout|abort/i.test(msg)
        ? `${msg}. Check transport (try Local only), relay host, and network — agent joins continue in the background after a successful create.`
        : msg);
    } finally {
      setBusy(false);
    }
  };
  const browseLan = async () => {
    try { const r = await a.browseLan(); setLanPeers(r.peers || []); } catch (e) { setErr(e.message); }
  };
  const tabs = [
    { id: "room", label: "Room" },
    { id: "agents", label: `Agents${f.agents.length ? ` (${f.agents.length})` : ""}` },
    { id: "limits", label: "Limits" },
  ];
  return (
    <Modal open onClose={a.closeDialog} title="Create room" closeLabel="Close" className="rm-modal-wide rm-modal-create rm-modal-scrollable"
      contentClassName="rm-modal-scroll"
      description={(ws ? `Workspace “${ws.title}” · ` : "") + `dsh-room ${s.version || "?"} · default VPS 62.234.113.56:80 · E2EE. Create returns immediately; agents join in the background.`}
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={submit}>{busy ? "Creating…" : "Create"}</Button></>}>
      <div className="rm-root rm-create" data-rm-create="" onKeyDown={(e) => e.key === "Enter" && e.target.tagName === "INPUT" && tab === "room" && submit()}>
        <div className="rm-tabs" role="tablist" aria-label="Create room sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={"rm-tab" + (tab === t.id ? " is-on" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        {tab === "room" ? (
          <div className="rm-form rm-form-wide rm-create-pane" role="tabpanel">
            <Field label="Workspace" htmlFor="rm-create-ws" hint="Native dsh workspace this room belongs to.">
              <WorkspaceSelect store={store} id="rm-create-ws" value={ws} onChange={setWs} />
            </Field>
            <Field label="Name" htmlFor="rm-create-name">
              <div className="rm-name-row"><Avatar name={f.name || "room"} size={36} /><Input id="rm-create-name" autoFocus placeholder="e.g. release-crew" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            </Field>
            <div className="rm-span-2">
              <Field label="Transport" hint="Local only = in-process (no network). Relay / LAN / Cloudflare for remote hosts.">
                <div className="rm-mode-row rm-mode-wrap">
                  <button type="button" className={"rm-mode-btn" + (f.transport === "local" ? " is-on" : "")} onClick={() => setF({ ...f, transport: "local", public: false })}>Local only</button>
                  <button type="button" className={"rm-mode-btn" + (f.transport === "relay" ? " is-on" : "")} onClick={() => setF({ ...f, transport: "relay", lanHostPort: f.lanHostPort || "62.234.113.56:80" })}>Relay (VPS)</button>
                  <button type="button" className={"rm-mode-btn" + (f.transport === "lan" ? " is-on" : "")} onClick={() => setF({ ...f, transport: "lan" })}>LAN (this machine)</button>
                  <button type="button" className={"rm-mode-btn" + (f.transport === "cloudflare" ? " is-on" : "")} onClick={() => setF({ ...f, transport: "cloudflare" })}>Cloudflare</button>
                </div>
              </Field>
            </div>
            {f.transport === "relay" ? (
              <div className="rm-span-2">
                <Field label="Relay host:port" htmlFor="rm-lan-hp" hint="Default 62.234.113.56:80 (public directory).">
                  <Input id="rm-lan-hp" placeholder="62.234.113.56:80" value={f.lanHostPort} onChange={(e) => setF({ ...f, lanHostPort: e.target.value })} />
                </Field>
              </div>
            ) : null}
            {f.transport === "lan" ? (
              <div className="rm-span-2">
                <Field label="LAN relay" hint="Blank host embeds a relay on this machine and advertises it over mDNS.">
                  <div className="rm-lan-browse"><Button size="sm" variant="outline" onClick={browseLan}>Browse mDNS</Button>
                    {lanPeers.map((p) => (
                      <button key={p.hostPort} type="button" className="rm-lan-peer" onClick={() => setF({ ...f, transport: "relay", lanHostPort: p.hostPort })}>{p.hostPort}{p.name ? ` · ${p.name}` : ""}</button>
                    ))}
                  </div>
                </Field>
              </div>
            ) : null}
            <Field label="Description" htmlFor="rm-create-desc" hint="Shown to members and in public search.">
              <Input id="rm-create-desc" placeholder="e.g. Agents that review and ship releases" maxLength={280} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <Field label="Tags" htmlFor="rm-create-tags" hint="Spaces or commas, up to 8.">
              <Input id="rm-create-tags" placeholder="e.g. review rust" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
            </Field>
            <div className="rm-span-2 rm-switch-row">
              <div>
                <div className="rm-field-label">List in public directory</div>
                <div className="rm-field-hint">{f.transport === "local" ? "Local-only rooms stay private (no network)." : f.public ? "Anyone can find and join — key is published with the listing." : "Private: invite only."}</div>
              </div>
              <Switch checked={f.public && f.transport !== "local"} onChange={(v) => setF({ ...f, public: v })} label="List in public directory" disabled={f.transport === "local"} title={f.transport === "local" ? "Local-only rooms stay private" : undefined} />
            </div>
          </div>
        ) : null}
        {tab === "agents" ? (
          <div className="rm-create-pane" role="tabpanel">
            <div className="rm-field-label">Presets</div>
            <div className="rm-field-hint">Shortcuts that seed a local agent. You can still add free-form agents below, and edit anyone after create.</div>
            <div className="rm-preset-row">
              {(presets.length ? presets : [
                { key: "moderator", name: "Moderator", persona: "Breaks requests into tasks and summarizes", scope: "read", moderator: true, reasoningEffort: "medium", systemPrompt: "" },
                { key: "architect", name: "Architect", persona: "Designs the approach", scope: "read", reasoningEffort: "high", systemPrompt: "" },
                { key: "coder", name: "Coder", persona: "Implements in its own worktree", scope: "write", reasoningEffort: "medium", systemPrompt: "" },
                { key: "reviewer", name: "Reviewer", persona: "Reviews diffs", scope: "read", reasoningEffort: "high", systemPrompt: "" },
              ]).map((p) => (
                <label key={p.key} className={"rm-preset rm-preset-check" + (f.agents.some((x) => x.key === p.key) ? " is-on" : "")}>
                  <input type="checkbox" checked={f.agents.some((x) => x.key === p.key)} onChange={() => togglePreset(p)} />
                  <span><b>{p.name}</b><span className="rm-preset-sub">{p.persona}</span></span>
                </label>
              ))}
            </div>
            <div className="rm-create-custom">
              <div className="rm-create-custom-head">
                <div>
                  <div className="rm-field-label">Custom agents</div>
                  <div className="rm-field-hint">Free-form name, persona, system prompt, model, scope, approval, moderator.</div>
                </div>
                <Button size="sm" variant="outline" icon={<PlusIcon />} onClick={() => { setShowCustom(true); setErr(null); }}>Add custom</Button>
              </div>
              {f.agents.filter((x) => !x.key).length ? (
                <ul className="rm-draft-list">
                  {f.agents.map((ag, i) => ag.key ? null : (
                    <li key={i} className="rm-draft-item">
                      <Avatar name={ag.name} size={24} />
                      <span className="rm-draft-main"><b>{ag.name}</b><span>{ag.persona || "custom"} · {ag.scope}{ag.moderator ? " · moderator" : ""}</span></span>
                      <button type="button" className="rm-mini" aria-label={`Remove ${ag.name}`} onClick={() => removeDraft(i)}>×</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="rm-note">No custom agents yet — presets above, or Add custom.</p>}
              {showCustom ? (
                <div className="rm-draft-form rm-form rm-form-wide">
                  <Field label="Name" htmlFor="rm-create-ag-name"><Input id="rm-create-ag-name" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Data wrangler" /></Field>
                  <Field label="Persona" htmlFor="rm-create-ag-persona"><Input id="rm-create-ag-persona" value={draft.persona} maxLength={200} onChange={(e) => setDraft({ ...draft, persona: e.target.value })} placeholder="One-line role" /></Field>
                  <div className="rm-span-2"><Field label="System prompt" htmlFor="rm-create-ag-sp">
                    <textarea id="rm-create-ag-sp" className="rm-input rm-textarea" rows={3} value={draft.systemPrompt} maxLength={4000} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
                  </Field></div>
                  <Field label="Model">
                    <ModelSelect catalog={s.models} inherited={s.defaultModel} model={draft.model} provider={draft.provider} onChange={(patch) => setDraft({ ...draft, ...patch })} />
                  </Field>
                  <Field label="Reasoning effort">
                    <select className="rm-input" aria-label="Reasoning effort" value={draft.reasoningEffort} onChange={(e) => setDraft({ ...draft, reasoningEffort: e.target.value })}>
                      {["low", "medium", "high", "max"].map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </Field>
                  <Field label="Workspace scope">
                    <div className="rm-mode-row">
                      <button type="button" className={"rm-mode-btn" + (draft.scope === "read" ? " is-on" : "")} onClick={() => setDraft({ ...draft, scope: "read" })}>Read-only</button>
                      <button type="button" className={"rm-mode-btn" + (draft.scope === "write" ? " is-on" : "")} onClick={() => setDraft({ ...draft, scope: "write" })}>Read + write</button>
                    </div>
                  </Field>
                  <div className="rm-switch-col">
                    <div className="rm-switch-row"><div><div className="rm-field-label">Approval required</div></div><Switch checked={draft.approvalRequired} onChange={(v) => setDraft({ ...draft, approvalRequired: v })} label="Approval required" /></div>
                    <div className="rm-switch-row"><div><div className="rm-field-label">Moderator</div></div><Switch checked={draft.moderator} onChange={(v) => setDraft({ ...draft, moderator: v })} label="Moderator" /></div>
                  </div>
                  <div className="rm-span-2 rm-actions">
                    <Button size="sm" variant="outline" onClick={() => setShowCustom(false)}>Cancel</Button>
                    <Button size="sm" variant="primary" onClick={addCustomDraft}>Add to room</Button>
                  </div>
                </div>
              ) : null}
            </div>
            {f.agents.length ? (
              <div className="rm-note" style={{ marginTop: 10 }}>Will create: {f.agents.map((x) => x.name).join(", ")}. Edit or add more after create from Local agents → Add local agent.</div>
            ) : null}
          </div>
        ) : null}
        {tab === "limits" ? (
          <div className="rm-form rm-form-wide rm-create-pane" role="tabpanel">
            <Field label="Parallel runs" htmlFor="rm-create-conc" hint="Max local agent runs at once (1–16). The rest wait in a visible queue.">
              <Input id="rm-create-conc" type="number" min={1} max={16} value={String(f.concurrency)} onChange={(e) => setF({ ...f, concurrency: Math.min(16, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="Turn limit" htmlFor="rm-create-turns" hint="Max agent-to-agent hand-offs per task/thread (1–100). A human message resets it.">
              <Input id="rm-create-turns" type="number" min={1} max={100} value={String(f.turnLimit)} onChange={(e) => setF({ ...f, turnLimit: Math.min(100, Math.max(1, Number(e.target.value) || 6)) })} />
            </Field>
            <div className="rm-span-2">
              <Field label="Workspace isolation" hint="Writing agents get their own git worktree by default when the workspace is a git repo.">
                <select className="rm-input" aria-label="Isolation mode" value={f.isolation} onChange={(e) => setF({ ...f, isolation: e.target.value })}>
                  <option value="auto">Auto — git worktree per writing agent, else file locks</option>
                  <option value="worktree">Git worktree per agent</option>
                  <option value="locks">File locks (shared workspace)</option>
                  <option value="off">Off (shared, no locks)</option>
                </select>
              </Field>
            </div>
            <div className="rm-span-2 rm-note">These apply as soon as the room has local agents. Change them later under Runs / Workspace isolation in the room panel.</div>
          </div>
        ) : null}
        {err ? <div className="rm-error" style={{ marginTop: 10 }}>{err}</div> : null}
      </div>
    </Modal>
  );
}

function JoinDialog({ store }) {
  const s = useStore(store);
  const a = store.actions;
  const [invite, setInvite] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const valid = /^collab:\/\/(join|lan|relay)\/.+#\S+$/.test(invite.trim());
  const [ws, setWs] = useState(null);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try { await a.join(invite.trim(), ws ? { workspacePath: ws.path, workspaceName: ws.title, hostWorkspaceId: ws.id } : undefined); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Join room" closeLabel="Close"
      description="Paste an invite and pick the dsh workspace (your checkout of the same project) the room attaches to."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={!valid || busy} onClick={submit}>{busy ? "Joining…" : "Join"}</Button></>}>
      <div className="rm-root rm-form">
        <WorkspaceSelect store={store} value={ws} onChange={setWs} />
        <Input autoFocus aria-label="Invite" placeholder="collab://join/… or collab://lan/<host>:<port>/<roomId>#…" value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {invite && !valid ? <div className="rm-field-hint">Invites: collab://join/…#key, collab://lan/host:port/room#key, or collab://relay/host/join/room#key</div> : null}
        {err ? <div className="rm-error">{err}</div> : null}
      </div>
    </Modal>
  );
}

function InviteDialog({ store, d }) {
  const s = useStore(store);
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
  const s = useStore(store);
  const a = store.actions;
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={a.closeDialog} title={`${d.kind === "delete-room" ? "Delete" : "Leave"} "${d.name}"?`} closeLabel="Close"
      description="Remove this room from this dsh, disconnect its local agents and stop their room tasks. Existing conversations and output files are kept. Other hosts can continue using the room; an owned public listing is removed."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { if (d.kind === "delete-room") await a.deleteRoom(d.roomId); else await a.leave(d.roomId); } catch (e) { a.toast(e.message); setBusy(false); } }}>{busy ? "Removing…" : d.kind === "delete-room" ? "Delete room" : "Leave"}</Button></>} />
  );
}


function RoomSettingsDialog({ store, d }) {
  const room = useStore(store).rooms.find(r => r.roomId === d.roomId);
  const [f, setF] = useState(() => ({ name: room?.name || "", description: room?.description || "", tags: (room?.tags || []).join(" ") }));
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const submit = async () => {
    if (busy || !f.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const saved = await store.actions.saveRoom(d.roomId, { name: f.name.trim(), description: f.description.trim(), tags: f.tags.split(/[\s,]+/).filter(Boolean) });
      store.actions.closeDialog(); store.actions.toast(saved.directoryWarning || "Room updated");
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return <Modal open onClose={store.actions.closeDialog} title="Edit room" description="Edit the name and labels saved on this host. Public rooms owned here also update their directory listing."
    footer={<><Button variant="ghost" className="rm-danger" onClick={() => store.actions.openDialog({ kind: "delete-room", roomId: d.roomId, name: room?.name })}>Delete room</Button><span style={{ flex: 1 }} /><Button variant="outline" onClick={store.actions.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy || !f.name.trim()} onClick={submit}>{busy ? "Saving…" : "Save"}</Button></>}>
    <div className="rm-root rm-form">
      <Field label="Name" htmlFor="rm-room-name"><Input id="rm-room-name" autoFocus value={f.name} maxLength={60} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description" htmlFor="rm-room-description"><Input id="rm-room-description" value={f.description} maxLength={280} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Tags" htmlFor="rm-room-tags" hint="Separate tags with spaces or commas."><Input id="rm-room-tags" value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} /></Field>
      {error ? <div className="rm-error">{error}</div> : null}
    </div>
  </Modal>;
}

function ConfigDialog({ store, d }) {
  const s = useStore(store);
  const a = store.actions;
  const room = (store.getSnapshot().rooms || []).find((r) => r.roomId === d.roomId);
  const mc = room?.memberConfig || {};
  const [f, setF] = useState({
    model: mc.model || "", provider: mc.provider || "", reasoningEffort: mc.reasoningEffort || mc.effectiveReasoningEffort || "medium",
    workspacePath: "", workspaceLabel: mc.workspaceLabel || "",
    autoRead: mc.permissions?.autoRead !== false, autoWrite: !!mc.permissions?.autoWrite,
    autoShell: !!mc.permissions?.autoShell, autoNetwork: !!mc.permissions?.autoNetwork,
    mcpEnabled: mc.mcpEnabled !== false,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { a.getConfig(d.roomId).then((c) => setF((x) => ({ ...x, workspacePath: c.workspacePath || "", workspaceLabel: c.workspaceLabel || x.workspaceLabel, model: c.model || "", provider: c.provider || "", reasoningEffort: c.reasoningEffort || mc.effectiveReasoningEffort || "medium", autoRead: c.permissions?.autoRead !== false, autoWrite: !!c.permissions?.autoWrite, autoShell: !!c.permissions?.autoShell, autoNetwork: !!c.permissions?.autoNetwork, mcpEnabled: c.mcpEnabled !== false }))).catch(() => {}); }, [d.roomId]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await a.saveConfig(d.roomId, {
        model: f.model, provider: f.provider, reasoningEffort: f.reasoningEffort,
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
        <Field label="Model" htmlFor="rm-cfg-model"><ModelSelect catalog={s.models} inherited={s.defaultModel} model={f.model} provider={f.provider} onChange={(patch) => setF({ ...f, ...patch })} /></Field>
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
        <div className="rm-note">Peer MCP limits (read/write/exec/delete) are edited from the room composer · Peer MCP control.</div>
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


function WorkspaceDialog({ store }) {
  const s = useStore(store);
  const a = store.actions;
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!path.trim()) { setErr("Absolute workspace path required"); return; }
    setBusy(true); setErr(null);
    try {
      if (store.native && store.native.create) await store.native.create({ path: path.trim() });
      else await a.ensureWorkspace({ name: name.trim() || undefined, path: path.trim() });
      a.closeDialog();
      a.toast("Workspace added — it appears in the left sidebar; use New room on it");
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Add workspace" closeLabel="Close"
      description="Fallback: registers a dsh workspace (same as the native “Add workspace”). It shows up in the left sidebar."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy || !path.trim()} onClick={submit}>{busy ? "Saving…" : "Use workspace"}</Button></>}>
      <div className="rm-root rm-form">
        <Field label="Name" htmlFor="rm-ws-name" hint="Shown in the sidebar.">
          <Input id="rm-ws-name" placeholder="e.g. collab" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Local path" htmlFor="rm-ws-path" hint="Absolute path on this machine.">
          <Input id="rm-ws-path" autoFocus placeholder="/Users/you/code/my-app" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        {err ? <div className="rm-error">{err}</div> : null}
      </div>
    </Modal>
  );
}


function BrowseDialog({ store }) {
  const s = useStore(store);
  const a = store.actions;
  const [joining, setJoining] = useState(null);
  const inputRef = useRef(null);
  const [activeWs, setActiveWs] = useState(null);
  useEffect(() => {
    a.setSearchOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => { /* keep sidebar search state; dialog close does not clear results */ };
  }, []);
  const join = async (r) => {
    setJoining(r.roomId);
    try {
      await a.join(r.invite, { name: r.name, description: r.description, tags: r.tags, public: true, workspacePath: activeWs?.path, workspaceName: activeWs?.title });
    } catch (e) { a.toast(e.message); }
    finally { setJoining(null); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Browse public rooms" closeLabel="Close" className="rm-modal-wide"
      description="Directory on VPS 62.234.113.56:80. Search by name or #tag; joined rooms attach to the workspace below."
      footer={<Button variant="outline" onClick={a.closeDialog}>Close</Button>}>
      <div className="rm-root rm-browse">
        <WorkspaceSelect store={store} value={activeWs} onChange={setActiveWs} />
        <div className="rm-search rm-browse-search">
          <SearchIcon />
          <input ref={inputRef} type="text" placeholder="Search rooms or #tags" value={s.search.query}
            onChange={(e) => a.setQuery(e.target.value)} aria-label="Search public rooms" />
          {s.search.loading ? <span className="rm-browse-status">Searching…</span> : null}
        </div>
        <div className="rm-browse-list">
          {s.search.results.map((r) => (
            <div key={r.roomId} className="rm-dir-item" data-dir-room-id={r.roomId}>
              <Avatar name={r.name} size={30} />
              <div className="rm-dir-item-body">
                <div className="rm-room-item-name">{r.name}</div>
                <div className="rm-room-item-meta">{r.description || "No description"} · {r.members} online</div>
                {(r.tags || []).length ? <div className="rm-dir-tags">{(r.tags || []).map((tg) => <span key={tg} className="rm-tag">#{tg}</span>)}</div> : null}
              </div>
              <Button size="sm" variant={r.joined ? "ghost" : "outline"} disabled={r.joined || joining === r.roomId || !activeWs} onClick={() => join(r)}>
                {!activeWs ? "Need workspace" : r.joined ? "Joined" : joining === r.roomId ? "…" : "Join"}
              </Button>
            </div>
          ))}
          {!s.search.loading && !s.search.results.length ? (
            <div className="rm-empty-hint">{s.search.error
              ? `Directory error: ${s.search.error}`
              : "No public rooms listed yet. Create a room with “List in public directory” on, then refresh here."}</div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function Overlay({ store }) {
  const s = useStore(store);
  const d = s.dialog;
  return (
    <>
      {d?.kind === "create" ? <CreateDialog store={store} d={d} /> : null}
      {d?.kind === "join" ? <JoinDialog store={store} /> : null}
      {d?.kind === "invite" ? <InviteDialog store={store} d={d} /> : null}
      {d?.kind === "delete-room" ? <LeaveDialog store={store} d={d} /> : null}
      {d?.kind === "leave" ? <LeaveDialog store={store} d={d} /> : null}
      {d?.kind === "room-settings" ? <RoomSettingsDialog key={d.roomId} store={store} d={d} /> : null}
      {d?.kind === "config" ? <ConfigDialog store={store} d={d} /> : null}
      {d?.kind === "workspace" ? <WorkspaceDialog store={store} /> : null}
      {d?.kind === "browse" ? <BrowseDialog store={store} /> : null}
      {d?.kind === "agent" ? <AgentDialog store={store} d={d} /> : null}
      {d?.kind === "merge" ? <MergeDialog store={store} d={d} /> : null}
      {d?.kind === "rooms" ? <Modal open onClose={store.actions.closeDialog} title="Rooms" description="Rooms are grouped beneath their native workspaces in the sidebar."><div className="rm-root"><RoomsNav store={store} /></div></Modal> : null}
      {s.toast ? <Toast text={s.toast} onDone={store.actions.clearToast} holdMs={2200} /> : null}
    </>
  );
}

function installStyles() {
  if (typeof document === "undefined") return () => {};
  const style = document.createElement("style");
  style.setAttribute("data-dsh-room", "rooms");
  style.textContent = roomsCss;
  document.head.appendChild(style);
  return () => style.remove();
}

/* ── native workspace row decoration ──────────────────────────────────────
 * dsh's workspace browser (ui-workspace) owns `sidebar.workspaces`; it declares
 * extension seats for Session rows but none for Workspace rows. So instead of
 * replacing the region, we decorate the rendered native rows: a "New room" icon
 * button beside the native "New session" button, and New session + New room rows
 * appended to the workspace "…" menu. Nothing native is hidden or replaced. */
const ROOM_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M5.5 6.5h5M5.5 9.5h3.5"/></svg>';
function installWorkspaceDecorator(store, native, onNewRoom) {
  if (typeof document === "undefined") return () => {};
  const wsFor = (key) => (typeof native?.list?.getSnapshot === "function" ? native.list.getSnapshot()?.items || [] : []).find((w) => w.workspaceId === key);
  const rowKey = (row) => (row.getAttribute("data-row-key") || "").slice("workspace:".length);
  const open = (key) => { const w = wsFor(key); if (w) onNewRoom({ id: w.workspaceId, path: w.path, title: wsTitle(w) }); };
  const newSessionButton = row => {
    const buttons = [...row.querySelectorAll("button")].filter(b => !b.hasAttribute("data-rm-ws-new-room"));
    return buttons.find(b => /New session in|中新建会话/.test(b.getAttribute("aria-label") || "")) || buttons[buttons.length - 1];
  };
  const decorate = () => {
    const add = document.querySelector('button[aria-label="Add workspace"], button[aria-label="添加工作区"]');
    const toolbar = add?.closest('[class*="_headerActions"]') || add?.parentElement;
    if (toolbar && !toolbar.querySelector('[data-rm-ws-global-room]')) {
      const button = document.createElement("button");button.type = "button";button.className = add.className;
      button.setAttribute("data-rm-ws-global-room", "");button.setAttribute("aria-label", "New room");button.title = "New room";button.innerHTML = ROOM_SVG;
      button.onclick = e => { e.preventDefault(); e.stopPropagation(); onNewRoom(undefined); };toolbar.insertBefore(button, toolbar.firstChild);
    }
    for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
      const key = rowKey(row);
      if (!key || row.querySelector("[data-rm-ws-new-room]")) continue;
      const newSess = newSessionButton(row);
      if (!newSess) continue;
      let anchor = newSess;
      while (anchor.parentElement && anchor.parentElement !== row && anchor.parentElement.querySelectorAll("button").length < 2) anchor = anchor.parentElement;
      if (!anchor.parentElement) continue;
      const label = wsFor(key) ? wsTitle(wsFor(key)) : (newSess.getAttribute("aria-label") || "").replace(/^New session in /, "");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = newSess.className;
      btn.setAttribute("data-rm-ws-new-room", key);
      btn.setAttribute("aria-label", `New room in ${label}`);
      btn.title = "New room";
      btn.innerHTML = ROOM_SVG;
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(key); });
      anchor.parentElement.insertBefore(btn, anchor);
    }
  };
  // "…" menu: remember which workspace opened it, then append our rows to the portaled menu.
  let pendingKey = null;
  const onClickCapture = (e) => {
    const trigger = e.target instanceof Element ? e.target.closest("button") : null;
    if (!trigger) return;
    const row = trigger.closest('[data-row-key^="workspace:"]');
    if (!row || trigger !== [...row.querySelectorAll("button")].filter(b => !b.hasAttribute("data-rm-ws-new-room"))[0]) return;
    pendingKey = row ? rowKey(row) : null;
    if (!pendingKey) return;
    const key = pendingKey;
    let tries = 0;
    const augment = () => {
      const menus = [...document.querySelectorAll('[role="menu"]')].filter((m) => m.querySelector('[role="menuitem"]'));
      const menu = menus[menus.length - 1];
      if (!menu) { if (++tries < 10) requestAnimationFrame(augment); return; }
      if (menu.querySelector("[data-rm-ws-menu]")) return;
      const tpl = menu.querySelector('[role="menuitem"]');
      const mk = (text, svg, onPick) => {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.setAttribute("data-rm-ws-menu", text);
        item.className = tpl.className;
        item.innerHTML = `<span style="display:inline-flex;width:16px;justify-content:center">${svg}</span><span>${text}</span>`;
        item.style.display = "flex"; item.style.alignItems = "center"; item.style.gap = "8px";
        item.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); trigger.click(); onPick(); });
        return item;
      };
      const newSessSvg = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
      const first = menu.firstElementChild;
      menu.insertBefore(mk("New session", newSessSvg, () => {
        const row = document.querySelector(`[data-row-key="workspace:${CSS.escape(key)}"]`);
        if (row) newSessionButton(row)?.click();
      }), first);
      menu.insertBefore(mk("New room", ROOM_SVG, () => open(key)), first);
    };
    requestAnimationFrame(augment);
  };
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; decorate(); }); };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", onClickCapture, true);
  schedule();
  return () => {
    mo.disconnect();
    document.removeEventListener("click", onClickCapture, true);
    if (raf) cancelAnimationFrame(raf);
    for (const b of document.querySelectorAll("[data-rm-ws-new-room], [data-rm-ws-global-room]")) b.remove();
  };
}

export function apply(ctx) {
  const store = createRoomsStore();
  let native = null;
  try { native = ctx.get ? ctx.get("workspaces") : ctx.workspaces; } catch { native = ctx.workspaces || null; }
  store.native = native || null;
  store.uiWorkspace = ctx.uiWorkspace;
  store.sidebarRight = ctx.sidebarRight;
  store.nativeList = typeof native?.list?.getSnapshot === "function" ? {
    subscribe: (listener) => native.list.subscribe?.(listener) || NO_SUB(),
    getSnapshot: () => native.list.getSnapshot(),
  } : null;
  ctx.effect(() => installStyles(), "dsh-room: styles");
  ctx.effect(() => () => store.dispose(), "dsh-room: store");
  const info = () => ctx.layout.panelInfo;
  const ensurePanel = () => { try { if (info().getSnapshot().activePanelId !== PANEL_ID) ctx.layout.selectPanel(PANEL_ID); } catch { /* layout busy */ } };
  store.onRoomOpened = ensurePanel;

  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 11, label: () => "DSH Room" }, PanelIcon));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, inject: () => ({ store }) }, RoomsMain));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-room-dialogs", inject: () => ({ store }) }, Overlay));
  // Native workspace list is never replaced: mark room sessions in it (supported seat)…
  ctx.slots.inject("sidebar.session.row.leading", () => ctx.slots.register({ name: "sidebar.session.row.leading", id: "dsh-room-session-mark", inject: () => ({ store }) }, RoomSessionMark));
  // …and add "New room" next to each workspace's native "New session".
  ctx.effect(() => installWorkspaceDecorator(store, native, (workspace) => store.actions.openDialog({ kind: "create", workspace })), "dsh-room: workspace New room");
  ctx.effect(() => installRoomGroups(store, native, ctx.layout, ctx.get ? ctx.get("sessions") : ctx.sessions), "dsh-room: workspace room groups");
}
