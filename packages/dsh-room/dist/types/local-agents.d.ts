/**
 * Local agent members: several agents hosted by ONE dsh, each an independent room member
 * (own Ed25519 identity, own dsh session, own scope). Remote peers just see more members.
 */
import type { ReasoningEffort } from "./member-config.js";
export type AgentScope = "read" | "write";
export type IsolationMode = "auto" | "worktree" | "locks" | "off";
export interface LocalAgentConfig {
    /** Stable local id (slug of the name). */
    id: string;
    /** Room member id (what peers see and @mention), e.g. "coder.k3f9". */
    agentId: string;
    /** Display / persona name, e.g. "Coder". */
    name: string;
    /** One-line role description shown to other agents. */
    persona?: string;
    /** Extra instructions prepended to every wake of this agent. */
    systemPrompt?: string;
    model?: string;
    provider?: string;
    reasoningEffort?: ReasoningEffort;
    /** read: read-only session in the main workspace; write: may edit (own worktree when git). */
    scope: AgentScope;
    /** Every run needs a user approval before it starts. */
    approvalRequired: boolean;
    /** Room moderator: decomposes requests into tasks for the others and summarizes. */
    moderator?: boolean;
    createdAt: number;
}
export interface RoomLocalSettings {
    agents: LocalAgentConfig[];
    /** Max agent-originated wakes per task/thread before the room pauses that thread; 0 means unlimited. */
    turnLimit: number;
    /** Max local agent runs in parallel; the rest wait in a visible queue; 0 means all agents concurrently. */
    concurrency: number;
    /** In-process loopback transport (no network) — only valid while all members are local. */
    loopback: boolean;
    isolation: IsolationMode;
}
export declare const DEFAULT_TURN_LIMIT = 0;
export declare const DEFAULT_CONCURRENCY = 0;
export declare function defaultLocalSettings(): RoomLocalSettings;
export declare function normalizeLocalSettings(s?: Partial<RoomLocalSettings> | null): RoomLocalSettings;
export interface AgentPreset {
    key: string;
    name: string;
    persona: string;
    systemPrompt: string;
    scope: AgentScope;
    moderator?: boolean;
    reasoningEffort?: ReasoningEffort;
}
export declare const AGENT_PRESETS: AgentPreset[];
export declare function slugify(s: string): string;
/** Member id for a local agent: <slug>.<host tag>, unique among `taken`. Valid @mention token. */
export declare function localAgentId(name: string, hostAgentId: string, taken: Iterable<string>): string;
/** Validate + clean a user-supplied agent patch (never trusts ids/agentId from the client). */
export declare function sanitizeAgentInput(input: Record<string, unknown>): Partial<LocalAgentConfig>;
//# sourceMappingURL=local-agents.d.ts.map