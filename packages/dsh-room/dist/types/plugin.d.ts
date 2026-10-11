import { DirectoryClient, type CollabPayload, type Identity } from "@collab/protocol";
import { CollabClient } from "@collab/sdk";
import { ApprovalQueue } from "./approval-queue.js";
import { publicMemberConfig, type RoomMemberConfig } from "./member-config.js";
import type { AgentLike, DshCollabConfig, HostContext, ToolDefinition } from "./adapter.js";
import { type RoomMeta, type WorkspaceMeta } from "./state.js";
export declare function describePayload(p: CollabPayload): string;
/** UI/transcript view of one decrypted room payload. */
export interface RoomMessage {
    id: string;
    seq?: number;
    from: string;
    self: boolean;
    kind: CollabPayload["kind"];
    text: string;
    ts: number;
    mentions?: string[];
    replyTo?: string;
    taskId?: string;
    title?: string;
    status?: string;
    assignee?: string;
}
export type RoomStatus = "connecting" | "online" | "offline";
export interface RoomView extends Omit<RoomMeta, "invite" | "sessionId" | "memberConfig"> {
    /** dsh Session woken for this room (shown nested under its workspace in the native sidebar). */
    sessionId?: string;
    status: RoomStatus;
    error?: string;
    members: {
        agentId: string;
        self: boolean;
        online?: boolean;
    }[];
    last?: {
        from: string;
        text: string;
        ts: number;
    };
    sessionTitle: string;
    bound: boolean;
    transport?: "relay" | "lan";
    /** Public member config (no secrets / no absolute path). */
    memberConfig?: (ReturnType<typeof publicMemberConfig> & {
        workspacePath?: string;
        peerGrants?: RoomMemberConfig["peerGrants"];
    }) | null;
    peerConfigs?: Record<string, ReturnType<typeof publicMemberConfig>>;
}
export interface BridgeEvent {
    type: "rooms" | "message";
    roomId?: string;
    message?: RoomMessage;
}
/** One live room: connection, decrypted message log, wake bookkeeping. */
declare class RoomConn {
    meta: RoomMeta;
    client: CollabClient | null;
    status: RoomStatus;
    error?: string;
    messages: RoomMessage[];
    private ids;
    wakeTimes: number[];
    heartbeat?: ReturnType<typeof setInterval>;
    /** agentId → last time we saw them in a peer_update / joined list (ms). Grace keeps UI "online" across reconnect blips. */
    lastSeenPeers: Map<string, number>;
    presenceTimer?: ReturnType<typeof setInterval>;
    constructor(meta: RoomMeta);
    add(m: RoomMessage): boolean;
    transcript(n?: number): string;
}
export interface CreateRoomOptions {
    name?: string;
    description?: string;
    tags?: string[] | string;
    public?: boolean;
    /** Dual transport: default LAN/VPS. LAN uses DEFAULT_LAN_HOST_PORT or embedded lan-relay when host blank. */
    mode?: "relay" | "lan";
    /** For LAN: host:port (default VPS). Omit/blank with mode=lan from UI embedded path uses ensureLanRelay. */
    lanHostPort?: string;
    /** Workspace that owns this room (defaults to active). */
    workspaceId?: string;
    /** Native dsh workspace path (preferred): the room attaches to it (member.config.workspace + MCP sandbox + woken session cwd). */
    workspacePath?: string;
    /** Display name of that native workspace. */
    workspaceName?: string;
}
/**
 * The live collab bridge: any number of joined rooms (each one-to-many, E2EE),
 * persisted in ~/.collab/state.json; model-facing tools; the room → Session wake path;
 * an optional public directory listing per owned room.
 */
