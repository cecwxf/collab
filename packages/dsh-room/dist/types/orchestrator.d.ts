/**
 * Orchestration core for local multi-agent rooms (pure, unit-tested):
 *  - routeLocalTargets: which local agents a room payload wakes (@agent → that one, @all → all workers in parallel,
 *    tasks → assignee / moderator). Only addressed agents respond; plain replies wake nobody.
 *  - ThreadTracker: agent-to-agent turn limit per task/thread (human posts reset the budget).
 *  - RunScheduler: concurrency cap for local agent runs with a visible FIFO queue and Stop.
 */
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
export declare function resolveLocalMention(token: string, agents: LocalAgentConfig[]): LocalAgentConfig | undefined;
export declare function routeLocalTargets(p: RoutablePayload, agents: LocalAgentConfig[]): RouteResult;
/** Turn budget per thread. A thread is a task (`task:<id>`) or a reply chain rooted at a human/new message. */
export declare class ThreadTracker {
    limit: number;
    private threadOf;
    private turns;
    private notified;
    constructor(limit: number);
    /** Thread of a payload: task id, known reply chain, the sender's current run thread, else a new thread. */
    threadFor(p: RoutablePayload, senderRunThread?: string): string;
    /** Record a message (or `task:<id>`) as belonging to a thread. */
    note(id: string, thread: string): void;
    /** A human post opens a fresh budget for its thread. */
    reset(thread: string): void;
    used(thread: string): number;
    /** Consume up to n turns; returns how many are allowed (0 when the thread is at its limit). */
    consume(thread: string, n: number): number;
    /** True once per thread when the limit first blocks it (so the room is told exactly once). */
    shouldNotify(thread: string): boolean;
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
export interface RunInfo {
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
export declare class RunScheduler {
    private exec;
    private limitFor;
    private onChange;
    private runs;
    private reqs;
    private aborts;
    private gates;
    private idleWaiters;
    constructor(exec: Exec, limitFor: (roomId: string) => number, onChange?: () => void);
    enqueue(req: RunRequest): RunInfo;
    /** Active (approval/queued/running) runs plus the most recent finished ones. */
    list(roomId?: string, finished?: number): RunInfo[];
    running(roomId: string): number;
    isExecuting(roomId: string, agentId: string): boolean;
    /** Stop every queued/running run in a room (optionally one agent). Returns how many were stopped. */
    stop(roomId: string, agentId?: string): number;
    /** Resolves when no run is approval/queued/running (tests, e2e). */
    whenIdle(): Promise<void>;
    private pump;
    private start;
    private finish;
    private busy;
    private changed;
}
export {};
//# sourceMappingURL=orchestrator.d.ts.map