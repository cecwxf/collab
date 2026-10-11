/**
 * In-memory public room directory for the Node / VPS relay.
 * Same HTTP API as Cloudflare CollabDirectory DO:
 *   GET|POST /directory/rooms
 *   DELETE /directory/rooms/:roomId
 */
import { b64uDecode } from "@collab/protocol";
import type { IncomingMessage, ServerResponse } from "node:http";

export const DIRECTORY_TTL_MS = 15 * 60_000;
export const MAX_SKEW_MS = 5 * 60_000;
export const MAX_ENTRIES = 5000;
export const LIMITS = { name: 60, description: 280, tags: 8, tag: 24, invite: 512 } as const;
export const READS_PER_MIN = 120;
export const WRITES_PER_MIN = 20;
const PREFIX = "collab-v1-dir:";

export interface SignedListing {
  roomId: string;
  name: string;
  description: string;
  tags: string[];
  invite: string;
  members: number;
  agentId: string;
  publicKey: string;
  ts: number;
  sig: string;
}

export interface StoredEntry {
  roomId: string;
  name: string;
  description: string;
  tags: string[];
  invite: string;
  members: number;
  ownerAgentId: string;
  ownerKey: string;
  createdAt: number;
  lastSeen: number;
}

export type PublicEntry = Omit<StoredEntry, "ownerKey">;

export function listingMessage(l: Omit<SignedListing, "sig">): string {
  return PREFIX + JSON.stringify(["publish", l.roomId, l.name, l.description, l.tags, l.invite, l.members, l.agentId, l.publicKey, l.ts]);
}
export function unlistMessage(roomId: string, publicKey: string, ts: number): string {
  return PREFIX + JSON.stringify(["unlist", roomId, publicKey, ts]);
}

const asAB = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export async function verifyText(publicKeyB64: string, message: string, sigB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", asAB(b64uDecode(publicKeyB64)), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, asAB(b64uDecode(sigB64)), asAB(new TextEncoder().encode(message)));
  } catch {
    return false;
  }
}

