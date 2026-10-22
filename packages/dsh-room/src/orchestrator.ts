/**
 * Orchestration core for local multi-agent rooms (pure, unit-tested):
 *  - routeLocalTargets: which local agents a room payload wakes (@agent → that one, @all → all workers in parallel,
 *    tasks → assignee / moderator). Only addressed agents respond; plain replies wake nobody.
 *  - ThreadTracker: agent-to-agent turn limit per task/thread (human posts reset the budget).
 *  - RunScheduler: concurrency cap for local agent runs with a visible FIFO queue and Stop.
 */
import type { ExecutionActivity } from "@collab/protocol";
import type { LocalAgentConfig } from "./local-agents.js";

export interface RoutablePayload {
  kind: string;
  messageId: string;
  sender: string;
  mentions?: string[];
  replyTo?: string;
  taskId?: string;
  assignee?: string;
}

export interface RouteResult {
  targets: string[];
  reason: "mention" | "all" | "task" | "task-moderator" | "none";
}

/** Resolve a mention token to a local agent: exact agentId, else unique slug/name alias (e.g. "@coder"). */
export function resolveLocalMention(token: string, agents: LocalAgentConfig[]): LocalAgentConfig | undefined {
  const t = token.replace(/^@/, "").toLowerCase();
  const exact = agents.find((a) => a.agentId.toLowerCase() === t);
  if (exact) return exact;
  const alias = agents.filter((a) => a.id.toLowerCase() === t || a.name.toLowerCase() === t);
  return alias.length === 1 ? alias[0] : undefined;
}

export function routeLocalTargets(p: RoutablePayload, agents: LocalAgentConfig[]): RouteResult {
  const others = agents.filter((a) => a.agentId !== p.sender);
  if (!others.length) return { targets: [], reason: "none" };
  if (p.kind === "chat") {
    const mentions = p.mentions ?? [];
    if (mentions.includes("all")) {
      const workers = others.filter((a) => !a.moderator);
      const explicit = mentions.map((m) => resolveLocalMention(m, others)).filter((a): a is LocalAgentConfig => !!a);
      const set = new Set([...workers, ...explicit].map((a) => a.agentId));
      return { targets: [...set], reason: "all" };
    }
    const hit = new Set<string>();
    for (const m of mentions) {
      const a = resolveLocalMention(m, others);
      if (a) hit.add(a.agentId);
    }
    return hit.size ? { targets: [...hit], reason: "mention" } : { targets: [], reason: "none" };
  }
  if (p.kind === "task.create") {
    if (p.assignee) {
      const a = resolveLocalMention(p.assignee, others);
      return a ? { targets: [a.agentId], reason: "task" } : { targets: [], reason: "none" };
    }
    const mod = others.find((a) => a.moderator);
    if (mod) return { targets: [mod.agentId], reason: "task-moderator" };
    const workers = others.filter((a) => !a.moderator);
    return { targets: workers.map((a) => a.agentId), reason: "task" };
  }
  return { targets: [], reason: "none" };
}

/** Turn budget per thread. A thread is a task (`task:<id>`) or a reply chain rooted at a human/new message. */
export class ThreadTracker {
  private threadOf = new Map<string, string>();
  private turns = new Map<string, number>();
  private notified = new Set<string>();
  constructor(public limit: number) {}

