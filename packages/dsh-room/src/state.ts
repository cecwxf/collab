import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { RoomMemberConfig } from "./member-config.js";
import type { RoomLocalSettings } from "./local-agents.js";

/** Normalize workspace paths for equality (macOS /private/var|/private/tmp, trailing slashes, backslashes). */
export function normalizeWorkspacePath(path: string | undefined | null): string {
  return (path || "").replace(/\\/g, "/").replace(/^\/private\/(?=var\/|tmp\/)/, "/").replace(/\/+$/, "");
}

export function sameWorkspacePath(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizeWorkspacePath(a);
  const nb = normalizeWorkspacePath(b);
  return !!na && !!nb && na === nb;
}


/** A local workspace that owns one or more Collab rooms. */
export interface WorkspaceMeta {
  id: string;
  /** Display name */
  name: string;
  /** Absolute path on this machine (MCP sandbox / agent cwd). */
  path: string;
  createdAt: number;
}

/** One joined room. The invite carries the room key. */
export interface RoomMeta {
  roomId: string;
  invite: string;
  name: string;
  description: string;
  tags: string[];
  /** Listed in the relay's public directory (not confidential). */
  public: boolean;
  /** Created here: this identity signs the directory listing. */
  owner: boolean;
  /** dsh Session the room wakes (where /collab create|join ran, or the auto-created one). */
  sessionId?: string;
  joinedAt: number;
  /** Dual transport: relay (CF) or lan (local relay). */
  transport?: "relay" | "lan";
  /** Per-room local agent config (model, workspace, permissions). Keys never stored. */
  memberConfig?: RoomMemberConfig;
  /** Workspace this room belongs to (required for new rooms). */
  workspaceId?: string;
  /** Native dsh sidebar workspace id (data-row-key workspace:…); used to pin the room under that row. */
  hostWorkspaceId?: string;
  /** Local multi-agent settings (agents hosted by this dsh, turn limit, concurrency, loopback). */
  local?: RoomLocalSettings;
  /** local agentId → dsh session id it runs in. */
  agentSessions?: Record<string, string>;
  /** Local agents whose model rejected their reasoning effort (their sessions use the model default). */
  agentNoEffort?: string[];
}

/**
 * Runtime room state written by the DSH Room UI and `/collab` so no cordis yml edit is needed.
 * Invites carry room keys, so the file is always mode 600 inside a mode 700 dir.
 */
export interface RoomState {
  version: 4;
  activeWorkspaceId: string | null;
  activeRoomId: string | null;
  workspaces: WorkspaceMeta[];
  rooms: RoomMeta[];
  updatedAt?: string;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createWorkspaceMeta(name: string, path: string): WorkspaceMeta {
  return {
    id: newId("ws"),
    name: (name || path.split(/[/\\]/).filter(Boolean).pop() || "workspace").slice(0, 60),
    path,
    createdAt: Date.now(),
  };
}

export async function loadState(path: string): Promise<RoomState | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Omit<RoomState, "version"> & { version?: number };
    if (!Array.isArray(raw.rooms)) return null;
    const rooms = raw.rooms.filter((r) => typeof r?.invite === "string" && typeof r?.roomId === "string");
    // v4 retires the old defaults once. Explicit limits saved by v4 stay intact.
    if ((raw.version ?? 0) < 4) for (const room of rooms) {
      if (room.local?.concurrency === 2) room.local.concurrency = 0;
      if (room.local?.turnLimit === 6) room.local.turnLimit = 0;
    }
    let workspaces = Array.isArray(raw.workspaces) ? raw.workspaces.filter((w) => w?.id && w?.path) : [];
    // Migrate v2 → v3: synthesize a default workspace from room memberConfig / first path
    if (workspaces.length === 0 && rooms.length) {
      const pathGuess =
        rooms.find((r) => r.memberConfig?.workspacePath)?.memberConfig?.workspacePath ||
        "";
      if (pathGuess) {
        const ws = createWorkspaceMeta("Default", pathGuess);
        workspaces = [ws];
        for (const r of rooms) {
          r.workspaceId = ws.id;
          if (!r.memberConfig) {
            /* leave */
          } else if (!r.memberConfig.workspacePath) {
            r.memberConfig.workspacePath = ws.path;
            r.memberConfig.workspaceLabel = ws.name;
          }
        }
      }
    }
    return {
      version: 4,
      activeWorkspaceId: raw.activeWorkspaceId ?? workspaces[0]?.id ?? null,
      activeRoomId: raw.activeRoomId ?? null,
      workspaces,
      rooms,
    };
  } catch {
    return null;
  }
}

const pendingWrites = new Map<string, Promise<void>>();

export async function saveState(path: string, state: RoomState): Promise<void> {
  path = resolve(path);
  const snapshot = structuredClone(state);
  const pending = (pendingWrites.get(path) ?? Promise.resolve()).catch(() => {}).then(() => writeState(path, snapshot));
  pendingWrites.set(path, pending);
  try { await pending; }
  finally { if (pendingWrites.get(path) === pending) pendingWrites.delete(path); }
}

async function writeState(path: string, state: RoomState): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const body: RoomState = {
    version: 4,
    activeWorkspaceId: state.activeWorkspaceId,
    activeRoomId: state.activeRoomId,
    workspaces: state.workspaces,
    rooms: state.rooms,
    updatedAt: new Date().toISOString(),
  };
  try {
    await writeFile(tmp, JSON.stringify(body, null, 2), { mode: 0o600, flag: "wx" });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function clearState(path: string): Promise<void> {
  await rm(path, { force: true });
}
