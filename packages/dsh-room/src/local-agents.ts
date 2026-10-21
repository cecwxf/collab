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

export const DEFAULT_TURN_LIMIT = 0;
export const DEFAULT_CONCURRENCY = 0;

export function defaultLocalSettings(): RoomLocalSettings {
  return { agents: [], turnLimit: DEFAULT_TURN_LIMIT, concurrency: DEFAULT_CONCURRENCY, loopback: false, isolation: "auto" };
}

export function normalizeLocalSettings(s?: Partial<RoomLocalSettings> | null): RoomLocalSettings {
  const d = defaultLocalSettings();
  const n = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
  return {
    agents: Array.isArray(s?.agents) ? s!.agents : d.agents,
    turnLimit: n(s?.turnLimit, d.turnLimit, 0, 100),
    concurrency: n(s?.concurrency, d.concurrency, 0, 16),
    loopback: s?.loopback === true,
    isolation: s?.isolation && ["auto", "worktree", "locks", "off"].includes(s.isolation) ? s.isolation : d.isolation,
  };
}

export interface AgentPreset {
  key: string;
  name: string;
  persona: string;
  systemPrompt: string;
  scope: AgentScope;
  moderator?: boolean;
  reasoningEffort?: ReasoningEffort;
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    key: "moderator",
    name: "Moderator",
    persona: "Breaks requests into tasks, assigns them, and summarizes results",
    systemPrompt:
      "You coordinate the room. Do not do the implementation yourself. Split the request into small tasks and create one task per agent with collab_create_task (assignee = that agent's id). When all tasks are done you will be asked to summarize: post one concise summary with collab_send.",
    scope: "read",
    moderator: true,
    reasoningEffort: "medium",
  },
  {
    key: "architect",
    name: "Architect",
    persona: "Designs the approach, interfaces and file layout",
    systemPrompt: "You design before anyone codes: propose structure, interfaces, and risks. Keep answers short and concrete. You do not edit files.",
    scope: "read",
    reasoningEffort: "high",
  },
  {
    key: "coder",
    name: "Coder",
    persona: "Implements changes in its own worktree",
    systemPrompt: "You implement. Make minimal, focused edits in your working directory, run what you can to check them, then report what changed.",
    scope: "write",
    reasoningEffort: "medium",
  },
  {
    key: "reviewer",
    name: "Reviewer",
    persona: "Reviews diffs and points out bugs and risks",
    systemPrompt: "You review. Read the relevant files/diffs and list concrete bugs, risks and missing tests. Be specific; no rewrites.",
    scope: "read",
    reasoningEffort: "high",
  },
];

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "agent"
  );
}

/** Member id for a local agent: <slug>.<host tag>, unique among `taken`. Valid @mention token. */
export function localAgentId(name: string, hostAgentId: string, taken: Iterable<string>): string {
  const tag = (hostAgentId.replace(/[^A-Za-z0-9]/g, "").slice(-4) || "host").toLowerCase();
  const base = `${slugify(name)}.${tag}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  throw new Error("cannot allocate agent id");
}

/** Validate + clean a user-supplied agent patch (never trusts ids/agentId from the client). */
export function sanitizeAgentInput(input: Record<string, unknown>): Partial<LocalAgentConfig> {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
  const out: Partial<LocalAgentConfig> = {};
  const name = str(input.name, 40);
  if (name !== undefined) out.name = name;
  const persona = str(input.persona, 200);
  if (persona !== undefined) out.persona = persona;
  const sp = str(input.systemPrompt, 4000);
  if (sp !== undefined) out.systemPrompt = sp;
  const model = str(input.model, 80);
  if (model !== undefined) out.model = model || undefined;
  const provider = str(input.provider, 80);
  if (provider !== undefined) out.provider = provider || undefined;
  if (input.reasoningEffort === "low" || input.reasoningEffort === "medium" || input.reasoningEffort === "high" || input.reasoningEffort === "max") out.reasoningEffort = input.reasoningEffort;
  if (input.scope === "read" || input.scope === "write") out.scope = input.scope;
  if (typeof input.approvalRequired === "boolean") out.approvalRequired = input.approvalRequired;
  if (typeof input.moderator === "boolean") out.moderator = input.moderator;
  return out;
}