  /** Thread of a payload: task id, known reply chain, the sender's current run thread, else a new thread. */
  threadFor(p: RoutablePayload, senderRunThread?: string): string {
    const known = this.threadOf.get(p.messageId);
    if (known) return known;
    let t: string;
    if (p.kind.startsWith("task.") && p.taskId) t = this.threadOf.get(`task:${p.taskId}`) ?? `task:${p.taskId}`;
    else if (p.replyTo && this.threadOf.has(p.replyTo)) t = this.threadOf.get(p.replyTo)!;
    else if (senderRunThread) t = senderRunThread;
    else t = p.messageId;
    this.note(p.messageId, t);
    return t;
  }
  /** Record a message (or `task:<id>`) as belonging to a thread. */
  note(id: string, thread: string) {
    this.threadOf.set(id, thread);
    if (this.threadOf.size > 5000) this.threadOf.delete(this.threadOf.keys().next().value!);
  }
  /** A human post opens a fresh budget for its thread. */
  reset(thread: string) {
    this.turns.delete(thread);
    this.notified.delete(thread);
  }
  used(thread: string) {
    return this.turns.get(thread) ?? 0;
  }
  /** Consume up to n turns; returns how many are allowed (0 when the thread is at its limit). */
  consume(thread: string, n: number): number {
    const used = this.used(thread);
    const allowed = Math.max(0, Math.min(n, this.limit === 0 ? n : this.limit - used));
    if (allowed) this.turns.set(thread, used + allowed);
    return allowed;
  }
  /** True once per thread when the limit first blocks it (so the room is told exactly once). */
  shouldNotify(thread: string): boolean {
    if (this.notified.has(thread)) return false;
    this.notified.add(thread);
    return true;
  }
}

export type RunState = "approval" | "queued" | "running" | "done" | "failed" | "stopped";

export interface RunRequest {
  roomId: string;
  agentId: string;
  threadId: string;
  reason: string;
  /** Message/task that triggered the run. */
  triggerId?: string;
  /** Human-readable trigger summary for the queue UI. */
  summary: string;
  /** Optional pre-queue gate (e.g. user approval); false → run is stopped without starting. */
  gate?: (signal: AbortSignal) => Promise<boolean>;
  [k: string]: unknown;
}

export type RunPhase = "working" | "thinking" | "streaming" | "tool";

export interface RunInfo {
  activity?: ExecutionActivity;
  phase?: RunPhase;
  remote?: boolean;
  id: string;
  roomId: string;
  agentId: string;
  threadId: string;
  reason: string;
  triggerId?: string;
  summary: string;
  state: RunState;
  enqueuedAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

type Exec = (run: RunInfo, req: RunRequest, signal: AbortSignal) => Promise<void>;

let runSeq = 0;

export class RunScheduler {
  private runs: RunInfo[] = [];
  private reqs = new Map<string, RunRequest>();
  private aborts = new Map<string, AbortController>();
  private gates = new Map<string, AbortController>();
  private idleWaiters: (() => void)[] = [];
  constructor(
    private exec: Exec,
    private limitFor: (roomId: string) => number,
    private onChange: () => void = () => {},
  ) {}

  enqueue(req: RunRequest): RunInfo {
    const run: RunInfo = {
      id: `run-${Date.now().toString(36)}-${(++runSeq).toString(36)}`,
      roomId: req.roomId,
      agentId: req.agentId,
      threadId: req.threadId,
      reason: req.reason,
      triggerId: req.triggerId,
      summary: req.summary.slice(0, 160),
      state: req.gate ? "approval" : "queued",
      enqueuedAt: Date.now(),
    };
    this.runs.push(run);
    this.reqs.set(run.id, req);
    this.changed();
    if (req.gate) {
      const gate = req.gate;
      const ac = new AbortController();
      this.gates.set(run.id, ac);
      Promise.resolve().then(() => ac.signal.aborted ? false : gate(ac.signal)).then(
        (ok) => {
          if (run.state !== "approval") return;
          if (ok) run.state = "queued";
          else this.finish(run, "stopped", "approval denied");
          this.pump();
        },
        (e) => {
          if (run.state === "approval") this.finish(run, "failed", (e as Error).message);
          this.pump();
        },
      ).finally(() => { this.gates.delete(run.id); this.pump(); });
    } else this.pump();
    return run;
  }

  /** Active (approval/queued/running) runs plus the most recent finished ones. */
  list(roomId?: string, finished = 8): RunInfo[] {
    const mine = this.runs.filter((r) => !roomId || r.roomId === roomId);
    const active = mine.filter((r) => r.state === "approval" || r.state === "queued" || r.state === "running");
    const done = finished > 0 ? mine.filter((r) => !active.includes(r)).slice(-finished) : [];
    return [...active, ...done].map((r) => ({ ...r }));
  }

