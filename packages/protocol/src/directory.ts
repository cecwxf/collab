/**
 * Public room directory (relay-hosted). Rooms are private by default; a room owner may
 * publish a listing. A listing carries the room invite (incl. room key) so anyone who
 * finds it can join: PUBLIC ROOMS ARE NOT CONFIDENTIAL. Listings are signed with the
 * owner's Ed25519 identity (pinned on first publish) and expire unless re-published
 * (heartbeat) within DIRECTORY_TTL_MS.
 */
import { b64uEncode } from "./util.js";
import type { Identity } from "./identity.js";
import { importPrivateKey } from "./identity.js";

export const DIRECTORY_TTL_MS = 15 * 60_000;
export const DIRECTORY_HEARTBEAT_MS = 5 * 60_000;
export const DIRECTORY_LIMITS = { name: 60, description: 280, tags: 8, tag: 24, maxSkewMs: 5 * 60_000 } as const;
const PREFIX = "collab-v1-dir:";

export interface PublicListingInput {
  roomId: string;
  name: string;
  description?: string;
  tags?: string[];
  invite: string;
  members?: number;
}

export interface SignedListing extends Required<Omit<PublicListingInput, "members">> {
  members: number;
  agentId: string;
  publicKey: string;
  ts: number;
  sig: string;
}

export interface DirectoryEntry {
  roomId: string;
  name: string;
  description: string;
  tags: string[];
  invite: string;
  members: number;
  ownerAgentId: string;
  createdAt: number;
  lastSeen: number;
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<string>();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const v = t.trim().replace(/^#/, "").toLowerCase();
    if (/^[a-z0-9][a-z0-9_-]*$/.test(v) && v.length <= DIRECTORY_LIMITS.tag) out.add(v);
  }
  return [...out].slice(0, DIRECTORY_LIMITS.tags);
}

/** Canonical bytes both sides sign/verify. Keep identical to relay/src/directory-logic.ts. */
export function listingMessage(l: Omit<SignedListing, "sig">): string {
  return PREFIX + JSON.stringify(["publish", l.roomId, l.name, l.description, l.tags, l.invite, l.members, l.agentId, l.publicKey, l.ts]);
}
export function unlistMessage(roomId: string, publicKey: string, ts: number): string {
  return PREFIX + JSON.stringify(["unlist", roomId, publicKey, ts]);
}

const subtle = globalThis.crypto.subtle;
const asAB = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export async function signText(identity: Identity, message: string): Promise<string> {
  const key = await importPrivateKey(identity.privateKey);
  return b64uEncode(new Uint8Array(await subtle.sign({ name: "Ed25519" }, key, asAB(new TextEncoder().encode(message)))));
}

export async function signListing(identity: Identity, input: PublicListingInput, ts = Date.now()): Promise<SignedListing> {
  const body = {
    roomId: input.roomId,
    name: input.name.trim().slice(0, DIRECTORY_LIMITS.name),
    description: (input.description ?? "").trim().slice(0, DIRECTORY_LIMITS.description),
    tags: normalizeTags(input.tags),
    invite: input.invite,
    members: Math.max(0, Math.floor(input.members ?? 0)),
    agentId: identity.agentId,
    publicKey: identity.publicKey,
    ts,
  };
  return { ...body, sig: await signText(identity, listingMessage(body)) };
}

/** https base for the directory API from the ws(s) relay URL. */
export function relayHttpBase(relayUrl: string): string {
  return relayUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

export interface SearchQuery {
  q?: string;
  tag?: string;
  limit?: number;
}

export class DirectoryClient {
  readonly base: string;
  constructor(relayUrl: string, private fetchImpl: typeof fetch = globalThis.fetch) {
    this.base = relayHttpBase(relayUrl);
  }
  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(`directory ${res.status}: ${body.error ?? res.statusText}`);
    return body;
  }
  async search(query: SearchQuery = {}): Promise<DirectoryEntry[]> {
    const p = new URLSearchParams();
    if (query.q) p.set("q", query.q);
    if (query.tag) p.set("tag", query.tag.replace(/^#/, ""));
    if (query.limit) p.set("limit", String(query.limit));
    return (await this.call<{ rooms: DirectoryEntry[] }>(`/directory/rooms?${p}`)).rooms;
  }
  async publish(identity: Identity, input: PublicListingInput): Promise<DirectoryEntry> {
    const listing = await signListing(identity, input);
    return (await this.call<{ room: DirectoryEntry }>("/directory/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(listing),
    })).room;
  }
  async unlist(identity: Identity, roomId: string): Promise<void> {
    const ts = Date.now();
    const sig = await signText(identity, unlistMessage(roomId, identity.publicKey, ts));
    await this.call(`/directory/rooms/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, publicKey: identity.publicKey, ts, sig }),
    });
  }
}

