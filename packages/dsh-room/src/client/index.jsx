/**
 * DSH Room — browser UI for the dsh room plugin.
 * Independent product surface inside the dsh shell (sidebar entry + main panel).
 * Visual identity, layout, and copy are Rooms-specific (rooms / members / invites /
 * search / tasks). Own visual identity — not a clone of other dsh panel UIs.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Input, Modal, StateDot, Switch, Tag, Toast, writeClipboard } from "@deepseek-ai/dsh-client-ui-primitives";
import roomsCss from "./rooms.css";
import { createRoomsStore } from "./store.js";

export const name = "dsh-room-client";
export const inject = ["slots", "layout"];
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
  const [searching, setSearching] = useState(false);
  const [joining, setJoining] = useState(null);
  const inputRef = useRef(null);
  const activeWs = (s.workspaces || []).find((w) => w.id === s.activeWorkspaceId) || (s.workspaces || [])[0] || null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  useEffect(() => { if (searching && inputRef.current) inputRef.current.focus(); }, [searching]);

  const q = (s.search.query || "").trim().toLowerCase();
  const mine = (s.rooms || []).filter((r) => {
    if (activeWs && r.workspaceId && r.workspaceId !== activeWs.id) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q) || (r.tags || []).some((t) => ("#" + t).includes(q));
  });

  const join = async (r) => {
    setJoining(r.roomId);
    try { await a.join(r.invite, { name: r.name, description: r.description, tags: r.tags, public: true, workspaceId: activeWs?.id }); ensurePanel(); }
    catch (e) { a.toast(e.message); }
    finally { setJoining(null); }
  };

  // No workspace yet — bind one first
  if (!activeWs) {
    return (
      <div className="rm-root rm-side" data-collab-sidebar="">
        <div className="rm-side-toolbar"><span className="rm-side-title">Workspaces</span></div>
        <div className="rm-side-scroll">
          <div className="rm-empty-hint">Bind a local workspace first. Rooms you create inherit its path (MCP sandbox + agent cwd).</div>
          <Button size="sm" variant="primary" onClick={() => a.openDialog({ kind: "workspace" })}>Add workspace</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rm-root rm-side" data-collab-sidebar="">
      <div className="rm-side-toolbar">
        <span className="rm-side-title">DSH Room</span>
        <button type="button" className="rm-icon-btn" aria-label={searching ? "Close search" : "Search rooms"} aria-pressed={searching} onClick={() => { setSearching(!searching); a.setSearchOpen(!searching); }}>
          {searching ? <CloseIcon /> : <SearchIcon />}
        </button>
        <button type="button" className="rm-icon-btn" data-rm-new="" aria-label="New" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { top: r.bottom + 4, left: Math.max(8, r.right - 200) }); }}>
          <PlusIcon />
        </button>
        {menu ? (
          <div className="rm-root rm-menu" role="menu" style={{ top: menu.top, left: menu.left }} onClick={(e) => e.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); a.openDialog({ kind: "create" }); }}><PlusIcon />Create room in workspace</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); a.openDialog({ kind: "join" }); }}><LinkIcon />Join by invite</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); a.openDialog({ kind: "workspace" }); }}><FolderIcon />Add / switch workspace</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); setSearching(true); a.setSearchOpen(true); }}><GlobeIcon />Browse public rooms</button>
          </div>
        ) : null}
      </div>

      <div className="rm-ws-bar">
        <button type="button" className="rm-ws-chip" onClick={() => a.openDialog({ kind: "workspace" })} title={activeWs.path}>
          <FolderIcon /><span>{activeWs.name}</span>
        </button>
        <span className="rm-ws-path" title={activeWs.path}>{activeWs.path}</span>
      </div>

      {searching ? (
        <div className="rm-search">
          <SearchIcon />
          <input ref={inputRef} type="text" placeholder="Search rooms or #tags" value={s.search.query} onChange={(e) => a.setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && a.setSearchOpen(false)} aria-label="Search rooms" />
        </div>
      ) : null}

      <div className="rm-side-scroll">
        <div>
          <div className="rm-group-label">Rooms in {activeWs.name}</div>
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
                  {r.public ? <span className="rm-badge rm-badge-public"><GlobeIcon />Public</span> : <span className="rm-badge"><LockIcon />Private</span>}{r.transport === "lan" ? <span className="rm-badge">LAN/VPS</span> : null}
                  {r.last ? <span style={{ fontSize: 10.5, color: "var(--rm-quiet)" }}>{fmtTime(r.last.ts)}</span> : null}
                </span>
              </button>
            ))}
            {!mine.length ? <div className="rm-empty-hint">No rooms in this workspace yet. Create one or join by invite — peers should check out the same project.</div> : null}
          </div>
        </div>
        {(s.workspaces || []).length > 1 ? (
          <div>
            <div className="rm-group-label">Workspaces</div>
            {(s.workspaces || []).map((w) => (
              <button key={w.id} type="button" className={"rm-room-item" + (w.id === activeWs.id ? " is-active" : "")} onClick={() => a.setActiveWorkspace(w.id)}>
                <FolderIcon />
                <span className="rm-room-item-body">
                  <span className="rm-room-item-name">{w.name}</span>
                  <span className="rm-room-item-meta">{w.path}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {searching ? (
          <div>
            <div className="rm-group-label">Public directory {s.search.loading ? "· searching…" : ""}</div>
            {s.search.results.map((r) => (
              <div key={r.roomId} className="rm-dir-item" data-dir-room-id={r.roomId}>
                <Avatar name={r.name} size={30} />
                <div className="rm-dir-item-body">
                  <div className="rm-room-item-name">{r.name}</div>
                  <div className="rm-room-item-meta">{r.description || "No description"} · {r.members} online</div>
                  {r.tags.length ? <div className="rm-dir-tags">{r.tags.map((tg) => <span key={tg} className="rm-tag">#{tg}</span>)}</div> : null}
                </div>
                <Button size="sm" variant={r.joined ? "ghost" : "outline"} disabled={r.joined || joining === r.roomId} onClick={() => join(r)}>
                  {r.joined ? "Joined" : joining === r.roomId ? "…" : "Join"}
                </Button>
              </div>
            ))}
            {!s.search.loading && !s.search.results.length ? <div className="rm-empty-hint">{s.search.error ? `Directory error: ${s.search.error}` : "No public rooms match."}</div> : null}
            <div className="rm-empty-hint">Joining attaches the room to workspace “{activeWs.name}”. Point your local path at the same project.</div>
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
          <Avatar name={it.id === "all" ? "all" : it.id} size={22} />
          <span className="rm-mention-item-body">
            <span className="rm-mention-item-name">@{it.id}</span>
            <span className="rm-mention-item-meta">{it.hint}</span>
          </span>
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
  const [modelOpen, setModelOpen] = useState(false);
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
    const known = members.map((m) => ({
      id: m.agentId,
      hint: m.online === false ? "member · offline" : "member · wake",
      online: m.online !== false,
    }));
    const all = { id: "all", hint: "Everyone · wake all members", online: true };
    const list = [all, ...known];
    return list.filter((it) => !q || it.id.toLowerCase().startsWith(q) || ("@" + it.id).toLowerCase().startsWith("@" + q));
  })();
  const mc = room.memberConfig || {};
  const modelLabel = mc.model || "Default model";
  const effort = mc.reasoningEffort || "medium";
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
  const MODELS = ["deepseek-chat", "deepseek-reasoner", "deepseek-coder"];
  const EFFORTS = ["low", "medium", "high", "max"];

  const patchConfig = async (patch) => {
    try {
      const next = {
        model: mc.model,
        provider: mc.provider,
        reasoningEffort: mc.reasoningEffort || "medium",
        workspacePath: mc.workspacePath,
        workspaceLabel: mc.workspaceLabel,
        mcpEnabled: mc.mcpEnabled !== false,
        ...patch,
        permissions: { ...(mc.permissions || { autoRead: true, autoWrite: false, autoShell: false, autoNetwork: false }), ...(patch.permissions || {}) },
        peerGrants: patch.peerGrants !== undefined ? patch.peerGrants : mc.peerGrants,
      };
      await a.saveConfig(room.roomId, next);
    } catch (e) { a.toast(e.message); }
  };

  const syncCaret = (el) => {
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
  };
  const insertMention = (it) => {
    if (!mq) return;
    const insert = `@${it.id} `;
    const next = draft.slice(0, mq.start) + insert + draft.slice(mq.end);
    setDraft(next);
    const pos = mq.start + insert.length;
    setCaret(pos);
    setMentionActive(0);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  };
  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
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
      <div className="rm-composer-grow">
        {mq && mentionItems.length ? (
          <MentionMenu items={mentionItems} active={mentionActive} onHover={setMentionActive} onPick={insertMention} />
        ) : null}
        <textarea ref={taRef} rows={1} disabled={offline} aria-label="Message the room"
          placeholder={offline ? "Room is offline" : mode === "task" ? "Task: @assignee title (optional assignee)" : `Message ${room.name} · @agent or @all`}
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
            <button type="button" className="rm-composer-select" disabled={offline} onClick={() => { setModelOpen(!modelOpen); setPermOpen(false); setPeerOpen(false); }} title="Room agent model">
              <span className="rm-composer-model-text">{modelLabel}</span>
              <span className="rm-composer-model-icon" aria-hidden>◆</span>
              <span className="rm-composer-effort">{effort}</span>
            </button>
            {modelOpen ? (
              <div className="rm-composer-menu" role="menu">
                <div className="rm-composer-menu-label">Model</div>
                {MODELS.map((m) => (
                  <button key={m} type="button" role="menuitem" className={mc.model === m ? "is-active" : ""} onClick={() => { void patchConfig({ model: m }); setModelOpen(false); }}>{m}</button>
                ))}
                <div className="rm-composer-menu-label">Reasoning</div>
                {EFFORTS.map((e) => (
                  <button key={e} type="button" role="menuitem" className={effort === e ? "is-active" : ""} onClick={() => { void patchConfig({ reasoningEffort: e }); setModelOpen(false); }}>{e}</button>
                ))}
                <button type="button" role="menuitem" onClick={() => { setModelOpen(false); a.openDialog({ kind: "config", roomId: room.roomId }); }}>More agent settings…</button>
              </div>
            ) : null}
          </div>
          <div className="rm-composer-popwrap">
            <button type="button" className="rm-composer-select" disabled={offline} onClick={() => { setPermOpen(!permOpen); setModelOpen(false); setPeerOpen(false); }} title="Your auto-permissions">
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
            <button type="button" className="rm-composer-select rm-composer-peers" disabled={offline} onClick={() => { setPeerOpen(!peerOpen); setModelOpen(false); setPermOpen(false); }} title="Peer MCP limits on this workspace">
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
      <div className="rm-detail-section">
        <div className="rm-detail-h"><PeopleIcon />Members · {room.members.length}</div>
        {room.members.map((m) => (
          <div key={m.agentId} className="rm-member" data-agent-id={m.agentId}>
            <span className="rm-avatar-wrap"><Avatar name={m.agentId} size={26} /><span className={"rm-dot rm-dot-" + (m.online === false ? "offline" : "online")} style={{ position: "absolute", right: -1, bottom: -1, border: "2px solid var(--rm-bg)" }} /></span>
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
          <dt>Transport</dt><dd>{room.transport === "lan" ? "LAN / VPS (Node relay)" : "Relay (Cloudflare)"}</dd>
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

function EmptyMain({ store }) {
  const s = useStore(store);
  const a = store.actions;
  return (
    <div className="rm-root rm-welcome-wrap" data-collab-main="">
      <div className="rm-welcome">
        <div className="rm-badge">Collab · E2EE · no accounts</div>
        <h1>Workspaces, then rooms</h1>
        <p>Bind a local workspace (project folder), then create rooms inside it. Peers join those rooms and point their agent at the same project. @mention or tasks wake agents. Relay or LAN transport; E2EE; optional public directory.</p>
        <div className="rm-welcome-actions">
          <button type="button" className="rm-welcome-action" onClick={() => a.openDialog({ kind: "workspace" })}>
            <FolderIcon /><span><b>Bind workspace</b><span>Local project path shared by agents in rooms</span></span>
          </button>
          <button type="button" className="rm-welcome-action" onClick={() => a.openDialog({ kind: "create" })}>
            <PlusIcon /><span><b>Create room</b><span>In the active workspace · Relay or LAN</span></span>
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
  const s = useStore(store);
  // approvals rendered in ActiveRoom
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
              <div className="rm-chat-header-sub">{room.members.filter((m) => m.online !== false).length} online · {room.public ? "public" : "private"}{room.status !== "online" ? ` · room ${room.status}` : ""}</div>
            </div>
            {room.public ? <span className="rm-badge rm-badge-public"><GlobeIcon />Public</span> : <span className="rm-badge"><LockIcon />Private</span>}{room.transport === "lan" ? <span className="rm-badge">LAN/VPS</span> : null}
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
  const s = useStore(store);
  const a = store.actions;
  const [f, setF] = useState({ name: "", description: "", tags: "", public: false, mode: "relay", lanHostPort: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lanPeers, setLanPeers] = useState([]);
  const ok = f.name.trim() && !busy;
  const syncCaret = (el) => {
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
  };
  const insertMention = (it) => {
    if (!mq) return;
    const insert = `@${it.id} `;
    const next = draft.slice(0, mq.start) + insert + draft.slice(mq.end);
    setDraft(next);
    const pos = mq.start + insert.length;
    setCaret(pos);
    setMentionActive(0);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  };
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
      description="Room is created inside the active workspace (path becomes MCP sandbox). Pick Cloudflare Relay, or LAN/VPS (self-hosted Node relay). The room key never goes to the relay."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={submit}>{busy ? "Creating…" : "Create"}</Button></>}>
      <div className="rm-root rm-form" onKeyDown={(e) => e.key === "Enter" && e.target.tagName === "INPUT" && submit()}>
        <Field label="Transport" hint="Relay = Cloudflare Durable Object (default). LAN / VPS = Node relay: leave host blank for embedded local+mDNS, or set a public VPS like 62.234.113.56:80.">
          <div className="rm-mode-row">
            <button type="button" className={"rm-mode-btn" + (f.mode === "relay" ? " is-on" : "")} onClick={() => setF({ ...f, mode: "relay" })}>Relay (CF)</button>
            <button type="button" className={"rm-mode-btn" + (f.mode === "lan" ? " is-on" : "")} onClick={() => setF({ ...f, mode: "lan", public: false })}>LAN / VPS</button>
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
          <Field label="Relay host:port (optional)" htmlFor="rm-lan-hp" hint="Blank = this machine (LAN/Tailscale + mDNS). Or a VPS/custom Node relay, e.g. 62.234.113.56:80 (invite becomes collab://lan/host:port/room#key). Invite-only — no public directory on VPS yet.">
            <Input id="rm-lan-hp" placeholder="62.234.113.56:80 or 100.x.x.x:7421" value={f.lanHostPort} onChange={(e) => setF({ ...f, lanHostPort: e.target.value })} />
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
  const s = useStore(store);
  const a = store.actions;
  const [invite, setInvite] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const valid = /^collab:\/\/(join|lan|relay)\/.+#\S+$/.test(invite.trim());
  const syncCaret = (el) => {
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
  };
  const insertMention = (it) => {
    if (!mq) return;
    const insert = `@${it.id} `;
    const next = draft.slice(0, mq.start) + insert + draft.slice(mq.end);
    setDraft(next);
    const pos = mq.start + insert.length;
    setCaret(pos);
    setMentionActive(0);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  };
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try { await a.join(invite.trim()); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Join room" closeLabel="Close"
      description="Paste an invite. The room attaches to your active workspace — set the local path to your checkout of the same project before collaborating via MCP."
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
    <Modal open onClose={a.closeDialog} title={`Leave "${d.name}"?`} closeLabel="Close"
      description="This machine forgets the room and its invite. If you listed it publicly, the listing is removed."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await a.leave(d.roomId); } catch (e) { a.toast(e.message); setBusy(false); } }}>{busy ? "Leaving…" : "Leave"}</Button></>} />
  );
}


function ConfigDialog({ store, d }) {
  const s = useStore(store);
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
  const syncCaret = (el) => {
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
  };
  const insertMention = (it) => {
    if (!mq) return;
    const insert = `@${it.id} `;
    const next = draft.slice(0, mq.start) + insert + draft.slice(mq.end);
    setDraft(next);
    const pos = mq.start + insert.length;
    setCaret(pos);
    setMentionActive(0);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  };
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
  const syncCaret = (el) => {
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
  };
  const insertMention = (it) => {
    if (!mq) return;
    const insert = `@${it.id} `;
    const next = draft.slice(0, mq.start) + insert + draft.slice(mq.end);
    setDraft(next);
    const pos = mq.start + insert.length;
    setCaret(pos);
    setMentionActive(0);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  };
  const submit = async () => {
    if (!path.trim()) { setErr("Absolute workspace path required"); return; }
    setBusy(true); setErr(null);
    try {
      await a.ensureWorkspace({ name: name.trim() || undefined, path: path.trim() });
      a.closeDialog();
      a.toast("Workspace ready — create a room to collaborate");
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal open onClose={a.closeDialog} title="Workspace" closeLabel="Close"
      description="Pick the local project folder agents share. Rooms created next inherit this path (MCP + agent cwd). Peers map the same logical project to their own checkout."
      footer={<><Button variant="outline" onClick={a.closeDialog}>Cancel</Button><Button variant="primary" disabled={busy || !path.trim()} onClick={submit}>{busy ? "Saving…" : "Use workspace"}</Button></>}>
      <div className="rm-root rm-form">
        {(s.workspaces || []).length ? (
          <Field label="Switch to existing">
            <div className="rm-lan-browse">
              {(s.workspaces || []).map((w) => (
                <button key={w.id} type="button" className="rm-lan-peer" onClick={async () => { await a.setActiveWorkspace(w.id); a.closeDialog(); }}>{w.name}</button>
              ))}
            </div>
          </Field>
        ) : null}
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
      {d?.kind === "workspace" ? <WorkspaceDialog store={store} /> : null}
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

export function apply(ctx) {
  const store = createRoomsStore();
  ctx.effect(() => installStyles(), "dsh-room: styles");
  ctx.effect(() => () => store.dispose(), "dsh-room: store");
  const info = () => ctx.layout.panelInfo;
  const ensurePanel = () => { try { if (info().getSnapshot().activePanelId !== PANEL_ID) ctx.layout.selectPanel(PANEL_ID); } catch { /* layout busy */ } };

  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 11, label: () => "DSH Room" }, PanelIcon));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, inject: () => ({ store }) }, RoomsMain));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-room-dialogs", inject: () => ({ store }) }, Overlay));
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
