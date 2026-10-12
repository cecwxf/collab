import {
  type Identity,
  type CollabPayload,
  type PeerInfo,
  type AutoReplyMode,
  type WireFrame,
  type FwdFrame,
  type RoomId,
  encodePayload,
  decodePayload,
  encrypt,
  decrypt,
  b64uDecode,
  b64uEncode,
  newMessageId,
  signChallenge,
  shouldAutoReply,
  createRoomInvite,
  parseInviteUri,
} from "@collab/protocol";
import type { Transport } from "./transport.js";
import { MockTransport, RoomHub } from "./mock-relay.js";
import { WsTransport } from "./ws-transport.js";

export type PayloadHandler = (payload: CollabPayload, meta: { seq: number; from: string }) => void;
export type PeerHandler = (peers: PeerInfo[], event?: { type: "joined" | "left"; agentId: string }) => void;
export type ConnectionStatus = "connected" | "connecting" | "disconnected";
/** Client→relay keepalive. Must match CollabRoom setWebSocketAutoResponse request bytes exactly
 *  (no roomId/agentId) so Cloudflare answers without waking the Durable Object. */
export const CLIENT_PING_MS = 45_000;
export type StatusHandler = (status: ConnectionStatus, detail?: string) => void;

export interface CollabClientOptions {
  identity: Identity;
  /** 32-byte room key or base64url string */
  roomKey: Uint8Array | string;
  roomId: RoomId;
  transport: Transport;
  autoReply?: AutoReplyMode;
  capabilities?: string[];
  /** reconnect with exponential backoff (default true for ws) */
  reconnect?: boolean;
  /** local cursor persistence path (optional) */
  cursor?: { get(): number; set(seq: number): void };
}

export interface CreateRoomResult {
  roomId: string;
  roomKey: Uint8Array;
  roomKeyB64: string;
  uri: string;
  mode: import("@collab/protocol").TransportMode;
}

