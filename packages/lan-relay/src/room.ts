/**
 * In-memory Collab room for the LAN relay — same control + fwd fanout as CF CollabRoom,
 * without Durable Object storage. History ring kept in memory (RING_SIZE).
 */
import { WebSocket } from "ws";
import {
  verifyChallenge,
  b64uEncode,
  randomBytes,
  type WireFrame,
  type PeerInfo,
} from "@collab/protocol";

const RING = 1000;
const RATE = 40;

type SockState = {
  ws: WebSocket;
  agentId?: string;
  publicKey?: string;
  capabilities?: string[];
  joined: boolean;
  challenge?: string;
  stamps: number[];
};

export class LanRoom {
  private socks = new Set<SockState>();
  private seq = 0;
  private ring: Extract<WireFrame, { type: "fwd" }>[] = [];
  private roomRate: number[] = [];

  constructor(readonly roomId: string) {}

  attach(ws: WebSocket) {
    const s: SockState = { ws, joined: false, stamps: [] };
    this.socks.add(s);
    ws.on("message", (data) => void this.onMessage(s, data.toString()));
    ws.on("close", () => this.onClose(s));
    ws.on("error", () => this.onClose(s));
  }

  members(): PeerInfo[] {
    return [...this.socks]
      .filter((s) => s.joined && s.agentId && s.publicKey)
      .map((s) => ({ agentId: s.agentId!, publicKey: s.publicKey!, capabilities: s.capabilities }));
  }

  private send(ws: WebSocket, frame: WireFrame) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame) + "\n");
  }

  private broadcast(frame: WireFrame, except?: WebSocket) {
    for (const s of this.socks) {
      if (s.ws !== except && s.joined) this.send(s.ws, frame);
    }
  }

  private rateOk(stamps: number[], now: number, limit: number) {
    const recent = stamps.filter((t) => now - t < 1000);
    if (recent.length >= limit) return { ok: false, next: recent };
    recent.push(now);
    return { ok: true, next: recent };
  }

  private async onMessage(s: SockState, text: string) {
    const now = Date.now();
    const rr = this.rateOk(this.roomRate, now, 200);
    this.roomRate = rr.next;
    if (!rr.ok) return;
    const sr = this.rateOk(s.stamps, now, RATE);
    s.stamps = sr.next;
    if (!sr.ok) return;

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let frame: WireFrame;
      try {
        frame = JSON.parse(line) as WireFrame;
      } catch {
        continue;
      }
      if (frame.v !== 1) continue;

      if (frame.type === "ctrl" && frame.method === "ping") {
        this.send(s.ws, { v: 1, type: "ctrl", method: "pong", ts: now });
        continue;
      }

      if (frame.type === "ctrl" && frame.method === "join") {
        await this.handleJoin(s, frame);
        continue;
      }

      if (!s.joined || !s.agentId) continue;

      if (frame.type === "ctrl" && frame.method === "leave") {
        this.onClose(s);
        continue;
      }

      if (frame.type === "ctrl" && frame.method === "poll") {
        const since = frame.sinceSeq ?? 0;
        const frames = this.ring.filter((f) => f.seq > since);
        this.send(s.ws, { v: 1, type: "ctrl", method: "poll_result", roomId: this.roomId, frames, seq: this.seq });
        continue;
      }

      if (frame.type === "fwd") {
        this.seq += 1;
        const fwd = { ...frame, seq: this.seq, roomId: this.roomId, from: s.agentId };
        this.ring.push(fwd);
        if (this.ring.length > RING) this.ring.shift();
        this.broadcast(fwd);
      }
    }
  }

  private async handleJoin(s: SockState, frame: Extract<WireFrame, { method: "join" }>) {
    if (frame.roomId !== this.roomId) {
      this.send(s.ws, { v: 1, type: "ctrl", method: "error", code: "bad_room", message: "room mismatch", roomId: this.roomId });
      return;
    }
    if (!s.challenge || !frame.challengeResp) {
      s.challenge = b64uEncode(randomBytes(32));
      s.publicKey = frame.publicKey;
      this.send(s.ws, { v: 1, type: "ctrl", method: "challenge", roomId: this.roomId, challenge: s.challenge });
      // Client will re-send join with challengeResp; store pending identity
      s.agentId = frame.agentId;
      s.capabilities = frame.capabilities;
      return;
    }
    // Second join with challengeResp
    const ok = await verifyChallenge(frame.publicKey, s.challenge, frame.challengeResp);
    if (!ok) {
      this.send(s.ws, { v: 1, type: "ctrl", method: "error", code: "bad_sig", message: "challenge failed", roomId: this.roomId });
      return;
    }
    s.agentId = frame.agentId;
    s.publicKey = frame.publicKey;
    s.capabilities = frame.capabilities;
    s.joined = true;
    const peers = this.members();
    this.send(s.ws, { v: 1, type: "ctrl", method: "joined", roomId: this.roomId, agentId: s.agentId, peers, seq: this.seq });
    this.broadcast({ v: 1, type: "ctrl", method: "peer_update", roomId: this.roomId, peers, event: "joined", agentId: s.agentId }, s.ws);
  }

  private onClose(s: SockState) {
    if (!this.socks.has(s)) return;
    this.socks.delete(s);
    try { s.ws.close(); } catch { /* */ }
    if (s.joined && s.agentId) {
      // Another socket for the same agent (reconnect) — skip left.
      if (this.members().some((m) => m.agentId === s.agentId)) return;
      const peers = this.members();
      this.broadcast({ v: 1, type: "ctrl", method: "peer_update", roomId: this.roomId, peers, event: "left", agentId: s.agentId });
    }
  }
}
