/**
 * CollabDirectory: one global Durable Object listing PUBLIC rooms.
 * Stores signed listings (incl. invite — public rooms are not confidential), pins the
 * owner key on first publish, drops entries not re-published within the TTL.
 */
import {
  MAX_ENTRIES,
  READS_PER_MIN,
  WRITES_PER_MIN,
  checkMinuteRate,
  isLive,
  listingMessage,
  searchEntries,
  toPublic,
  unlistMessage,
  validateListing,
  verifyText,
  type SignedListing,
  type StoredEntry,
} from "./directory-logic.js";

const KEY = (roomId: string) => `r:${roomId}`;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" },
  });

/** Request-driven only: no alarms. Expired listings purged lazily on GET/POST. */
export class CollabDirectory implements DurableObject {
  private buckets = new Map<string, number[]>();

  constructor(private state: DurableObjectState) {}

  private async all(now: number): Promise<StoredEntry[]> {
    const map = await this.state.storage.list<StoredEntry>({ prefix: "r:" });
    const live: StoredEntry[] = [];
    const dead: string[] = [];
    for (const [k, e] of map) (isLive(e, now) ? live.push(e) : dead.push(k));
    if (dead.length) await this.state.storage.delete(dead.slice(0, 128));
    return live;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const write = request.method !== "GET";
    if (!checkMinuteRate(this.buckets, `${write ? "w" : "r"}:${ip}`, now, write ? WRITES_PER_MIN : READS_PER_MIN)) {
      return json(429, { error: "rate limited" });
    }

    if (url.pathname === "/directory/rooms" && request.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const rooms = searchEntries(await this.all(now), { q: url.searchParams.get("q") ?? undefined, tag: url.searchParams.get("tag") ?? undefined, limit }, now);
      return json(200, { rooms, now });
    }

    if (url.pathname === "/directory/rooms" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as SignedListing | null;
      const err = validateListing(body, now);
      if (err) return json(400, { error: err });
      const l = body!;
      const { sig, ...unsigned } = l;
      if (!(await verifyText(l.publicKey, listingMessage(unsigned), sig))) return json(401, { error: "bad signature" });
      const prev = await this.state.storage.get<StoredEntry>(KEY(l.roomId));
      const prevLive = prev && isLive(prev, now);
      if (prevLive && prev.ownerKey !== l.publicKey) return json(403, { error: "room is listed by another owner" });
      if (!prevLive) {
        const count = (await this.all(now)).length;
        if (count >= MAX_ENTRIES) return json(507, { error: "directory full" });
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
        createdAt: prevLive ? prev.createdAt : now,
        lastSeen: now,
      };
      await this.state.storage.put(KEY(l.roomId), entry);
      return json(200, { room: toPublic(entry) });
    }

    const del = /^\/directory\/rooms\/([^/]+)$/.exec(url.pathname);
    if (del && request.method === "DELETE") {
      const roomId = decodeURIComponent(del[1]!);
      const body = (await request.json().catch(() => null)) as { publicKey?: string; ts?: number; sig?: string } | null;
      if (!body?.publicKey || typeof body.ts !== "number" || !body.sig || Math.abs(now - body.ts) > 5 * 60_000) return json(400, { error: "bad unlist request" });
      if (!(await verifyText(body.publicKey, unlistMessage(roomId, body.publicKey, body.ts), body.sig))) return json(401, { error: "bad signature" });
      const prev = await this.state.storage.get<StoredEntry>(KEY(roomId));
      if (!prev) return json(200, { ok: true, removed: false });
      if (prev.ownerKey !== body.publicKey) return json(403, { error: "not the owner" });
      await this.state.storage.delete(KEY(roomId));
      return json(200, { ok: true, removed: true });
    }

    return json(404, { error: "not found" });
  }
}
