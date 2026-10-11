/**
 * Invite URIs
 *   collab://join/<roomId>#<key>                    → relay (DEFAULT_RELAY_URL or config)
 *   collab://relay/<host>/join/<roomId>#<key>       → explicit wss://host relay
 *   collab://lan/<host>:<port>/<roomId>#<key>       → LAN ws://host:port/ws/<roomId>
 *
 * Optional query: ?name=<display> (ignored by parse; for humans/mDNS).
 */
import { b64uEncode, randomBytes, ulidLike } from "./util.js";
import { DEFAULT_RELAY_URL } from "./types.js";

export type TransportMode = "relay" | "lan";

export interface ParsedInvite {
  mode: TransportMode;
  roomId: string;
  roomKeyB64: string;
  /** Full invite URI (canonical). */
  uri: string;
  /** WebSocket base for this invite (no trailing /ws/roomId). */
  wsBase: string;
  /** Relay HTTP base (https…) when mode=relay; undefined for LAN. */
  httpBase?: string;
  /** LAN host:port when mode=lan. */
  lanHostPort?: string;
  /** Optional display name from ?name= */
  name?: string;
}

function stripQuery(path: string): { path: string; name?: string } {
  const i = path.indexOf("?");
  if (i < 0) return { path };
  const q = new URLSearchParams(path.slice(i + 1));
  return { path: path.slice(0, i), name: q.get("name") ?? undefined };
}

export function createRoomInvite(opts?: {
  mode?: TransportMode;
  /** For relay: override host (no scheme), default DEFAULT_RELAY_URL host. */
  relayHost?: string;
  /** For lan: host:port of the LAN relay, e.g. 100.x.x.x:7421 */
  lanHostPort?: string;
  name?: string;
}): { roomId: string; roomKey: Uint8Array; roomKeyB64: string; uri: string; mode: TransportMode } {
  const mode = opts?.mode ?? "relay";
  const roomId = ulidLike();
  const roomKey = randomBytes(32);
  const roomKeyB64 = b64uEncode(roomKey);
  const q = opts?.name ? `?name=${encodeURIComponent(opts.name)}` : "";
  let uri: string;
  if (mode === "lan") {
    const hp = opts?.lanHostPort;
    if (!hp || !/^[A-Za-z0-9._:-]+:\d+$/.test(hp)) throw new Error("lan invite needs lanHostPort as host:port");
    uri = `collab://lan/${hp}/${roomId}${q}#${roomKeyB64}`;
  } else if (opts?.relayHost) {
    const host = opts.relayHost.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
    uri = `collab://relay/${host}/join/${roomId}${q}#${roomKeyB64}`;
  } else {
    uri = `collab://join/${roomId}${q}#${roomKeyB64}`;
  }
  return { roomId, roomKey, roomKeyB64, uri, mode };
}

export function parseInviteUri(uri: string): ParsedInvite {
  const raw = uri.trim();
  const hash = raw.indexOf("#");
  if (hash < 0) throw new Error("invite URI missing room key fragment");
  const key = raw.slice(hash + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error("bad room key fragment");
  const head = raw.slice(0, hash);

  // collab://lan/<host>:<port>/<roomId>
  let m = /^collab:\/\/lan\/([^/#]+:\d+)\/([A-Za-z0-9_-]+)(.*)$/.exec(head);
  if (m) {
    const { path: _p, name } = stripQuery(m[3] || "");
    const lanHostPort = m[1]!;
    const roomId = m[2]!;
    return {
      mode: "lan",
      roomId,
      roomKeyB64: key,
      uri: raw,
      wsBase: `ws://${lanHostPort}`,
      lanHostPort,
      name,
    };
  }

  // collab://relay/<host>/join/<roomId>
  m = /^collab:\/\/relay\/([^/#]+)\/join\/([A-Za-z0-9_-]+)(.*)$/.exec(head);
  if (m) {
    const { name } = stripQuery(m[3] || "");
    const host = m[1]!;
    const roomId = m[2]!;
    const wsBase = `wss://${host}`;
    return {
      mode: "relay",
      roomId,
      roomKeyB64: key,
      uri: raw,
      wsBase,
      httpBase: `https://${host}`,
      name,
    };
  }

  // collab://join/<roomId>
  m = /^collab:\/\/join\/([A-Za-z0-9_-]+)(.*)$/.exec(head);
  if (m) {
    const { name } = stripQuery(m[2] || "");
    const roomId = m[1]!;
    const wsBase = DEFAULT_RELAY_URL.replace(/\/+$/, "");
    return {
      mode: "relay",
      roomId,
      roomKeyB64: key,
      uri: raw,
      wsBase,
      httpBase: wsBase.replace(/^ws/, "http"),
      name,
    };
  }

  throw new Error("invalid invite URI (expected collab://join/…, collab://relay/…/join/…, or collab://lan/…)");
}

/** Build the WebSocket URL to open for a parsed invite. */
export function inviteWsUrl(inv: ParsedInvite): string {
  return `${inv.wsBase.replace(/\/+$/, "")}/ws/${encodeURIComponent(inv.roomId)}`;
}