  running(roomId: string) {
    return this.runs.filter((r) => r.roomId === roomId && this.aborts.has(r.id)).length;
  }

  isExecuting(roomId: string, agentId: string): boolean {
    return this.runs.some((r) => r.roomId === roomId && r.agentId === agentId && this.aborts.has(r.id));
  }

  /** Stop every queued/running run in a room (optionally one agent). Returns how many were stopped. */
  stop(roomId: string, agentId?: string): number {
    let n = 0;
    for (const r of this.runs) {
      if (r.roomId !== roomId || (agentId && r.agentId !== agentId)) continue;
      if (r.state === "approval" || r.state === "queued") {
        this.gates.get(r.id)?.abort();
        this.finish(r, "stopped", "stopped by user");
        n++;
      } else if (r.state === "running") {
        this.aborts.get(r.id)?.abort(new Error("stopped by user"));
        this.finish(r, "stopped", "stopped by user");
        n++;
      }
    }
    this.pump();
    return n;
  }

  /** Resolves when no run is approval/queued/running (tests, e2e). */
  whenIdle(): Promise<void> {
    if (!this.busy()) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  /** Apply changed room limits immediately to the waiting queue. */
  refresh() { this.pump(); }

  setPhase(roomId: string, agentId: string, phase: RunPhase) {
    const run = this.runs.find(r => r.roomId === roomId && r.agentId === agentId && r.state === "running");
    if (run && run.phase !== phase) { run.phase = phase; this.changed(); }
  }

  updateActivity(roomId: string, agentId: string, update: (run: RunInfo) => void) {
    const run = this.runs.find(r => r.roomId === roomId && r.agentId === agentId && r.state === "running");
    if (!run) return;
    update(run);
    this.changed();
  }

  private pump() {
    for (const run of this.runs) {
      if (run.state !== "queued") continue;
      const limit = this.limitFor(run.roomId);
      if (limit > 0 && this.running(run.roomId) >= limit) continue;
      if (this.isExecuting(run.roomId, run.agentId)) continue;
      this.start(run);
    }
    this.changed();
    if (!this.busy()) {
      const w = this.idleWaiters;
      this.idleWaiters = [];
      for (const fn of w) fn();
    }
  }

  private start(run: RunInfo) {
    const ac = new AbortController();
    this.aborts.set(run.id, ac);
    run.state = "running";
    run.phase = "working";
    run.startedAt = Date.now();
    const req = this.reqs.get(run.id)!;
    Promise.resolve()
      .then(() => { if (!ac.signal.aborted) return this.exec(run, req, ac.signal); })
      .then(
        () => run.state === "running" && this.finish(run, "done"),
        (e) => run.state === "running" && this.finish(run, ac.signal.aborted ? "stopped" : "failed", (e as Error)?.message ?? String(e)),
      )
      .finally(() => {
        this.aborts.delete(run.id);
        this.pump();
      });
  }

  private finish(run: RunInfo, state: RunState, error?: string) {
    run.state = state;
    for (const tool of run.activity?.tools ?? []) if (tool.state === "running") tool.state = "stopped";
    run.endedAt = Date.now();
    if (error) run.error = error;
    this.reqs.delete(run.id);
    // keep memory bounded
    if (this.runs.length > 400) {
      const active = this.runs.filter((r) => r.state === "approval" || r.state === "queued" || this.aborts.has(r.id) || this.gates.has(r.id));
      const finished = this.runs.filter((r) => !active.includes(r)).slice(-300);
      const keep = new Set([...active, ...finished]);
      this.runs = this.runs.filter((r) => keep.has(r));
    }
    this.changed();
  }

  private busy() {
    return this.aborts.size > 0 || this.gates.size > 0 || this.runs.some((r) => r.state === "approval" || r.state === "queued");
  }

  private changed() {
    try {
      this.onChange();
    } catch {
      /* */
    }
  }
}
