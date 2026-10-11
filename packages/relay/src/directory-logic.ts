/** Pure helpers for the public room Directory DO (testable in Node). */
import { b64uDecode } from "./room-logic.js";

export const DIRECTORY_TTL_MS = 15 * 60_000;
export const MAX_SKEW_MS = 5 * 60_000;
export const MAX_ENTRIES = 5000;
export const LIMITS = { name: 60, description: 280, tags: 8, tag: 24, invite: 512 } as const;
/** Per client IP, per minute. */
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

/** Must stay byte-identical to protocol/src/directory.ts listingMessage(). */
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

const isStr = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;

/** Shape/size validation; returns an error string or null. Does not check the signature. */
export function validateListing(raw: unknown, now: number): string | null {
  if (!raw || typeof raw !== "object") return "body must be a JSON object";
  const l = raw as Record<string, unknown>;
  if (!isStr(l.roomId, 128, 1) || !/^[A-Za-z0-9_-]+$/.test(l.roomId)) return "bad roomId";
  if (!isStr(l.name, LIMITS.name, 1) || !l.name.trim()) return `name required (<= ${LIMITS.name} chars)`;
  if (!isStr(l.description, LIMITS.description)) return `description <= ${LIMITS.description} chars`;
  if (!Array.isArray(l.tags) || l.tags.length > LIMITS.tags) return `tags: array of <= ${LIMITS.tags}`;
  for (const t of l.tags) if (!isStr(t, LIMITS.tag, 1) || !/^[a-z0-9][a-z0-9_-]*$/.test(t)) return `bad tag ${JSON.stringify(t)}`;
  if (!isStr(l.invite, LIMITS.invite, 1)) return "invite required";
  const m = /^collab:\/\/join\/([^#/]+)#(.+)$/.exec(l.invite);
  if (!m || decodeURIComponent(m[1]!) !== l.roomId) return "invite must be collab://join/<roomId>#<key> for this roomId";
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

/**
 * Search live entries. q: whitespace tokens, all must match name/description/tags
 * (case-insensitive substring; "#x" means tag x exactly). tag: exact tag filter.
 * Ranked: name hits first, then most recent activity.
 */
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

/** Sliding one-minute window per key. */
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
