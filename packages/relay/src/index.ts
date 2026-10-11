/**
 * Collab Cloudflare Worker + Durable Object Room relay.
 * Forwards E2EE ciphertext only. Does not hold roomKey.
 * Join = Ed25519 challenge (identity). Anyone with roomId can fanout-subscribe;
 * without roomKey they cannot decrypt payloads.
 */
import {
  RING_SIZE,
  RATE_PER_SEC,
  ROOM_RATE_PER_SEC,
  checkRate,
  randomChallenge,
  verifyEd25519,
  type FwdFrame,
  type PeerInfo,
} from "./room-logic.js";

export interface Env {
  ROOM: DurableObjectNamespace;
  RELAY_JOIN_SECRET?: string;
}

interface JoinMsg {
  v: 1;
  type: "ctrl";
  method: "join";
  roomId: string;
  agentId: string;
  publicKey: string;
  challengeResp?: string;
  capabilities?: string[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "collab-relay", v: 1 });
    }

    const m = /^\/ws\/([^/]+)\/?$/.exec(url.pathname);
    if (!m) {
      return new Response(
        "Collab Relay v1\nWS: /ws/:roomId\nHealth: /health\n",
        { status: 200, headers: { "content-type": "text/plain" } },
      );
    }

    const roomId = decodeURIComponent(m[1]!);
    if (!roomId || roomId.length > 128) {
      return new Response("invalid roomId", { status: 400 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const id = env.ROOM.idFromName(roomId);
    const stub = env.ROOM.get(id);
    return stub.fetch(request);
  },
};

/**
 * Per-socket state lives in the WebSocket attachment so it survives DO hibernation.
 * (In-memory maps are wiped when the DO hibernates between messages.)
 */
interface SocketState {
  roomId: string;
  agentId?: string;
  publicKey?: string;
  capabilities?: string[];
  joined: boolean;
  challenge?: string;
  challengeFor?: string;
}

const FRAME_PREFIX = "f:";
const frameKey = (seq: number) => FRAME_PREFIX + String(seq).padStart(12, "0");

export class CollabRoom implements DurableObject {
  /** rate limit buckets: in-memory only, resetting on hibernation is acceptable */
  private rate = new Map<string, number[]>();
  private roomRate: number[] = [];

  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const m = /^\/ws\/([^/]+)/.exec(url.pathname);
    const roomId = m ? decodeURIComponent(m[1]!) : "";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    this.setState(server, { roomId, joined: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  private getState(ws: WebSocket): SocketState {
    return (ws.deserializeAttachment() as SocketState | null) ?? { roomId: "", joined: false };
  }

  private setState(ws: WebSocket, s: SocketState): void {
    ws.serializeAttachment(s);
  }

  /** Joined members, rebuilt from live sockets (hibernation-safe) */
  private members(): { ws: WebSocket; s: SocketState }[] {
    const out: { ws: WebSocket; s: SocketState }[] = [];
    for (const ws of this.state.getWebSockets()) {
      const s = this.getState(ws);
      if (s.joined && s.agentId) out.push({ ws, s });
    }
    return out;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        this.err(ws, "bad_json", "invalid JSON");
        continue;
      }
      await this.handleFrame(ws, frame);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.markLeft(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.markLeft(ws);
  }

  private markLeft(ws: WebSocket): void {
    const s = this.getState(ws);
    if (!s.joined || !s.agentId) return;
    this.setState(ws, { ...s, joined: false });
    this.broadcastPeerUpdate(s.roomId, s.agentId, "left", ws);
  }

  private send(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj) + "\n");
    } catch {
      /* closed */
    }
  }

  private err(ws: WebSocket, code: string, message: string): void {
    const s = this.getState(ws);
    this.send(ws, { v: 1, type: "ctrl", method: "error", code, message, roomId: s.roomId });
  }

  private async handleFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    if (frame.v !== 1) return this.err(ws, "bad_version", "v must be 1");
    const s = this.getState(ws);

    if (frame.type === "ctrl" && frame.method === "ping") {
      this.send(ws, { v: 1, type: "ctrl", method: "pong", ts: Date.now() });
      return;
    }
    if (frame.type === "ctrl" && frame.method === "join") {
      return this.handleJoin(ws, frame as unknown as JoinMsg);
    }
    if (frame.type === "ctrl" && frame.method === "leave") {
      this.markLeft(ws);
      return;
    }
    if (frame.type === "ctrl" && frame.method === "poll") {
      if (!s.joined) return this.err(ws, "not_member", "join first");
      const sinceSeq = Math.max(0, Number(frame.sinceSeq ?? 0));
      const seq = (await this.state.storage.get<number>("seq")) ?? 0;
      const rows = await this.state.storage.list<FwdFrame>({
        prefix: FRAME_PREFIX,
        start: frameKey(sinceSeq + 1),
        limit: RING_SIZE,
      });
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "poll_result",
        roomId: s.roomId,
        frames: [...rows.values()],
        seq,
      });
      return;
    }
    if (frame.type === "fwd") return this.handleFwd(ws, frame);
    this.err(ws, "unknown", "unknown frame");
  }

  private async handleJoin(ws: WebSocket, frame: JoinMsg): Promise<void> {
    const s = this.getState(ws);
    const agentId = frame.agentId;
    if (!agentId || !frame.publicKey) {
      return this.err(ws, "bad_join", "agentId and publicKey required");
    }
    if (frame.roomId && s.roomId && frame.roomId !== s.roomId) {
      return this.err(ws, "bad_join", "roomId does not match socket path");
    }

    if (!frame.challengeResp || !s.challenge || s.challengeFor !== agentId) {
      const challenge = randomChallenge();
      this.setState(ws, { ...s, challenge, challengeFor: agentId });
      this.send(ws, { v: 1, type: "ctrl", method: "challenge", roomId: s.roomId, challenge });
      return;
    }

    const sigOk = await verifyEd25519(frame.publicKey, s.challenge, frame.challengeResp);
    if (!sigOk) {
      this.setState(ws, { ...s, challenge: undefined, challengeFor: undefined });
      return this.err(ws, "bad_sig", "challenge signature invalid");
    }

    // Replace a stale connection for the same agent
    for (const m of this.members()) {
      if (m.s.agentId === agentId && m.ws !== ws) {
        this.setState(m.ws, { ...m.s, joined: false });
        try {
          m.ws.close(1000, "replaced");
        } catch {
          /* ignore */
        }
      }
    }

    this.setState(ws, {
      roomId: s.roomId,
      agentId,
      publicKey: frame.publicKey,
      capabilities: frame.capabilities,
      joined: true,
    });

    const seq = (await this.state.storage.get<number>("seq")) ?? 0;
    this.send(ws, {
      v: 1,
      type: "ctrl",
      method: "joined",
      roomId: s.roomId,
      agentId,
      peers: this.peerList(),
      seq,
    });
    this.broadcastPeerUpdate(s.roomId, agentId, "joined", ws);
  }

  private async handleFwd(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const s = this.getState(ws);
    const from = String(frame.from ?? "");
    if (!s.joined || s.agentId !== from) {
      return this.err(ws, "not_member", "sender not joined");
    }

    const now = Date.now();
    const agentRate = checkRate(this.rate.get(from) ?? [], now, RATE_PER_SEC);
    this.rate.set(from, agentRate.next);
    if (!agentRate.ok) return this.err(ws, "rate_limit", "agent rate limit");
    const roomRate = checkRate(this.roomRate, now, ROOM_RATE_PER_SEC);
    this.roomRate = roomRate.next;
    if (!roomRate.ok) return this.err(ws, "rate_limit", "room rate limit");

    const ciphertext = String(frame.ciphertext ?? "");
    const nonce = String(frame.nonce ?? "");
    if (!ciphertext || !nonce || ciphertext.length > 256 * 1024) {
      return this.err(ws, "bad_frame", "ciphertext/nonce missing or too large");
    }

    // storage ops in a DO are serialized per input gate, so seq is race-free
    const seq = ((await this.state.storage.get<number>("seq")) ?? 0) + 1;
    const out: FwdFrame = { v: 1, type: "fwd", roomId: s.roomId, from, seq, ciphertext, nonce };
    const puts: Record<string, unknown> = { seq, [frameKey(seq)]: out };
    await this.state.storage.put(puts);
    if (seq > RING_SIZE) await this.state.storage.delete(frameKey(seq - RING_SIZE));

    for (const m of this.members()) {
      if (m.ws === ws) continue;
      this.send(m.ws, out);
    }
  }

  private peerList(): PeerInfo[] {
    return this.members().map(({ s }) => ({
      agentId: s.agentId!,
      publicKey: s.publicKey!,
      capabilities: s.capabilities,
    }));
  }

  private broadcastPeerUpdate(
    roomId: string,
    agentId: string,
    event: "joined" | "left",
    except?: WebSocket,
  ): void {
    const msg = {
      v: 1,
      type: "ctrl",
      method: "peer_update",
      roomId,
      peers: this.peerList(),
      event,
      agentId,
    };
    for (const m of this.members()) {
      if (m.ws === except) continue;
      this.send(m.ws, msg);
    }
  }
}
