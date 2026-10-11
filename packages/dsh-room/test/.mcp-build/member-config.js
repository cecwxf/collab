// src/member-config.ts
var MCP_TOOL_NAMES = [
  "workspace_list",
  "workspace_read",
  "workspace_stat",
  "workspace_search",
  "workspace_write",
  "workspace_mkdir",
  "workspace_delete",
  "workspace_exec"
];
function defaultMemberConfig(workspacePath) {
  const label = workspacePath.split(/[/\\]/).filter(Boolean).pop() || "workspace";
  return {
    workspacePath,
    workspaceLabel: label,
    permissions: {
      autoRead: true,
      autoWrite: false,
      autoShell: false,
      autoNetwork: false
    },
    mcpEnabled: true
  };
}
function publicMemberConfig(cfg) {
  return {
    model: cfg.model,
    provider: cfg.provider,
    reasoningEffort: cfg.reasoningEffort,
    workspaceLabel: cfg.workspaceLabel,
    permissions: { ...cfg.permissions },
    mcpEnabled: cfg.mcpEnabled,
    mcpTools: cfg.mcpEnabled ? [...MCP_TOOL_NAMES] : []
  };
}
export {
  MCP_TOOL_NAMES,
  defaultMemberConfig,
  publicMemberConfig
};