/** Accept join / lan / relay invite forms as long as roomId matches. */
export function inviteMatchesRoom(invite: string, roomId: string): boolean {
  let m = /^collab:\/\/join\/([^#/?]+)/.exec(invite);
  if (m) return decodeURIComponent(m[1]!) === roomId;
  m = /^collab:\/\/lan\/[^/#]+:\d+\/([^#/?]+)/.exec(invite);
  if (m) return decodeURIComponent(m[1]!) === roomId;
  m = /^collab:\/\/relay\/[^/#]+\/join\/([^#/?]+)/.exec(invite);
  if (m) return decodeURIComponent(m[1]!) === roomId;
  return false;
}

const isStr = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;

export function validateListing(raw: unknown, now: number): string | null {
  if (!raw || typeof raw !== "object") return "body must be a JSON object";
  const l = raw as Record<string, unknown>;
  if (!isStr(l.roomId, 128, 1) || !/^[A-Za-z0-9_-]+$/.test(l.roomId)) return "bad roomId";
  if (!isStr(l.name, LIMITS.name, 1) || !l.name.trim()) return `name required (<= ${LIMITS.name} chars)`;
  if (!isStr(l.description, LIMITS.description)) return `description <= ${LIMITS.description} chars`;
  if (!Array.isArray(l.tags) || l.tags.length > LIMITS.tags) return `tags: array of <= ${LIMITS.tags}`;
  for (const t of l.tags) if (!isStr(t, LIMITS.tag, 1) || !/^[a-z0-9][a-z0-9_-]*$/.test(t)) return `bad tag ${JSON.stringify(t)}`;
  if (!isStr(l.invite, LIMITS.invite, 1)) return "invite required";
  if (!inviteMatchesRoom(l.invite, l.roomId)) {
    return "invite must be collab://join|lan|relay … for this roomId";
  }
  if (typeof l.members !== "number" || !Number.isInteger(l.members) || l.members < 0 || l.members > 10_000) return "bad members";
  if (!isStr(l.agentId, 128, 1)) return "bad agentId";
  if (!isStr(l.publicKey, 256, 1)) return "bad publicKey";
  if (!isStr(l.sig, 256, 1)) return "bad sig";
  if (typeof l.ts !== "number" || Math.abs(now - l.ts) > MAX_SKEW_MS) return "stale or future ts";
  return null;
}

export function isLive(e: StoredEntry, now: number, ttl = DIRECTORY_TTL_MS): boolean {
  return now - e.lastSeen < ttl;
}

export function toPublic(e: StoredEntry): PublicEntry {
  const { ownerKey: _ownerKey, ...rest } = e;
  return rest;
}

export function searchEntries(entries: StoredEntry[], opts: { q?: string; tag?: string; limit?: number }, now: number): PublicEntry[] {
  const tokens = (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tag = opts.tag?.toLowerCase().replace(/^#/, "");
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const scored: { e: StoredEntry; score: number }[] = [];
  for (const e of entries) {
    if (!isLive(e, now)) continue;
    if (tag && !e.tags.includes(tag)) continue;
    const name = e.name.toLowerCase();
    const hay = `${name}\n${e.description.toLowerCase()}`;
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (t.startsWith("#")) {
        if (!e.tags.includes(t.slice(1))) ok = false;
      } else if (name.includes(t)) score += 2;
      else if (hay.includes(t) || e.tags.some((x) => x.includes(t))) score += 1;
      else ok = false;
      if (!ok) break;
    }
    if (ok) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || b.e.lastSeen - a.e.lastSeen);
  return scored.slice(0, limit).map((s) => toPublic(s.e));
}

export function checkMinuteRate(buckets: Map<string, number[]>, key: string, now: number, limit: number): boolean {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 10_000) buckets.clear();
  return true;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...CORS });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** In-memory directory store + HTTP handler. */
export class RoomDirectory {
  private entries = new Map<string, StoredEntry>();
  private buckets = new Map<string, number[]>();

  size(): number {
    return this.entries.size;
  }

  private live(now: number): StoredEntry[] {
    const live: StoredEntry[] = [];
    for (const [id, e] of this.entries) {
      if (isLive(e, now)) live.push(e);
      else this.entries.delete(id);
    }
    return live;
  }

  /** Returns true if the request was handled (including OPTIONS/404 for /directory/*). */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/directory")) return false;
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return true;
    }
    const now = Date.now();
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const write = req.method !== "GET";
    if (!checkMinuteRate(this.buckets, `${write ? "w" : "r"}:${ip}`, now, write ? WRITES_PER_MIN : READS_PER_MIN)) {
      sendJson(res, 429, { error: "rate limited" });
      return true;
    }

    if (url.pathname === "/directory/rooms" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const rooms = searchEntries(this.live(now), {
        q: url.searchParams.get("q") ?? undefined,
        tag: url.searchParams.get("tag") ?? undefined,
        limit,
      }, now);
      sendJson(res, 200, { rooms, now });
      return true;
    }

    if (url.pathname === "/directory/rooms" && req.method === "POST") {
      const body = (await readJson(req)) as SignedListing | null;
      const err = validateListing(body, now);
      if (err) {
        sendJson(res, 400, { error: err });
        return true;
      }
      const l = body!;
      const { sig, ...unsigned } = l;
      if (!(await verifyText(l.publicKey, listingMessage(unsigned), sig))) {
        sendJson(res, 401, { error: "bad signature" });
        return true;
      }
      const prev = this.entries.get(l.roomId);
      const prevLive = prev && isLive(prev, now);
      if (prevLive && prev.ownerKey !== l.publicKey) {
        sendJson(res, 403, { error: "room is listed by another owner" });
        return true;
      }
      if (!prevLive && this.live(now).length >= MAX_ENTRIES) {
        sendJson(res, 507, { error: "directory full" });
        return true;
      }
      const entry: StoredEntry = {
        roomId: l.roomId,
        name: l.name.trim(),
        description: l.description.trim(),
        tags: l.tags,
        invite: l.invite,
        members: l.members,
        ownerAgentId: l.agentId,
        ownerKey: l.publicKey,
        createdAt: prevLive ? prev!.createdAt : now,
        lastSeen: now,
      };
      this.entries.set(l.roomId, entry);
      sendJson(res, 200, { room: toPublic(entry) });
      return true;
    }

    const del = /^\/directory\/rooms\/([^/]+)$/.exec(url.pathname);
    if (del && req.method === "DELETE") {
      const roomId = decodeURIComponent(del[1]!);
      const body = (await readJson(req)) as { publicKey?: string; ts?: number; sig?: string } | null;
      if (!body?.publicKey || typeof body.ts !== "number" || !body.sig || Math.abs(now - body.ts) > MAX_SKEW_MS) {
        sendJson(res, 400, { error: "bad unlist request" });
        return true;
      }
      if (!(await verifyText(body.publicKey, unlistMessage(roomId, body.publicKey, body.ts), body.sig))) {
        sendJson(res, 401, { error: "bad signature" });
        return true;
      }
      const prev = this.entries.get(roomId);
      if (!prev) {
        sendJson(res, 200, { ok: true, removed: false });
        return true;
      }
      if (prev.ownerKey !== body.publicKey) {
        sendJson(res, 403, { error: "not the owner" });
        return true;
      }
      this.entries.delete(roomId);
      sendJson(res, 200, { ok: true, removed: true });
      return true;
    }

    sendJson(res, 404, { error: "not found" });
    return true;
  }
}
