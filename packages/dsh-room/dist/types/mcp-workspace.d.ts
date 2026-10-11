import type { RoomMemberConfig, McpToolName } from "./member-config.js";
import type { ApprovalQueue } from "./approval-queue.js";
export declare const MCP_TOOL_DEFS: {
    name: McpToolName;
    description: string;
    inputSchema: Record<string, unknown>;
}[];
export declare class WorkspaceMcp {
    private cfg;
    private approvals;
    private roomId;
    constructor(cfg: RoomMemberConfig, approvals: ApprovalQueue, roomId: string);
    updateConfig(cfg: RoomMemberConfig): void;
    tools(): {
        name: McpToolName;
        description: string;
        inputSchema: Record<string, unknown>;
    }[];
    private resolveSafe;
    private maybeApprove;
    call(tool: string, args: Record<string, unknown>, from: string): Promise<unknown>;
}
//# sourceMappingURL=mcp-workspace.d.ts.map