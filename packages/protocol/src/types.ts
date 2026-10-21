/** Collab Protocol v1 — wire and decrypted payload types */

export const PROTOCOL_VERSION = 1 as const;

/** Default VPS Node relay (ws). Override with COLLAB_RELAY / relayUrl. CF Worker remains optional. */
export const DEFAULT_RELAY_URL = "ws://62.234.113.56:80";

/** Default host:port for new LAN/VPS rooms (same VPS as DEFAULT_RELAY_URL). */
export const DEFAULT_LAN_HOST_PORT = "62.234.113.56:80";

export type AgentId = string;
export type RoomId = string;
export type MessageId = string;

/** Control-plane frames (visible to relay) */
export type CtrlMethod = "join" | "leave" | "ping" | "poll" | "hello_ack";

export interface CtrlJoin {
  v: 1;
  type: "ctrl";
  method: "join";
  roomId: RoomId;
  agentId: AgentId;
  /** base64url Ed25519 public key */
  publicKey: string;
  /** base64url signature over challenge bytes */
  challengeResp: string;
  /** capabilities advertised by this agent */
  capabilities?: string[];
}

export interface CtrlLeave {
  v: 1;
  type: "ctrl";
  method: "leave";
  roomId: RoomId;
  agentId: AgentId;
}

export interface CtrlPing {
  v: 1;
  type: "ctrl";
  method: "ping";
  roomId?: RoomId;
  agentId?: AgentId;
}

export interface CtrlPoll {
  v: 1;
  type: "ctrl";
  method: "poll";
  roomId: RoomId;
  agentId: AgentId;
  sinceSeq: number;
}

export type CtrlFrame = CtrlJoin | CtrlLeave | CtrlPing | CtrlPoll;

/** Relay → client control responses / events */
export interface CtrlChallenge {
  v: 1;
  type: "ctrl";
  method: "challenge";
  roomId: RoomId;
  /** base64url random challenge */
  challenge: string;
}

export interface CtrlJoined {
  v: 1;
  type: "ctrl";
  method: "joined";
  roomId: RoomId;
  agentId: AgentId;
  peers: PeerInfo[];
  /** current room seq (last assigned) */
  seq: number;
}

export interface CtrlPeerUpdate {
  v: 1;
  type: "ctrl";
  method: "peer_update";
  roomId: RoomId;
  peers: PeerInfo[];
  event: "joined" | "left";
  agentId: AgentId;
}

export interface CtrlPong {
  v: 1;
  type: "ctrl";
  method: "pong";
  ts: number;
}

export interface CtrlError {
  v: 1;
  type: "ctrl";
  method: "error";
  code: string;
  message: string;
  roomId?: RoomId;
}

export interface CtrlPollResult {
  v: 1;
  type: "ctrl";
  method: "poll_result";
  roomId: RoomId;
  frames: FwdFrame[];
  seq: number;
}

export type CtrlServerFrame =
  | CtrlChallenge
  | CtrlJoined
  | CtrlPeerUpdate
  | CtrlPong
  | CtrlError
  | CtrlPollResult;

export interface PeerInfo {
  agentId: AgentId;
  publicKey: string;
  capabilities?: string[];
}

/** Forwarded encrypted business frame (relay sees ciphertext only) */
export interface FwdFrame {
  v: 1;
  type: "fwd";
  roomId: RoomId;
  from: AgentId;
  seq: number;
  /** base64url AES-GCM ciphertext */
  ciphertext: string;
  /** base64url 12-byte nonce */
  nonce: string;
}

export type WireFrame = CtrlFrame | CtrlServerFrame | FwdFrame;

/** Decrypted payload kinds */
export type PayloadKind =
  | "chat"
  | "status"
  | "stream.delta"
  | "stream.end"
  | "task.create"
  | "task.claim"
  | "task.update"
  | "presence"
  | "hello"
  | "member.config"
  | "execution.status"
  | "approval.request"
  | "approval.response"
  | "mcp.call"
  | "mcp.result";

export interface PayloadBase {
  v: 1;
  kind: PayloadKind;
  messageId: MessageId;
  ts: number;
  sender: AgentId;
  replyTo?: MessageId;
  idempotencyKey?: string;
}

export interface ChatPayload extends PayloadBase {
  kind: "chat";
  text: string;
  mentions?: AgentId[];
  /** Explicit UI-originated human input; model tools never set this. */
  human?: boolean;
}

/** Execution metadata only. Never carries model text, reasoning or tool arguments.
 * Sent using the executing member's own signed connection. */
