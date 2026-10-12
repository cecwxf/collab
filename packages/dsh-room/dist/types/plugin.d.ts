import { DirectoryClient, type CollabPayload, type Identity } from "@collab/protocol";
import { CollabClient, RoomHub } from "@collab/sdk";
import { type LocalAgentConfig, type RoomLocalSettings, type IsolationMode } from "./local-agents.js";
import { RunScheduler, ThreadTracker, type RunInfo } from "./orchestrator.js";
import { FileLocks, type WorktreeInfo } from "./isolation.js";
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
export interface RoomView extends Omit<RoomMeta, "invite" | "sessionId" | "memberConfig" | "local" | "transport"> {
    /** dsh Session woken for this room (shown nested under its workspace in the native sidebar). */
    sessionId?: string;
    status: RoomStatus;
    error?: string;
    members: {
        agentId: string;
        self: boolean;
        online?: boolean;
        local?: boolean;
        name?: string;
        persona?: string;
        hostedBy?: string;
        moderator?: boolean;
    }[];
    last?: {
        from: string;
        text: string;
        ts: number;
    };
    sessionTitle: string;
    bound: boolean;
    transport?: "relay" | "lan" | "local";
    /** Public member config (no secrets / no absolute path). */
    memberConfig?: (ReturnType<typeof publicMemberConfig> & {
        workspacePath?: string;
        peerGrants?: RoomMemberConfig["peerGrants"];
    }) | null;
    peerConfigs?: Record<string, ReturnType<typeof publicMemberConfig> & {
        displayName?: string;
        persona?: string;
        hostedBy?: string;
    }>;
    /** Local multi-agent state (agents hosted by this dsh). */
    local?: LocalView;
    /** Local agent runs: running, queued, waiting for approval, recent. */
    runs?: RunInfo[];
}
export interface LocalAgentView extends LocalAgentConfig {
    sessionId?: string;
    online: boolean;
    state: "idle" | "approval" | "queued" | "running";
    worktree?: {
        branch: string;
        path: string;
    } | null;
    isolation: "worktree" | "locks" | "read-only" | "shared";
}
export interface LocalView {
    agents: LocalAgentView[];
    turnLimit: number;
    concurrency: number;
    loopback: boolean;
    isolation: RoomLocalSettings["isolation"];
    git: boolean | null;
    locks: {
        path: string;
        owner: string;
        at: number;
    }[];
}
/** Per-run context handed to a custom/mock local runner. */
export interface LocalRunContext {
    bridge: CollabBridge;
    roomId: string;
    agent: LocalAgentConfig;
    prompt: string;
    mode: "chat" | "task" | "moderate" | "summary";
    trigger?: CollabPayload;
    threadId: string;
    cwd: string;
    signal: AbortSignal;
}
export type LocalRunner = (ctx: LocalRunContext) => Promise<void>;
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
    /** local agentId → its own member connection. */
    agents: Map<string, CollabClient>;
    threads: ThreadTracker;
    /** local agentId → thread of its current run (messages it sends belong to that thread). */
    runThread: Map<string, string>;
    /** moderator-created tasks: taskId → bookkeeping for the summary step. */
    modTasks: Map<string, {
        moderator: string;
        parent: string;
        status: string;
        title: string;
        assignee?: string;
        note?: string;
    }>;
    summarized: Set<string>;
    worktrees: Map<string, WorktreeInfo>;
    locks?: FileLocks;
    git?: boolean | null;
    historyTimer?: ReturnType<typeof setTimeout>;
    announceTimer?: ReturnType<typeof setTimeout>;
    constructor(meta: RoomMeta);
    private normalized?;
    /** Normalized once; the same object afterwards so `conn.local.x = …` always sticks. */
    get local(): RoomLocalSettings;
    onAdd?: () => void;
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
    /** Start as a local-only room: in-process loopback transport, no network (switch to relay/LAN later). */
    localOnly?: boolean;
    /** Preset keys and/or full agent drafts to add right away. */
    agents?: Array<string | (Record<string, unknown> & {
        preset?: string;
    })>;
    /** Initial orchestration settings (local multi-agent). */
    turnLimit?: number;
    concurrency?: number;
    isolation?: IsolationMode;
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
    /** In-process loopback relay shared by every local-only room. */
    readonly hub: RoomHub;
    /** Local agent runs (concurrency cap per room + visible queue). */
    readonly scheduler: RunScheduler;
    /** `${roomId}:${agentId}` → dsh session handle of that local agent. */
    private agentHandles;
    /** room:agent keys whose model rejected the configured reasoning effort (sessions then use the model default). */
    private noEffort;
    /** dsh session id → the local agent that session belongs to (routes collab_* tool calls). */
    private sessionAgents;
    /** Override how a local agent run executes (tests / mock provider). */
    localRunner: LocalRunner | null;
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
        /** dsh Session woken for this room (shown nested under its workspace in the native sidebar). */
        sessionId?: string;
        status: RoomStatus;
        error?: string;
        members: {
            agentId: string;
            self: boolean;
            online?: boolean;
            local?: boolean;
            name?: string;
            persona?: string;
            hostedBy?: string;
            moderator?: boolean;
        }[];
        last?: {
            from: string;
            text: string;
            ts: number;
        };
        sessionTitle: string;
        bound: boolean;
        transport?: "relay" | "lan" | "local";
        /** Public member config (no secrets / no absolute path). */
        memberConfig?: (ReturnType<typeof publicMemberConfig> & {
            workspacePath?: string;
            peerGrants?: RoomMemberConfig["peerGrants"];
        }) | null;
        peerConfigs?: Record<string, ReturnType<typeof publicMemberConfig> & {
            displayName?: string;
            persona?: string;
            hostedBy?: string;
        }>;
        /** Local multi-agent state (agents hosted by this dsh). */
        local?: LocalView;
        /** Local agent runs: running, queued, waiting for approval, recent. */
        runs?: RunInfo[];
        roomId: string;
        public: boolean;
        name: string;
        owner: boolean;
        description: string;
        tags: string[];
        joinedAt: number;
        workspaceId?: string | undefined;
        agentSessions?: Record<string, string> | undefined;
        agentNoEffort?: string[] | undefined;
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
            local?: boolean;
            name?: string;
            persona?: string;
            hostedBy?: string;
            moderator?: boolean;
        }[];
        last?: {
            from: string;
            text: string;
            ts: number;
        };
        sessionTitle: string;
        bound: boolean;
        transport?: "relay" | "lan" | "local";
        /** Public member config (no secrets / no absolute path). */
        memberConfig?: (ReturnType<typeof publicMemberConfig> & {
            workspacePath?: string;
            peerGrants?: RoomMemberConfig["peerGrants"];
        }) | null;
        peerConfigs?: Record<string, ReturnType<typeof publicMemberConfig> & {
            displayName?: string;
            persona?: string;
            hostedBy?: string;
        }>;
        /** Local multi-agent state (agents hosted by this dsh). */
        local?: LocalView;
        /** Local agent runs: running, queued, waiting for approval, recent. */
        runs?: RunInfo[];
        roomId: string;
        public: boolean;
        name: string;
        owner: boolean;
        description: string;
        tags: string[];
        joinedAt: number;
        workspaceId?: string | undefined;
        agentSessions?: Record<string, string> | undefined;
        agentNoEffort?: string[] | undefined;
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
    private transportFor;
    private agentIdentityPath;
    /** Join every configured local agent as its own room member (own keypair, same transport as the host). */
    private connectAgents;
    private connectAgent;
    private announceAgentConfig;
    private disconnectAgents;
    private localAgent;
    presets(): import("./local-agents.js").AgentPreset[];
    addLocalAgent(roomId: string, input: Record<string, unknown> & {
        preset?: string;
    }): Promise<LocalAgentConfig>;
    updateLocalAgent(roomId: string, id: string, input: Record<string, unknown>): Promise<LocalAgentConfig>;
    removeLocalAgent(roomId: string, id: string): Promise<{
        ok: boolean;
        removed: string;
        branchKept: string | null;
    }>;
    updateLocalSettings(roomId: string, patch: Partial<Pick<RoomLocalSettings, "turnLimit" | "concurrency" | "isolation">>): Promise<{
        turnLimit: number;
        concurrency: number;
        isolation: IsolationMode;
    }>;
    /**
     * Switch a room's transport keeping every local agent as a member:
     *  local → in-process loopback (no network; refused while remote peers are present)
     *  relay → the room's invite relay (default VPS 62.234.113.56:80)
     *  lan   → embedded LAN relay on this machine (invite rewritten to this host:port; same roomId + key)
     */
    setTransport(roomId: string, target: "local" | "relay" | "lan", force?: boolean): Promise<{
        invite: string;
        /** dsh Session woken for this room (shown nested under its workspace in the native sidebar). */
        sessionId?: string;
        status: RoomStatus;
        error?: string;
        members: {
            agentId: string;
            self: boolean;
            online?: boolean;
            local?: boolean;
            name?: string;
            persona?: string;
            hostedBy?: string;
            moderator?: boolean;
        }[];
        last?: {
            from: string;
            text: string;
            ts: number;
        };
        sessionTitle: string;
        bound: boolean;
        transport?: "relay" | "lan" | "local";
        /** Public member config (no secrets / no absolute path). */
        memberConfig?: (ReturnType<typeof publicMemberConfig> & {
            workspacePath?: string;
            peerGrants?: RoomMemberConfig["peerGrants"];
        }) | null;
        peerConfigs?: Record<string, ReturnType<typeof publicMemberConfig> & {
            displayName?: string;
            persona?: string;
            hostedBy?: string;
        }>;
        /** Local multi-agent state (agents hosted by this dsh). */
        local?: LocalView;
        /** Local agent runs: running, queued, waiting for approval, recent. */
        runs?: RunInfo[];
        roomId: string;
        public: boolean;
        name: string;
        owner: boolean;
        description: string;
        tags: string[];
        joinedAt: number;
        workspaceId?: string | undefined;
        agentSessions?: Record<string, string> | undefined;
        agentNoEffort?: string[] | undefined;
    }>;
    private historyPath;
    private scheduleHistorySave;
    private saveLocalHistory;
    private loadLocalHistory;
    /** Central router: called for every room payload this dsh sees (inbound + its own). */
    private routeLocal;
    private maybeSummarize;
    private enqueueRun;
    /** Stop every local agent run in the room (queued, waiting approval, and running turns). */
    stopLocal(roomId: string, agentId?: string): {
        ok: boolean;
        stopped: number;
    };
    private execRun;
    /** Working directory of an agent: private worktree (write + git), else the room workspace. */
    agentCwd(conn: RoomConn, a: LocalAgentConfig): Promise<string>;
    private runInSession;
    /** Last turn/end error since `from`, if the agent's turn failed (provider/model errors). */
    private turnError;
    /** One dsh session per local agent, under the room's workspace (nested + marked in the native sidebar). */
    private agentSessionFor;
    /** Map a tool call's calling session to the local agent it belongs to. */
    callerAgent(exec: {
        agent?: unknown;
    } | undefined): {
        conn: RoomConn;
        agent: LocalAgentConfig;
    } | null;
    private memberLines;
    buildLocalPrompt(conn: RoomConn, a: LocalAgentConfig, mode: LocalRunContext["mode"], p: CollabPayload | undefined, thread: string, cwd: string, tasks?: {
        title: string;
        status: string;
        assignee?: string;
        note?: string;
    }[]): string;
    /** Publish as one of this dsh's local agents (used by tool calls from that agent's session and by runners). */
    publishAs(roomId: string, agentId: string, payload: Record<string, unknown> & {
        kind: CollabPayload["kind"];
    }): Promise<{
        messageId: string;
        seq: number;
        roomId: string;
    }>;
    agentDiffs(roomId: string): Promise<{
        roomId: string;
        git: boolean | null;
        agents: ({
            agentId: string;
            name: string;
            isolation: string;
            files: never[];
            ahead: number;
            patch: string;
            conflicts: never[];
            mainDirty: never[];
            branch: null;
            error?: undefined;
        } | {
            agentId: string;
            branch: string;
            path: string;
            ahead: number;
            files: import("./isolation.js").DiffFile[];
            patch: string;
            truncated: boolean;
            conflicts: string[];
            mainDirty: string[];
            name: string;
            isolation: string;
            error?: undefined;
        } | {
            agentId: string;
            name: string;
            isolation: string;
            branch: string;
            files: never[];
            ahead: number;
            patch: string;
            conflicts: never[];
            mainDirty: never[];
            error: string;
        })[];
        locks: {
            path: string;
            owner: string;
            at: number;
        }[];
    }>;
    private findWorktree;
    /** Merge one agent's branch into the main workspace. `approved` must come from an explicit user action. */
    mergeAgent(roomId: string, agentId: string, approved: boolean): Promise<import("./isolation.js").MergeResult>;
    discardAgent(roomId: string, agentId: string, approved: boolean): Promise<{
        ok: boolean;
        discarded: boolean;
        branch?: undefined;
    } | {
        ok: boolean;
        discarded: boolean;
        branch: string;
    }>;
    lockFiles(roomId: string, agentId: string, paths: string[], release?: boolean): {
        ok: true;
        locked: string[];
    } | {
        ok: false;
        held: {
            path: string;
            owner: string;
        }[];
    } | {
        ok: boolean;
        note: string;
        released?: undefined;
    } | {
        ok: boolean;
        released: number;
        note?: undefined;
    };
    localView(conn: RoomConn): LocalView;
    dispose(): Promise<void>;
    tools(): ToolDefinition[];
}
/**
 * Deterministic local agent "model" (config localAgentRunner: mock, or no dsh agent services):
 * acts through the same publishAs path real sessions use via collab_* tools, so routing, turn limits,
 * concurrency, moderator flow and worktree merges are exercised end to end without model calls.
 */
export declare function mockLocalRunner(ctx: LocalRunContext): Promise<void>;
export {};
//# sourceMappingURL=plugin.d.ts.map