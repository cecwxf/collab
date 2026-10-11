/** Collab Protocol v1 — wire and decrypted payload types */

export const PROTOCOL_VERSION = 1 as const;

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
  | "hello";

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
}

export interface StatusPayload extends PayloadBase {
  kind: "status";
  text: string;
}

export interface StreamDeltaPayload extends PayloadBase {
  kind: "stream.delta";
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

export type CollabPayload =
  | ChatPayload
  | StatusPayload
  | StreamDeltaPayload
  | StreamEndPayload
  | TaskCreatePayload
  | TaskClaimPayload
  | TaskUpdatePayload
  | PresencePayload
  | HelloPayload;

export type AutoReplyMode = "off" | "mention" | "mention-or-task";

export interface RoomInvite {
  roomId: RoomId;
  /** base64url 32-byte room key */
  roomKey: string;
  /** optional invite URI */
  uri: string;
}
