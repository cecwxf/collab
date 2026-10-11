import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** One joined room. The invite carries the room key. */
export interface RoomMeta {
  roomId: string;
  invite: string;
  name: string;
  description: string;
  tags: string[];
  /** Listed in the relay's public directory (not confidential). Relay-only. */
  public: boolean;
  /** Created here: this identity signs the directory listing. */
  owner: boolean;
  /** dsh Session the room wakes (where /collab create|join ran, or the auto-created one). */
  sessionId?: string;
  joinedAt: number;
  /** Dual transport: relay (CF) or lan (local relay). */
  transport?: "relay" | "lan";
  /** Per-room local agent config (model, workspace, permissions). Keys never stored. */
  memberConfig?: import("./member-config.js").RoomMemberConfig;
}

/**
 * Runtime room state written by the Rooms UI and `/collab` so no cordis yml edit is needed.
 * Invites carry room keys, so the file is always mode 600 inside a mode 700 dir.
 */
export interface RoomState {
  version: 2;
  activeRoomId: string | null;
  rooms: RoomMeta[];
  updatedAt?: string;
}

export async function loadState(path: string): Promise<RoomState | null> {
  try {
    const s = JSON.parse(await readFile(path, "utf8")) as RoomState & { invite?: string; roomId?: string };
    if (Array.isArray(s.rooms)) return { version: 2, activeRoomId: s.activeRoomId ?? null, rooms: s.rooms.filter((r) => typeof r?.invite === "string" && typeof r?.roomId === "string") };
    return null;
  } catch {
    return null;
  }
}

export async function saveState(path: string, state: RoomState): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function clearState(path: string): Promise<void> {
  await rm(path, { force: true });
}
