/**
 * Thin adapter so the plugin compiles without DeepSeek Harness / Cordis installed.
 * When loading inside dsh, wrap the real ctx to match these interfaces.
 */

export interface ToolParameter {
  type: string;
  description?: string;
  properties?: Record<string, ToolParameter>;
  required?: string[];
  items?: ToolParameter;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameter;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** Minimal Cordis-like context */
export interface PluginContext {
  /** Register a disposable cleanup (called on unload) */
  effect(fn: () => () => void): void;
  /** Optional logger */
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  /** Register tools if host supports it */
  registerTool?(tool: ToolDef): void;
  /** Host-provided config bag */
  config?: Record<string, unknown>;
}

export interface SessionPort {
  /** Durable session id for this room */
  id: string;
  /** Append a user/system message and optionally run the agent loop */
  notify?(text: string, meta?: Record<string, unknown>): Promise<void>;
}

export interface SessionFactory {
  /** Get or create session bound to collab:<roomId> */
  getOrCreate(sessionId: string): SessionPort;
}

export interface DshCollabConfig {
  relayUrl: string;
  identityPath?: string;
  autoReply?: "off" | "mention" | "mention-or-task";
  defaultRoom?: string | null;
}