type Waiter = {
  pred: (f: WireFrame) => boolean;
  resolve: (f: WireFrame) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CollabClient {
  readonly identity: Identity;
  readonly roomId: RoomId;
  readonly roomKey: Uint8Array;
  readonly autoReply: AutoReplyMode;
  private transport: Transport;
  private peers: PeerInfo[] = [];
  private seq = 0;
  private payloadHandlers: PayloadHandler[] = [];
  private peerHandlers: PeerHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private waiters: Waiter[] = [];
  private joined = false;
  private disposed = false;
  private capabilities: string[];
  private reconnect: boolean;
  private cursor?: CollabClientOptions["cursor"];
  private seenIds = new Set<string>();
  private pingTimer?: ReturnType<typeof setInterval>;

  constructor(opts: CollabClientOptions) {
    this.identity = opts.identity;
    this.roomId = opts.roomId;
    this.roomKey =
      typeof opts.roomKey === "string" ? b64uDecode(opts.roomKey) : opts.roomKey;
    if (this.roomKey.length !== 32) throw new Error("roomKey must be 32 bytes");
    this.transport = opts.transport;
    this.autoReply = opts.autoReply ?? "mention-or-task";
    this.capabilities = opts.capabilities ?? ["collab.v1"];
    this.reconnect = opts.reconnect ?? false;
    this.cursor = opts.cursor;

    this.transport.onFrame((f) => this.onFrame(f));
    this.transport.onClose(() => {
      this.joined = false;
      this.setConnStatus("disconnected", "ws_closed");
      if (this.reconnect && !this.disposed) {
        this.setConnStatus("connecting", "reconnect");
        void this.reconnectLoop();
      }
    });
  }

  static createRoom(opts?: Parameters<typeof createRoomInvite>[0]): CreateRoomResult {
    return createRoomInvite(opts);
  }

  static parseInvite(uri: string) {
    return parseInviteUri(uri);
  }

  /** Convenience: two clients on shared in-memory hub */
  static createMockPair(
    hub: RoomHub,
    a: { identity: Identity; roomId: string; roomKey: Uint8Array },
    b: { identity: Identity; roomId: string; roomKey: Uint8Array },
  ): [CollabClient, CollabClient] {
    const ta = new MockTransport(hub, a.identity.agentId);
    const tb = new MockTransport(hub, b.identity.agentId);
    return [
      new CollabClient({
        identity: a.identity,
        roomId: a.roomId,
        roomKey: a.roomKey,
        transport: ta,
      }),
      new CollabClient({
        identity: b.identity,
        roomId: b.roomId,
        roomKey: b.roomKey,
        transport: tb,
      }),
    ];
  }

  static wsTransport(url: string): WsTransport {
    return new WsTransport(url);
  }

  static mockTransport(hub: RoomHub, label?: string): MockTransport {
    return new MockTransport(hub, label);
  }

  onPayload(handler: PayloadHandler): () => void {
    this.payloadHandlers.push(handler);
    return () => {
      this.payloadHandlers = this.payloadHandlers.filter((h) => h !== handler);
    };
  }

  onPeers(handler: PeerHandler): () => void {
    this.peerHandlers.push(handler);
    return () => {
      this.peerHandlers = this.peerHandlers.filter((h) => h !== handler);
    };
  }

  getPeers(): PeerInfo[] {
    return [...this.peers];
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  private setConnStatus(status: ConnectionStatus, detail?: string) {
    for (const h of this.statusHandlers) {
      try {
        h(status, detail);
      } catch {
        /* */
      }
    }
  }

  getSeq(): number {
    return this.seq;
  }

  isJoined(): boolean {
    return this.joined;
  }

  /** Whether inbound payload should wake the agent loop */
  shouldWake(payload: CollabPayload): boolean {
    return shouldAutoReply(this.autoReply, payload, this.identity.agentId);
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async join(timeoutMs = 10_000): Promise<void> {
    await this.connect();

    // Register waiters BEFORE send to avoid sync mock-relay race
    const challengeP = this.waitFor(
      (f) =>
        f.type === "ctrl" &&
        (f.method === "challenge" || f.method === "error"),
      timeoutMs,
    );

    this.transport.send({
      v: 1,
      type: "ctrl",
      method: "join",
      roomId: this.roomId,
      agentId: this.identity.agentId,
      publicKey: this.identity.publicKey,
      challengeResp: "",
      capabilities: this.capabilities,
    });

    const challengeFrame = await challengeP;

    if (challengeFrame.type === "ctrl" && challengeFrame.method === "error") {
      throw new Error(`join failed: ${challengeFrame.message}`);
    }
    if (challengeFrame.type !== "ctrl" || challengeFrame.method !== "challenge") {
      throw new Error("expected challenge");
    }

    const challenge = challengeFrame.challenge;
    const sig = await signChallenge(this.identity, challenge);

    const joinedP = this.waitFor(
      (f) =>
        f.type === "ctrl" &&
        (f.method === "joined" || f.method === "error"),
      timeoutMs,
    );

    this.transport.send({
      v: 1,
      type: "ctrl",
      method: "join",
      roomId: this.roomId,
      agentId: this.identity.agentId,
      publicKey: this.identity.publicKey,
      challengeResp: sig,
      capabilities: this.capabilities,
    });

    const joined = await joinedP;
    if (joined.type === "ctrl" && joined.method === "error") {
      throw new Error(`join failed: ${joined.message}`);
    }
    if (joined.type !== "ctrl" || joined.method !== "joined") {
      throw new Error("expected joined");
    }
    this.joined = true;
    this.peers = joined.peers;
    this.seq = joined.seq;
    this.setConnStatus("connected");
    for (const h of this.peerHandlers) h(this.peers);

    // catch up
    const since = this.cursor?.get() ?? 0;
    if (since > 0 && since < this.seq) {
      await this.poll(since);
    }

    this.startPing();
  }

  async leave(): Promise<void> {
    if (!this.transport.connected) return;
    try {
      this.transport.send({
        v: 1,
        type: "ctrl",
        method: "leave",
        roomId: this.roomId,
        agentId: this.identity.agentId,
      });
    } catch {
      /* ignore */
    }
    this.joined = false;
    this.stopPing();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.reconnect = false;
    await this.leave();
    this.transport.close("dispose");
    this.stopPing();
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("disposed"));
    }
    this.waiters = [];
  }

  async publish(
    payload: Record<string, unknown> & { kind: CollabPayload["kind"] },
  ): Promise<{ messageId: string; seq: number }> {
    if (!this.joined) throw new Error("not joined");
    const full = {
      ...payload,
      v: 1 as const,
      messageId: (payload.messageId as string | undefined) ?? newMessageId(),
      ts: (payload.ts as number | undefined) ?? Date.now(),
      sender: this.identity.agentId,
    } as CollabPayload;

    const plain = encodePayload(full);
    const aad = new TextEncoder().encode(`${this.roomId}:${this.identity.agentId}`);
    const { nonce, ciphertext } = await encrypt(this.roomKey, plain, aad);

    const prevSeq = this.seq;
    this.transport.send({
      v: 1,
      type: "fwd",
      roomId: this.roomId,
      from: this.identity.agentId,
      seq: 0,
      ciphertext,
      nonce,
    });

    // For mock relay, sender doesn't get echo; seq advances on hub.
    // Poll briefly or wait — we optimistically bump by reading via short poll.
    await sleep(10);
    await this.poll(prevSeq);
    return { messageId: full.messageId, seq: this.seq };
  }

  async sendChat(text: string, mentions?: string[]): Promise<{ messageId: string; seq: number }> {
    return this.publish({ kind: "chat", text, mentions });
  }

  async sendStatus(text: string) {
    return this.publish({ kind: "status", text });
  }

  async createTask(title: string, opts?: { body?: string; assignee?: string; skills?: string[] }) {
    const taskId = newMessageId();
    return this.publish({
      kind: "task.create",
      taskId,
      title,
      body: opts?.body,
      assignee: opts?.assignee,
      skills: opts?.skills,
    });
  }

  async claimTask(taskId: string) {
    return this.publish({ kind: "task.claim", taskId });
  }

  async updateTask(
    taskId: string,
    status: "open" | "claimed" | "done" | "failed" | "cancelled",
    note?: string,
  ) {
    return this.publish({ kind: "task.update", taskId, status, note });
  }

  async streamReply(streamId: string, chunks: string[], replyTo?: string) {
    for (const text of chunks) {
      await this.publish({
        kind: "stream.delta",
        streamId,
        text,
        replyTo,
      });
    }
    await this.publish({ kind: "stream.end", streamId, replyTo });
  }

  async poll(sinceSeq?: number): Promise<CollabPayload[]> {
    const since = sinceSeq ?? this.cursor?.get() ?? 0;
    const resP = this.waitFor(
      (f) => f.type === "ctrl" && f.method === "poll_result",
      5_000,
    );
    this.transport.send({
      v: 1,
      type: "ctrl",
      method: "poll",
      roomId: this.roomId,
      agentId: this.identity.agentId,
      sinceSeq: since,
    });
    const res = await resP;
    if (res.type !== "ctrl" || res.method !== "poll_result") return [];
    const out: CollabPayload[] = [];
    for (const fwd of res.frames) {
      const p = await this.decryptFwd(fwd);
      if (p) out.push(p);
    }
    this.seq = Math.max(this.seq, res.seq);
    this.cursor?.set(this.seq);
    return out;
  }

  async history(sinceSeq = 0): Promise<CollabPayload[]> {
    return this.poll(sinceSeq);
  }

  // --- internals ---

  private onFrame(frame: WireFrame): void {
    // resolve waiters
    const remaining: Waiter[] = [];
    for (const w of this.waiters) {
      if (w.pred(frame)) {
        clearTimeout(w.timer);
        w.resolve(frame);
      } else {
        remaining.push(w);
      }
    }
    this.waiters = remaining;

    if (frame.type === "ctrl" && frame.method === "peer_update") {
      this.peers = frame.peers;
      for (const h of this.peerHandlers) {
        h(this.peers, { type: frame.event, agentId: frame.agentId });
      }
      return;
    }

    if (frame.type === "fwd") {
      void this.handleFwd(frame);
    }
  }

  private async handleFwd(frame: FwdFrame): Promise<void> {
    this.seq = Math.max(this.seq, frame.seq);
    this.cursor?.set(this.seq);
    const payload = await this.decryptFwd(frame);
    if (!payload) return;
    if (this.seenIds.has(payload.messageId)) return;
    this.seenIds.add(payload.messageId);
    if (this.seenIds.size > 5000) {
      const first = this.seenIds.values().next().value;
      if (first) this.seenIds.delete(first);
    }
    for (const h of this.payloadHandlers) {
      h(payload, { seq: frame.seq, from: frame.from });
    }
  }

  private async decryptFwd(frame: FwdFrame): Promise<CollabPayload | null> {
    try {
      const aad = new TextEncoder().encode(`${frame.roomId}:${frame.from}`);
      const plain = await decrypt(this.roomKey, frame.nonce, frame.ciphertext, aad);
      return decodePayload(plain);
    } catch {
      return null;
    }
  }

  private waitFor(pred: (f: WireFrame) => boolean, timeoutMs: number): Promise<WireFrame> {
    const p = new Promise<WireFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error("timeout waiting for frame"));
      }, timeoutMs);
      this.waiters.push({ pred, resolve, reject, timer });
    });
    // If the caller's send() throws before it awaits this promise, its later rejection must not go unhandled.
    p.catch(() => {});
    return p;
  }

  private startPing(): void {
    this.stopPing();
    // Minimal frame only — CF hibernation auto-response matches this exact JSON+\n.
    // Extra fields would miss the auto-response and wake the room DO every interval.
    this.pingTimer = setInterval(() => {
      if (!this.transport.connected) return;
      try {
        this.transport.send({
          v: 1,
          type: "ctrl",
          method: "ping",
        } as WireFrame);
      } catch {
        /* ignore */
      }
    }, CLIENT_PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private async reconnectLoop(): Promise<void> {
    // Exponential backoff with jitter — avoid reconnect storms that wake room DOs.
    let delay = 1_000;
    let attempts = 0;
    while (!this.disposed && !this.joined) {
      try {
        this.setConnStatus("connecting", "reconnect");
        const jitter = Math.floor(Math.random() * Math.min(500, delay / 4));
        await sleep(delay + jitter);
        await this.join();
        attempts = 0;
        // Presence is optional; skip if join already refreshed peer list for peers.
        try {
          await this.publish({ kind: "presence", state: "online" });
        } catch {
          /* optional */
        }
        return;
      } catch {
        attempts++;
        delay = Math.min(delay * 2, 30_000);
        if (attempts > 50) {
          this.setConnStatus("disconnected", "reconnect_gave_up");
          return;
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { RoomHub, MockTransport, WsTransport };
export { b64uEncode, b64uDecode };
