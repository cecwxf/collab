import type { RoomMemberConfig } from "./member-config.js";
import type { RoomLocalSettings } from "./local-agents.js";
/** Normalize workspace paths for equality (macOS /private/var|/private/tmp, trailing slashes, backslashes). */
export declare function normalizeWorkspacePath(path: string | undefined | null): string;
export declare function sameWorkspacePath(a: string | undefined | null, b: string | undefined | null): boolean;
/** A local workspace that owns one or more Collab rooms. */
export interface WorkspaceMeta {
    id: string;
    /** Display name */
    name: string;
    /** Absolute path on this machine (MCP sandbox / agent cwd). */
    path: string;
    createdAt: number;
}
/** One joined room. The invite carries the room key. */
export interface RoomMeta {
    roomId: string;
    invite: string;
    name: string;
    description: string;
    tags: string[];
    /** Listed in the relay's public directory (not confidential). */
    public: boolean;
    /** Created here: this identity signs the directory listing. */
    owner: boolean;
    /** dsh Session the room wakes (where /collab create|join ran, or the auto-created one). */
    sessionId?: string;
    joinedAt: number;
    /** Dual transport: relay (CF) or lan (local relay). */
    transport?: "relay" | "lan";
    /** Per-room local agent config (model, workspace, permissions). Keys never stored. */
    memberConfig?: RoomMemberConfig;
    /** Workspace this room belongs to (required for new rooms). */
    workspaceId?: string;
    /** Native dsh sidebar workspace id (data-row-key workspace:…); used to pin the room under that row. */
    hostWorkspaceId?: string;
    /** Local multi-agent settings (agents hosted by this dsh, turn limit, concurrency, loopback). */
    local?: RoomLocalSettings;
    /** local agentId → dsh session id it runs in. */
    agentSessions?: Record<string, string>;
    /** Local agents whose model rejected their reasoning effort (their sessions use the model default). */
    agentNoEffort?: string[];
}
/**
 * Runtime room state written by the DSH Room UI and `/collab` so no cordis yml edit is needed.
 * Invites carry room keys, so the file is always mode 600 inside a mode 700 dir.
 */
export interface RoomState {
    version: 4;
    activeWorkspaceId: string | null;
    activeRoomId: string | null;
    workspaces: WorkspaceMeta[];
    rooms: RoomMeta[];
    updatedAt?: string;
}
export declare function createWorkspaceMeta(name: string, path: string): WorkspaceMeta;
export declare function loadState(path: string): Promise<RoomState | null>;
export declare function saveState(path: string, state: RoomState): Promise<void>;
export declare function clearState(path: string): Promise<void>;
//# sourceMappingURL=state.d.ts.map