/** Per-member local agent settings for a room. Never includes API keys. */

export type ReasoningEffort = "low" | "medium" | "high" | "max";

/** How a peer MCP call is handled for one capability. */
export type PeerGrant = "auto" | "ask" | "deny";

export interface PeerCapabilityGrants {
  read: PeerGrant;
  write: PeerGrant;
  exec: PeerGrant;
  delete: PeerGrant;
}

export interface RoomMemberConfig {
  model?: string;
  provider?: string;
  reasoningEffort?: ReasoningEffort;
  /** Absolute workspace root; peers only see workspaceLabel. */
  workspacePath: string;
  workspaceLabel: string;
  /** Your agent's auto-allow for local wake / tooling cues. */
  permissions: {
    autoRead: boolean;
    autoWrite: boolean;
    autoShell: boolean;
    autoNetwork: boolean;
  };
  mcpEnabled: boolean;
  /**
   * Limits for what *other room members* may do via MCP on this workspace.
   * default applies to every peer; byAgent overrides per agentId.
   */
  peerGrants?: {
    default: PeerCapabilityGrants;
    byAgent?: Record<string, Partial<PeerCapabilityGrants>>;
  };
}

export const MCP_TOOL_NAMES = [
  "workspace_list",
  "workspace_read",
  "workspace_stat",
  "workspace_search",
  "workspace_write",
  "workspace_mkdir",
  "workspace_delete",
  "workspace_exec",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export function defaultPeerGrants(): PeerCapabilityGrants {
  return { read: "auto", write: "ask", exec: "ask", delete: "ask" };
}

export function defaultMemberConfig(workspacePath: string): RoomMemberConfig {
  const label = workspacePath.split(/[/\\]/).filter(Boolean).pop() || "workspace";
  return {
    workspacePath,
    workspaceLabel: label,
    permissions: {
      autoRead: true,
      autoWrite: false,
      autoShell: false,
      autoNetwork: false,
    },
    mcpEnabled: true,
    peerGrants: { default: defaultPeerGrants(), byAgent: {} },
  };
}

export function resolvePeerGrant(cfg: RoomMemberConfig, from: string, cap: keyof PeerCapabilityGrants): PeerGrant {
  const pg = cfg.peerGrants ?? { default: defaultPeerGrants() };
  const over = pg.byAgent?.[from];
  return (over?.[cap] ?? pg.default[cap] ?? "ask") as PeerGrant;
}

export function publicMemberConfig(cfg: RoomMemberConfig) {
  return {
    model: cfg.model,
    provider: cfg.provider,
    reasoningEffort: cfg.reasoningEffort,
    workspaceLabel: cfg.workspaceLabel,
    permissions: { ...cfg.permissions },
    mcpEnabled: cfg.mcpEnabled,
    mcpTools: cfg.mcpEnabled ? [...MCP_TOOL_NAMES] : [],
    peerGrantsDefault: cfg.peerGrants?.default ?? defaultPeerGrants(),
  };
}
