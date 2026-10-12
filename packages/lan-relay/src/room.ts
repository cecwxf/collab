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
const MAX_CIPHERTEXT = 256 * 1024;

type SockState = {
  ws: WebSocket;
  agentId?: string;
  publicKey?: string;
  capabilities?: string[];
  joined: boolean;
  pending?: { challenge: string; agentId: string; publicKey: string };
  processing: Promise<void>;
  stamps: number[];
};

export class LanRoom {
  private socks = new Set<SockState>();
  private seq = 0;
  private ring: Extract<WireFrame, { type: "fwd" }>[] = [];
  private roomRate: number[] = [];
  private identities = new Map<string, string>();

  constructor(readonly roomId: string) {}

  attach(ws: WebSocket) {
    const s: SockState = { ws, joined: false, stamps: [], processing: Promise.resolve() };
    this.socks.add(s);
    ws.on("message", (data) => {
      s.processing = s.processing.then(() => this.onMessage(s, data.toString())).catch(() => this.error(s, "bad_frame", "invalid frame"));
    });
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

  private error(s: SockState, code: string, message: string) {
    this.send(s.ws, { v: 1, type: "ctrl", method: "error", code, message, roomId: this.roomId });
  }

  private rateOk(stamps: number[], now: number, limit: number) {
    const recent = stamps.filter((t) => now - t < 1000);
    if (recent.length >= limit) return { ok: false, next: recent };
    recent.push(now);
    return { ok: true, next: recent };
  }

  private async onMessage(s: SockState, text: string) {
    for (const line of text.split("\n")) {
      if (!this.socks.has(s)) return;
      if (!line.trim()) continue;
      const now = Date.now();
      const rr = this.rateOk(this.roomRate, now, 200);
      this.roomRate = rr.next;
      const sr = this.rateOk(s.stamps, now, RATE);
      s.stamps = sr.next;
      if (!rr.ok || !sr.ok) return this.error(s, "rate_limit", "too many frames");
      let frame: WireFrame;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        frame = parsed as WireFrame;
      } catch {
        this.error(s, "bad_json", "frame must be a JSON object");
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
        if (!Number.isSafeInteger(since) || since < 0) { this.error(s, "bad_poll", "invalid sinceSeq"); continue; }
        const frames = this.ring.filter((f) => f.seq > since);
        this.send(s.ws, { v: 1, type: "ctrl", method: "poll_result", roomId: this.roomId, frames, seq: this.seq });
        continue;
      }

      if (frame.type === "fwd") {
        if (frame.roomId !== this.roomId || frame.from !== s.agentId || typeof frame.ciphertext !== "string" || !frame.ciphertext || frame.ciphertext.length > MAX_CIPHERTEXT || typeof frame.nonce !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(frame.nonce)) {
          this.error(s, "bad_frame", "invalid encrypted frame");
          continue;
        }
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
    if (typeof frame.agentId !== "string" || !frame.agentId || frame.agentId.length > 128 || typeof frame.publicKey !== "string" || !frame.publicKey || frame.publicKey.length > 256 || typeof frame.challengeResp !== "string" || frame.challengeResp.length > 256 || (frame.capabilities !== undefined && (!Array.isArray(frame.capabilities) || frame.capabilities.length > 32 || frame.capabilities.some((c) => typeof c !== "string" || c.length > 128)))) {
      return this.error(s, "bad_join", "invalid identity or capabilities");
    }
    const knownKey = this.identities.get(frame.agentId);
    if (knownKey && knownKey !== frame.publicKey) return this.error(s, "identity_conflict", "agentId belongs to another public key in this room");
    if (s.joined) {
      if (frame.agentId !== s.agentId || frame.publicKey !== s.publicKey) return this.error(s, "identity_locked", "joined socket identity cannot change");
      this.send(s.ws, { v: 1, type: "ctrl", method: "joined", roomId: this.roomId, agentId: s.agentId, peers: this.members(), seq: this.seq });
      return;
    }
    if (!s.pending || !frame.challengeResp || s.pending.agentId !== frame.agentId || s.pending.publicKey !== frame.publicKey) {
      s.pending = { challenge: b64uEncode(randomBytes(32)), agentId: frame.agentId, publicKey: frame.publicKey };
      this.send(s.ws, { v: 1, type: "ctrl", method: "challenge", roomId: this.roomId, challenge: s.pending.challenge });
      return;
    }
    // Second join with challengeResp
    const pending = s.pending;
    s.pending = undefined;
    const ok = await verifyChallenge(frame.publicKey, pending.challenge, frame.challengeResp).catch(() => false);
    if (!this.socks.has(s)) return;
    if (!ok) {
      this.send(s.ws, { v: 1, type: "ctrl", method: "error", code: "bad_sig", message: "challenge failed", roomId: this.roomId });
      return;
    }
    // Another socket may have claimed this id while verification was awaiting crypto.
    const verifiedKey = this.identities.get(frame.agentId);
    if (verifiedKey && verifiedKey !== frame.publicKey) return this.error(s, "identity_conflict", "agentId belongs to another public key in this room");
    this.identities.set(frame.agentId, frame.publicKey);
    s.agentId = frame.agentId;
    s.publicKey = frame.publicKey;
    s.capabilities = frame.capabilities;
    s.joined = true;
    // Replace stale sessions only for the same verified identity.
    for (const old of [...this.socks]) {
      if (old !== s && old.joined && old.agentId === s.agentId) this.onClose(old);
    }
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
