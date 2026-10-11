/** Per-member local agent settings for a room. Never includes API keys. */

export type ReasoningEffort = "low" | "medium" | "high" | "max";

export interface RoomMemberConfig {
  model?: string;
  provider?: string;
  reasoningEffort?: ReasoningEffort;
  /** Absolute workspace root; peers only see workspaceLabel. */
  workspacePath: string;
  workspaceLabel: string;
  permissions: {
    autoRead: boolean;
    autoWrite: boolean;
    autoShell: boolean;
    autoNetwork: boolean;
  };
  mcpEnabled: boolean;
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
  };
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
  };
}