export declare class CollabBridge {
    private ctx;
    readonly config: DshCollabConfig;
    identity: Identity | null;
    rooms: Map<string, RoomConn>;
    workspaces: Map<string, WorkspaceMeta>;
    activeWorkspaceId: string | null;
    activeRoomId: string | null;
    private sessions;
    private listeners;
    private disposed;
    private abort;
    readonly directory: DirectoryClient;
    private ready;
    readonly approvals: ApprovalQueue;
    /** peer agentId → last announced public member config */
    peerConfigs: Map<string, Map<string, {
        model: string | undefined;
        provider: string | undefined;
        reasoningEffort: import("./member-config.js").ReasoningEffort | undefined;
        workspaceLabel: string;
        permissions: {
            autoRead: boolean;
            autoWrite: boolean;
            autoShell: boolean;
            autoNetwork: boolean;
        };
        mcpEnabled: boolean;
        mcpTools: ("workspace_list" | "workspace_read" | "workspace_stat" | "workspace_search" | "workspace_write" | "workspace_mkdir" | "workspace_delete" | "workspace_exec")[];
        peerGrantsDefault: import("./member-config.js").PeerCapabilityGrants;
    }>>;
    private lanRelay;
    private mcpByRoom;
    constructor(ctx: HostContext, config: DshCollabConfig, fetchImpl?: typeof fetch);
    log(level: "info" | "warn" | "error", ...a: unknown[]): void;
    subscribe(fn: (e: BridgeEvent) => void): () => void;
    private emit;
    self(): Promise<Identity>;
    /** Load ~/.collab/state.json (+ a legacy `invite` from config) and reconnect every room. */
    start(): Promise<void>;
    persist(): Promise<void>;
    private open;
    private connect;
    listWorkspaces(): WorkspaceMeta[];
    ensureWorkspace(opts: {
        name?: string;
        path?: string;
        id?: string;
    }): Promise<WorkspaceMeta>;
    setActiveWorkspace(id: string): WorkspaceMeta;
    removeWorkspace(id: string): Promise<{
        ok: boolean;
    }>;
    /** Ensure embedded LAN relay is listening; returns host:port for invites. */
    ensureLanRelay(): Promise<string>;
    browseLan(timeoutMs?: number): Promise<import("@collab/lan-relay").LanPeer[]>;
    /** Create a room (private unless opts.public) and join it. */
    createRoom(opts?: CreateRoomOptions, bindTo?: AgentLike): Promise<{
        invite: string;
        listed: boolean;
        transport: string;
        /** dsh Session woken for this room (shown nested under its workspace in the native sidebar). */
        sessionId?: string;
        status: RoomStatus;
        error?: string;
        members: {
            agentId: string;
            self: boolean;
            online?: boolean;
        }[];
        last?: {
            from: string;
            text: string;
            ts: number;
        };
        sessionTitle: string;
        bound: boolean;
        /** Public member config (no secrets / no absolute path). */
        memberConfig?: (ReturnType<typeof publicMemberConfig> & {
            workspacePath?: string;
            peerGrants?: RoomMemberConfig["peerGrants"];
        }) | null;
        peerConfigs?: Record<string, ReturnType<typeof publicMemberConfig>>;
        roomId: string;
        public: boolean;
        name: string;
        description: string;
        tags: string[];
        owner: boolean;
        joinedAt: number;
        workspaceId?: string | undefined;
    }>;
    /** Join by invite. `info` carries directory metadata when joining from search results. */
    joinInvite(invite: string, info?: Partial<Pick<RoomMeta, "name" | "description" | "tags" | "public" | "workspaceId">> & {
        workspacePath?: string;
        workspaceName?: string;
    }, bindTo?: AgentLike): Promise<{
        invite: string;
        /** dsh Session woken for this room (shown nested under its workspace in the native sidebar). */
        sessionId?: string;
        status: RoomStatus;
        error?: string;
        members: {
            agentId: string;
            self: boolean;
            online?: boolean;
        }[];
        last?: {
            from: string;
            text: string;
            ts: number;
        };
        sessionTitle: string;
        bound: boolean;
        transport?: "relay" | "lan";
        /** Public member config (no secrets / no absolute path). */
        memberConfig?: (ReturnType<typeof publicMemberConfig> & {
            workspacePath?: string;
            peerGrants?: RoomMemberConfig["peerGrants"];
        }) | null;
        peerConfigs?: Record<string, ReturnType<typeof publicMemberConfig>>;
        roomId: string;
        public: boolean;
        name: string;
        description: string;
        tags: string[];
        owner: boolean;
        joinedAt: number;
        workspaceId?: string | undefined;
    }>;
    leave(roomId: string): Promise<{
        ok: boolean;
        left: boolean;
    }>;
    /** Room by id, else the active one. */
    room(roomId?: string): RoomConn;
    private live;
    setActive(roomId: string): void;
    private publishLocal;
    send(roomId: string | undefined, textIn: string, mentions?: string[], replyTo?: string): Promise<{
        messageId: string;
        seq: number;
        roomId: string;
    }>;
    sendStatus(roomId: string | undefined, t: string): Promise<{
        messageId: string;
        seq: number;
        roomId: string;
    }>;
    createTask(roomId: string | undefined, title: string, body?: string, assignee?: string): Promise<{
        messageId: string;
        seq: number;
        roomId: string;
        taskId: string;
    }>;
    claimTask(roomId: string | undefined, taskId: string): Promise<{
        messageId: string;
        seq: number;
        roomId: string;
    }>;
    updateTask(roomId: string | undefined, taskId: string, status: string, note?: string): Promise<{
        messageId: string;
        seq: number;
        roomId: string;
    }>;
    private publish;
    private startHeartbeat;
    search(q?: string, tag?: string): Promise<{
        joined: boolean;
        roomId: string;
        name: string;
        description: string;
        tags: string[];
        invite: string;
        members: number;
        ownerAgentId: string;
        createdAt: number;
        lastSeen: number;
    }[]>;
    view(conn: RoomConn): RoomView;
    state(): {
        self: string | null;
        relayUrl: string;
        lanRelayPort: number | null;
        activeWorkspaceId: string | null;
        activeRoomId: string | null;
        workspaces: WorkspaceMeta[];
        approvals: Omit<import("./approval-queue.js").PendingApproval, "resolve">[];
        rooms: RoomView[];
    };
    announceMemberConfig(conn: RoomConn): Promise<void>;
    updateMemberConfig(roomId: string, patch: Partial<RoomMemberConfig>): Promise<{
        model: string | undefined;
        provider: string | undefined;
        reasoningEffort: import("./member-config.js").ReasoningEffort | undefined;
        workspaceLabel: string;
        permissions: {
            autoRead: boolean;
            autoWrite: boolean;
            autoShell: boolean;
            autoNetwork: boolean;
        };
        mcpEnabled: boolean;
        mcpTools: ("workspace_list" | "workspace_read" | "workspace_stat" | "workspace_search" | "workspace_write" | "workspace_mkdir" | "workspace_delete" | "workspace_exec")[];
        peerGrantsDefault: import("./member-config.js").PeerCapabilityGrants;
    }>;
    getMemberConfig(roomId: string): {
        workspacePath: string;
        peerGrants: {
            default: import("./member-config.js").PeerCapabilityGrants;
            byAgent?: Record<string, Partial<import("./member-config.js").PeerCapabilityGrants>>;
        } | undefined;
        model: string | undefined;
        provider: string | undefined;
        reasoningEffort: import("./member-config.js").ReasoningEffort | undefined;
        workspaceLabel: string;
        permissions: {
            autoRead: boolean;
            autoWrite: boolean;
            autoShell: boolean;
            autoNetwork: boolean;
        };
        mcpEnabled: boolean;
        mcpTools: ("workspace_list" | "workspace_read" | "workspace_stat" | "workspace_search" | "workspace_write" | "workspace_mkdir" | "workspace_delete" | "workspace_exec")[];
        peerGrantsDefault: import("./member-config.js").PeerCapabilityGrants;
    };
    decideApproval(requestId: string, decision: "allow" | "deny"): Promise<{
        ok: boolean;
        requestId: string;
        decision: "allow" | "deny";
    }>;
    callLocalMcp(roomId: string, tool: string, args: Record<string, unknown>, from?: string): Promise<unknown>;
    mcpCallPeer(roomId: string, target: string, tool: string, args: Record<string, unknown>): Promise<{
        callId: string;
        pending: boolean;
    }>;
    private handleMcpCall;
    private onPayload;
    /** Loop guard: replies do not wake (unless wakeOnReplies); at most maxWakesPerMinute per room. */
    private passesLoopGuard;
    private agentServices;
    /** Bind a room to a live agent (the Session where /collab create|join ran). */
    bind(conn: RoomConn, agent: AgentLike): void;
    /** The bound live agent if its Session is open, without creating one. */
    private boundAgent;
    private notice;
    /** Non-waking room traffic reaches the bound Session as pending context (agent.inject). */
    private injectContext;
    private buildPrompt;
    private wake;
    /** Same creation sequence as @deepseek-ai/dsh-webhook createWebhookSession. */
    private sessionFor;
    dispose(): Promise<void>;
    tools(): ToolDefinition[];
}
export {};
//# sourceMappingURL=plugin.d.ts.map