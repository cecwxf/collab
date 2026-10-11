/**
 * In-process mock relay: multiple MockTransports share one RoomHub.
 * Join = Ed25519 challenge. Fanout ciphertext only. Ring buffer + rate limit.
 * roomKey never touches the relay (E2EE).
 */
import {
  type WireFrame,
  type FwdFrame,
  type PeerInfo,
  type CtrlJoin,
  encodeFrame,
  decodeFrame,
  randomBytes,
  b64uEncode,
  verifyChallenge,
} from "@collab/protocol";
import type { Transport, FrameHandler, CloseHandler } from "./transport.js";

const RING_SIZE = 1000;
const RATE_PER_SEC = 50;

interface Member {
  agentId: string;
  publicKey: string;
  capabilities?: string[];
  transport: MockTransport;
}

interface RoomState {
  roomId: string;
  members: Map<string, Member>;
  challenges: Map<string, string>;
  seq: number;
  ring: FwdFrame[];
  rate: Map<string, number[]>;
}

export class RoomHub {
  rooms = new Map<string, RoomState>();

  getOrCreate(roomId: string): RoomState {
    let r = this.rooms.get(roomId);
    if (!r) {
      r = {
        roomId,
        members: new Map(),
        challenges: new Map(),
        seq: 0,
        ring: [],
        rate: new Map(),
      };
      this.rooms.set(roomId, r);
    }
    return r;
  }

  issueChallenge(roomId: string, agentId: string): string {
    const room = this.getOrCreate(roomId);
    const challenge = b64uEncode(randomBytes(32));
    room.challenges.set(agentId, challenge);
    return challenge;
  }
}

export class MockTransport implements Transport {
  private frameHandlers: FrameHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private _connected = false;

  constructor(
    readonly hub: RoomHub,
    readonly label = "mock",
  ) {}

  get connected() {
    return this._connected;
  }

  async connect(): Promise<void> {
    this._connected = true;
  }

  onFrame(handler: FrameHandler): void {
    this.frameHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  close(reason = "closed"): void {
    if (!this._connected) return;
    this._connected = false;
    for (const room of this.hub.rooms.values()) {
      for (const [aid, m] of [...room.members]) {
        if (m.transport === this) {
          room.members.delete(aid);
          this.broadcastPeerUpdate(room, aid, "left");
        }
      }
    }
    for (const h of this.closeHandlers) h(reason);
  }

  deliver(frame: WireFrame): void {
    if (!this._connected) return;
    for (const h of this.frameHandlers) h(frame);
  }

  send(frame: WireFrame): void {
    if (!this._connected) throw new Error("not connected");
    void this.handleIncoming(frame);
  }

  private async handleIncoming(frame: WireFrame): Promise<void> {
    if (frame.type === "ctrl" && frame.method === "ping") {
      this.deliver({ v: 1, type: "ctrl", method: "pong", ts: Date.now() });
      return;
    }
    if (frame.type === "ctrl" && frame.method === "join") {
      await this.handleJoin(frame);
      return;
    }
    if (frame.type === "ctrl" && frame.method === "leave") {
      const room = this.hub.rooms.get(frame.roomId);
      if (room) {
        room.members.delete(frame.agentId);
        this.broadcastPeerUpdate(room, frame.agentId, "left");
      }
      return;
    }
    if (frame.type === "ctrl" && frame.method === "poll") {
      const room = this.hub.rooms.get(frame.roomId);
      if (!room) {
        this.deliver({
          v: 1,
          type: "ctrl",
          method: "error",
          code: "no_room",
          message: "room not found",
          roomId: frame.roomId,
        });
        return;
      }
      const frames = room.ring.filter((f) => f.seq > frame.sinceSeq);
      this.deliver({
        v: 1,
        type: "ctrl",
        method: "poll_result",
        roomId: frame.roomId,
        frames,
        seq: room.seq,
      });
      return;
    }
    if (frame.type === "fwd") {
      await this.handleFwd(frame);
    }
  }

  private async handleJoin(frame: CtrlJoin): Promise<void> {
    const room = this.hub.getOrCreate(frame.roomId);
    let challenge = room.challenges.get(frame.agentId);
    if (!challenge || !frame.challengeResp) {
      challenge = this.hub.issueChallenge(frame.roomId, frame.agentId);
      this.deliver({
        v: 1,
        type: "ctrl",
        method: "challenge",
        roomId: frame.roomId,
        challenge,
      });
      return;
    }

    const sigOk = await verifyChallenge(
      frame.publicKey,
      challenge,
      frame.challengeResp,
    );
    if (!sigOk) {
      this.deliver({
        v: 1,
        type: "ctrl",
        method: "error",
        code: "bad_sig",
        message: "challenge signature invalid",
        roomId: frame.roomId,
      });
      return;
    }

    room.challenges.delete(frame.agentId);
    room.members.set(frame.agentId, {
      agentId: frame.agentId,
      publicKey: frame.publicKey,
      capabilities: frame.capabilities,
      transport: this,
    });

    const peers: PeerInfo[] = [...room.members.values()].map((m) => ({
      agentId: m.agentId,
      publicKey: m.publicKey,
      capabilities: m.capabilities,
    }));

    this.deliver({
      v: 1,
      type: "ctrl",
      method: "joined",
      roomId: frame.roomId,
      agentId: frame.agentId,
      peers,
      seq: room.seq,
    });
    this.broadcastPeerUpdate(room, frame.agentId, "joined", this);
  }

  private async handleFwd(frame: FwdFrame): Promise<void> {
    const room = this.hub.rooms.get(frame.roomId);
    if (!room) {
      this.deliver({
        v: 1,
        type: "ctrl",
        method: "error",
        code: "no_room",
        message: "not in room",
        roomId: frame.roomId,
      });
      return;
    }
    const member = room.members.get(frame.from);
    if (!member || member.transport !== this) {
      this.deliver({
        v: 1,
        type: "ctrl",
        method: "error",
        code: "not_member",
        message: "sender not joined",
        roomId: frame.roomId,
      });
      return;
    }

    const now = Date.now();
    const stamps = room.rate.get(frame.from) ?? [];
    const recent = stamps.filter((t) => now - t < 1000);
    if (recent.length >= RATE_PER_SEC) {
      this.deliver({
        v: 1,
        type: "ctrl",
        method: "error",
        code: "rate_limit",
        message: "too many messages",
        roomId: frame.roomId,
      });
      return;
    }
    recent.push(now);
    room.rate.set(frame.from, recent);

    room.seq += 1;
    const out: FwdFrame = { ...frame, seq: room.seq };
    room.ring.push(out);
    if (room.ring.length > RING_SIZE) room.ring.shift();

    for (const m of room.members.values()) {
      if (m.transport === this) continue;
      m.transport.deliver(out);
    }
  }

  private broadcastPeerUpdate(
    room: RoomState,
    agentId: string,
    event: "joined" | "left",
    except?: MockTransport,
  ): void {
    const peers: PeerInfo[] = [...room.members.values()].map((m) => ({
      agentId: m.agentId,
      publicKey: m.publicKey,
      capabilities: m.capabilities,
    }));
    const frame: WireFrame = {
      v: 1,
      type: "ctrl",
      method: "peer_update",
      roomId: room.roomId,
      peers,
      event,
      agentId,
    };
    for (const m of room.members.values()) {
      if (m.transport === except) continue;
      m.transport.deliver(frame);
    }
  }
}

export function roundtripJson(frame: WireFrame): WireFrame {
  return decodeFrame(encodeFrame(frame));
}