export interface ExecutionStatusPayload extends PayloadBase {
  kind: "execution.status";
  runs: {
    id: string;
    state: "approval" | "queued" | "running" | "done" | "failed" | "stopped";
    phase?: "working" | "thinking" | "streaming" | "tool";
    enqueuedAt: number;
    startedAt?: number;
    endedAt?: number;
  }[];
}

export interface StatusPayload extends PayloadBase {
  kind: "status";
  text: string;
}

export interface StreamDeltaPayload extends PayloadBase {
  kind: "stream.delta";
  phase?: "thinking" | "streaming";
  streamId: string;
  text: string;
}

export interface StreamEndPayload extends PayloadBase {
  kind: "stream.end";
  streamId: string;
  text?: string;
}

export interface TaskCreatePayload extends PayloadBase {
  kind: "task.create";
  taskId: string;
  title: string;
  body?: string;
  assignee?: AgentId;
  skills?: string[];
}

export interface TaskClaimPayload extends PayloadBase {
  kind: "task.claim";
  taskId: string;
}

export interface TaskUpdatePayload extends PayloadBase {
  kind: "task.update";
  taskId: string;
  status: "open" | "claimed" | "done" | "failed" | "cancelled";
  note?: string;
}

export interface PresencePayload extends PayloadBase {
  kind: "presence";
  state: "online" | "busy" | "offline";
}

export interface HelloPayload extends PayloadBase {
  kind: "hello";
  capabilities: string[];
  publicKey: string;
  displayName?: string;
}


/** Local agent settings announced to the room (never includes API keys). */
export interface MemberConfigPayload extends PayloadBase {
  kind: "member.config";
  model?: string;
  provider?: string;
  reasoningEffort?: "low" | "medium" | "high" | "max";
  /** Display label for the workspace root (not necessarily the absolute path). */
  workspaceLabel?: string;
  /** Absolute workspace path is local-only; peers see workspaceLabel. Optionally share basename. */
  permissions: {
    /** Auto-allow reads in the shared workspace. */
    autoRead: boolean;
    /** Auto-allow writes (default false → approval). */
    autoWrite: boolean;
    /** Auto-allow shell commands (default false → approval). */
    autoShell: boolean;
    /** Auto-allow network egress from tools (default false → approval). */
    autoNetwork: boolean;
  };
  /** MCP tools this member exposes to the room. */
  mcpTools?: string[];
  mcpEnabled?: boolean;
  /** Optional (dsh-room ≥0.3): human-readable name/persona of this member. Older peers ignore these. */
  displayName?: string;
  persona?: string;
  /** agentId of the dsh host that runs this member when it is a hosted local agent. */
  hostedBy?: string;
  /** "read" | "write" scope of a hosted local agent; "moderator" flag. */
  scope?: "read" | "write";
  moderator?: boolean;
}

export type ApprovalAction = "fs.write" | "fs.delete" | "shell.exec" | "network.fetch" | "mcp.call";

export interface ApprovalRequestPayload extends PayloadBase {
  kind: "approval.request";
  requestId: string;
  action: ApprovalAction;
  /** Human-readable summary, e.g. path or command. */
  summary: string;
  detail?: string;
  /** Agent that must approve (usually the workspace owner). */
  approver: AgentId;
}

export interface ApprovalResponsePayload extends PayloadBase {
  kind: "approval.response";
  requestId: string;
  decision: "allow" | "deny";
  reason?: string;
}

/** MCP-over-room: tool call from a peer into this member's workspace MCP. */
export interface McpCallPayload extends PayloadBase {
  kind: "mcp.call";
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  /** Target agent that hosts the MCP workspace. */
  target: AgentId;
  /** Caller response deadline, also bounds target approval waits. */
  timeoutMs?: number;
}

export interface McpResultPayload extends PayloadBase {
  kind: "mcp.result";
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Set when the call is waiting on local approval. */
  pendingApproval?: boolean;
}

export type CollabPayload =
  | ChatPayload
  | StatusPayload
  | StreamDeltaPayload
  | StreamEndPayload
  | TaskCreatePayload
  | TaskClaimPayload
  | TaskUpdatePayload
  | PresencePayload
  | HelloPayload
  | MemberConfigPayload
  | ExecutionStatusPayload
  | ApprovalRequestPayload
  | ApprovalResponsePayload
  | McpCallPayload
  | McpResultPayload;

export type AutoReplyMode = "off" | "mention" | "mention-or-task";

export interface RoomInvite {
  roomId: RoomId;
  /** base64url 32-byte room key */
  roomKey: string;
  /** optional invite URI */
  uri: string;
}
