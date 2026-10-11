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
export declare const MCP_TOOL_NAMES: readonly ["workspace_list", "workspace_read", "workspace_stat", "workspace_search", "workspace_write", "workspace_mkdir", "workspace_delete", "workspace_exec"];
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
export declare function defaultPeerGrants(): PeerCapabilityGrants;
export declare function defaultMemberConfig(workspacePath: string): RoomMemberConfig;
export declare function resolvePeerGrant(cfg: RoomMemberConfig, from: string, cap: keyof PeerCapabilityGrants): PeerGrant;
export declare function publicMemberConfig(cfg: RoomMemberConfig): {
    model: string | undefined;
    provider: string | undefined;
    reasoningEffort: ReasoningEffort | undefined;
    workspaceLabel: string;
    permissions: {
        autoRead: boolean;
        autoWrite: boolean;
        autoShell: boolean;
        autoNetwork: boolean;
    };
    mcpEnabled: boolean;
    mcpTools: ("workspace_list" | "workspace_read" | "workspace_stat" | "workspace_search" | "workspace_write" | "workspace_mkdir" | "workspace_delete" | "workspace_exec")[];
    peerGrantsDefault: PeerCapabilityGrants;
};
//# sourceMappingURL=member-config.d.ts.map