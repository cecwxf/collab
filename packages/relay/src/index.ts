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
  pushRing,
  framesSince,
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

interface Member {
  agentId: string;
  publicKey: string;
  capabilities?: string[];
  ws: WebSocket;
  lastSeen: number;
}

export class CollabRoom implements DurableObject {
  private members = new Map<string, Member>();
  private challenges = new Map<string, string>();
  private seq = 0;
  private ring: FwdFrame[] = [];
  private rate = new Map<string, number[]>();
  private roomRate: number[] = [];
  private roomId = "";

  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<{ seq: number; ring: FwdFrame[] }>(
        "ring",
      );
      if (saved) {
        this.seq = saved.seq;
        this.ring = saved.ring ?? [];
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const m = /^\/ws\/([^/]+)/.exec(url.pathname);
    this.roomId = m ? decodeURIComponent(m[1]!) : this.roomId;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
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
        this.send(ws, {
          v: 1,
          type: "ctrl",
          method: "error",
          code: "bad_json",
          message: "invalid JSON",
        });
        continue;
      }
      await this.handleFrame(ws, frame);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.removeSocket(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.removeSocket(ws);
  }

  private removeSocket(ws: WebSocket): void {
    for (const [aid, m] of this.members) {
      if (m.ws === ws) {
        this.members.delete(aid);
        this.broadcastPeerUpdate(aid, "left");
        break;
      }
    }
  }

  private send(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj) + "\n");
    } catch {
      /* closed */
    }
  }

  private async handleFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    if (frame.v !== 1) {
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "error",
        code: "bad_version",
        message: "v must be 1",
      });
      return;
    }

    if (frame.type === "ctrl" && frame.method === "ping") {
      this.send(ws, { v: 1, type: "ctrl", method: "pong", ts: Date.now() });
      const agentId = String(frame.agentId ?? "");
      const m = this.members.get(agentId);
      if (m) m.lastSeen = Date.now();
      return;
    }

    if (frame.type === "ctrl" && frame.method === "join") {
      await this.handleJoin(ws, frame as unknown as JoinMsg);
      return;
    }

    if (frame.type === "ctrl" && frame.method === "leave") {
      const agentId = String(frame.agentId ?? "");
      if (this.members.has(agentId)) {
        this.members.delete(agentId);
        this.broadcastPeerUpdate(agentId, "left");
      }
      return;
    }

    if (frame.type === "ctrl" && frame.method === "poll") {
      const sinceSeq = Number(frame.sinceSeq ?? 0);
      const agentId = String(frame.agentId ?? "");
      if (!this.members.has(agentId)) {
        this.send(ws, {
          v: 1,
          type: "ctrl",
          method: "error",
          code: "not_member",
          message: "join first",
          roomId: this.roomId,
        });
        return;
      }
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "poll_result",
        roomId: this.roomId,
        frames: framesSince(this.ring, sinceSeq),
        seq: this.seq,
      });
      return;
    }

    if (frame.type === "fwd") {
      await this.handleFwd(ws, frame);
      return;
    }

    this.send(ws, {
      v: 1,
      type: "ctrl",
      method: "error",
      code: "unknown",
      message: "unknown frame",
    });
  }

  private async handleJoin(ws: WebSocket, frame: JoinMsg): Promise<void> {
    if (frame.roomId) this.roomId = frame.roomId;
    const agentId = frame.agentId;
    if (!agentId || !frame.publicKey) {
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "error",
        code: "bad_join",
        message: "agentId and publicKey required",
      });
      return;
    }

    let challenge = this.challenges.get(agentId);
    if (!challenge || !frame.challengeResp) {
      challenge = randomChallenge();
      this.challenges.set(agentId, challenge);
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "challenge",
        roomId: this.roomId,
        challenge,
      });
      return;
    }

    const sigOk = await verifyEd25519(frame.publicKey, challenge, frame.challengeResp);
    if (!sigOk) {
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "error",
        code: "bad_sig",
        message: "challenge signature invalid",
        roomId: this.roomId,
      });
      return;
    }

    this.challenges.delete(agentId);

    const prev = this.members.get(agentId);
    if (prev && prev.ws !== ws) {
      try {
        prev.ws.close(1000, "replaced");
      } catch {
        /* ignore */
      }
    }

    this.members.set(agentId, {
      agentId,
      publicKey: frame.publicKey,
      capabilities: frame.capabilities,
      ws,
      lastSeen: Date.now(),
    });

    this.send(ws, {
      v: 1,
      type: "ctrl",
      method: "joined",
      roomId: this.roomId,
      agentId,
      peers: this.peerList(),
      seq: this.seq,
    });
    this.broadcastPeerUpdate(agentId, "joined", ws);
  }

  private async handleFwd(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const from = String(frame.from ?? "");
    const member = this.members.get(from);
    if (!member || member.ws !== ws) {
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "error",
        code: "not_member",
        message: "sender not joined",
        roomId: this.roomId,
      });
      return;
    }

    const now = Date.now();
    const agentRate = checkRate(this.rate.get(from) ?? [], now, RATE_PER_SEC);
    this.rate.set(from, agentRate.next);
    if (!agentRate.ok) {
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "error",
        code: "rate_limit",
        message: "agent rate limit",
        roomId: this.roomId,
      });
      return;
    }
    const roomRate = checkRate(this.roomRate, now, ROOM_RATE_PER_SEC);
    this.roomRate = roomRate.next;
    if (!roomRate.ok) {
      this.send(ws, {
        v: 1,
        type: "ctrl",
        method: "error",
        code: "rate_limit",
        message: "room rate limit",
        roomId: this.roomId,
      });
      return;
    }

    this.seq += 1;
    const out: FwdFrame = {
      v: 1,
      type: "fwd",
      roomId: this.roomId,
      from,
      seq: this.seq,
      ciphertext: String(frame.ciphertext ?? ""),
      nonce: String(frame.nonce ?? ""),
    };
    this.ring = pushRing(this.ring, out, RING_SIZE);
    member.lastSeen = now;

    if (this.seq % 10 === 0) {
      await this.state.storage.put("ring", { seq: this.seq, ring: this.ring });
    }

    for (const m of this.members.values()) {
      if (m.ws === ws) continue;
      this.send(m.ws, out);
    }
  }

  private peerList(): PeerInfo[] {
    return [...this.members.values()].map((m) => ({
      agentId: m.agentId,
      publicKey: m.publicKey,
      capabilities: m.capabilities,
    }));
  }

  private broadcastPeerUpdate(
    agentId: string,
    event: "joined" | "left",
    except?: WebSocket,
  ): void {
    const msg = {
      v: 1,
      type: "ctrl",
      method: "peer_update",
      roomId: this.roomId,
      peers: this.peerList(),
      event,
      agentId,
    };
    for (const m of this.members.values()) {
      if (m.ws === except) continue;
      this.send(m.ws, msg);
    }
  }
}
