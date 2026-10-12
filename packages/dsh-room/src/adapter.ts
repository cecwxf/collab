/**
 * Structural types for the subset of the DeepSeek Harness (dsh 0.2.x) host API this plugin uses.
 * Verified against @deepseek-ai/dsh@0.2.0-rc.2 (dsh-tools, dsh-agent, dsh-webhook, cordis 4).
 * Declared structurally so the plugin builds and bundles WITHOUT importing any @deepseek-ai package:
 * a plugin installed into a profile's node_modules cannot rely on resolving dsh internals.
 */

export interface ContentBlock {
  type: "text";
  text: string;
}

/** Mirrors dsh-tools `ToolDefinition` (what `defineTool` produces). `parameters` is plain JSON Schema. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    /** JSON Schema enforced on the returned value; `{}` accepts any lossless JSON. */
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): ContentBlock[];
  };
  execute(args: unknown, exec: { signal?: AbortSignal; agent?: unknown }): Promise<unknown>;
  timeoutMs?: number;
}

export interface ToolRegistry {
  /** Returns an unregister function. */
  register(def: ToolDefinition): () => void;
}

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
  debug?(...a: unknown[]): void;
}

/** Cordis 4 Context subset. */
export interface HostContext {
  tools: ToolRegistry;
  logger: Logger;
  /** Register a cleanup tied to this plugin fiber (runs on unload / reload). */
  effect(execute: () => () => void, label?: string): unknown;
  /** Non-throwing service lookup; used for the optional agent services. */
  get(name: string, strict?: boolean): any;
  /** Cordis: run callback once the named services are available (optional deps). */
  inject?(deps: string[], callback: (ctx: any) => void): unknown;
}

/** User message as dsh-llm `createUserMessage` builds it; unknown source kinds are allowed. */
export interface UserMessage {
  readonly role: "user";
  readonly id: string;
  readonly content: readonly ContentBlock[];
  readonly source: { kind: string; form?: "notice"; summary?: string; [k: string]: unknown };
}

/** The subset of dsh-agent `Agent` the plugin uses. */
export interface AgentLike {
  session: unknown;
  followup(message: UserMessage): void;
  /** Queue model-facing context without waking (dsh-agent Agent.inject). */
  inject?(message: UserMessage): void;
}

/** dsh-commands CommandInvocation subset. */
export interface CommandInvocation {
  agent: AgentLike;
  rawInput: string;
  signal: AbortSignal;
}
export type CommandResult = { kind: "success"; text?: string } | { kind: "error"; text: string };
export interface CommandDefinition {
  name: string;
  description: string;
  input?: { hint: string };
  handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult>;
}

export interface AgentHandle {
  agent: AgentLike;
  dispose(): Promise<void>;
}

/** Services used to create and prompt a session (same set dsh-webhook injects). */
export interface AgentServices {
  agents: {
    create(options: {
      sessionId: string;
      signal?: AbortSignal;
      meta: { cwd: string; agentPreset?: string };
      agentOptions: { provider: string; model: string; reasoningEffort?: string };
      setup?: (agentCtx: unknown) => Promise<void>;
    }): Promise<AgentHandle>;
  };
  agentDefaultModel: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } };
  agentPresets: {
    resolve(id?: string): Promise<{ id: string }>;
    acquireScope(id?: string): Promise<{ key: unknown } & AsyncDisposable>;
    mount(ctx: unknown, id?: string): Promise<unknown>;
  };
  permissionPresets: { resolve(name: string): unknown; set(session: unknown, name: string): void };
  sessionTitle: { rename(session: unknown, title: string): void };
  workspaceRegistry: {
    create(path: string, title?: string): Promise<{ path: string; attachSession(id: string): Promise<void> }>;
  };
}

export interface DshCollabConfig {
  /** Relay base URL (directory + default join). Default: ws://62.234.113.56:80 */
  relayUrl: string;
  /** Room to auto-join on start (collab://join/<roomId>#<roomKey>). */
  invite?: string;
  /** Runtime room state (joined rooms + invites), mode 600. Default ~/.collab/state.json */
  statePath: string;
  /** Identity file (Ed25519 key + agentId). Default ~/.collab/identity.json */
  identityPath: string;
  /** agentId used when the identity file is created for the first time (what peers @mention). */
  agentName?: string;
  autoReply: "off" | "mention" | "mention-or-task";
  /** Workspace (cwd) for sessions woken by the room. Default ~/.collab/workspace */
  workspacePath: string;
  agentPreset?: string;
  /** Permission preset for woken sessions. Room input is untrusted: default read-only. */
  permissionPreset: string;
  /** Wake on chats that are replies (replyTo set). Default false: prevents agent ping-pong. */
  wakeOnReplies: boolean;
  /** Upper bound on wakes per minute (loop guard). Default 6. */
  maxWakesPerMinute: number;
  /** How local agent runs execute: "dsh" (real sessions, default) or "mock" (deterministic, no model calls). */
  localAgentRunner?: "dsh" | "mock";
}
