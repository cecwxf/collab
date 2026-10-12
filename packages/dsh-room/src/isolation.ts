/**
 * Workspace isolation for writing local agents.
 *  - git workspace: each writing agent gets its own worktree + branch `room/<room>/<agent>` under
 *    <repo>/.dsh-room/worktrees/ (excluded via .git/info/exclude). Diff/merge/discard go through the Merge UI.
 *  - non-git workspace: advisory file-level locks (agents call collab_lock_files; peer MCP writes honor them).
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, appendFile, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { slugify } from "./local-agents.js";

const MAX_PATCH = 200_000;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[], opts: { identity?: string } = {}): Promise<GitResult> {
  const pre = opts.identity ? ["-c", `user.name=${opts.identity}`, "-c", `user.email=${opts.identity.replace(/[^A-Za-z0-9._-]/g, "_")}@dsh-room.local`] : [];
  return new Promise((res) => {
    execFile("git", [...pre, ...args], { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      res({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function gitOk(cwd: string, args: string[], identity?: string): Promise<string> {
  const r = await git(cwd, args, { identity });
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`);
  return r.stdout;
}

/** Repo top-level for a path, or null when not a git work tree (or no commits yet). */
export async function gitTop(path: string): Promise<string | null> {
  const r = await git(path, ["rev-parse", "--show-toplevel"]);
  if (r.code !== 0) return null;
  const head = await git(path, ["rev-parse", "--verify", "HEAD"]);
  if (head.code !== 0) return null;
  return r.stdout.trim();
}

export function worktreeBranch(roomName: string, roomId: string, agentId: string): string {
  return `room/${slugify(roomName)}-${roomId.slice(-4).toLowerCase()}/${slugify(agentId.replace(/\./g, "-"))}`;
}

export function worktreeDir(repo: string, roomId: string, agentId: string): string {
  return join(repo, ".dsh-room", "worktrees", `${roomId.slice(-6).toLowerCase()}-${slugify(agentId.replace(/\./g, "-"))}`);
}

async function exists(p: string) {
  return stat(p).then(() => true, () => false);
}

async function ensureExcluded(repo: string) {
  const commonDir = (await gitOk(repo, ["rev-parse", "--git-common-dir"])).trim();
  const info = resolve(repo, commonDir, "info");
  await mkdir(info, { recursive: true });
  const f = join(info, "exclude");
  const cur = await readFile(f, "utf8").catch(() => "");
  if (!cur.split("\n").includes(".dsh-room/")) await appendFile(f, `${cur && !cur.endsWith("\n") ? "\n" : ""}.dsh-room/\n`);
}

export interface WorktreeInfo {
  repo: string;
  path: string;
  branch: string;
}

/** Read the stable worktree path and its actual branch; room names are editable labels. */
export async function readWorktree(repo: string, roomId: string, agentId: string): Promise<WorktreeInfo | null> {
  const path = worktreeDir(repo, roomId, agentId);
  if (!(await exists(join(path, ".git")))) return null;
  const branch = (await gitOk(path, ["symbolic-ref", "--short", "HEAD"])).trim();
  return { repo, path, branch };
}

/** Create (or reuse) the agent's worktree on its own branch from the repo's current HEAD. */
export async function ensureWorktree(repo: string, roomName: string, roomId: string, agentId: string): Promise<WorktreeInfo> {
  const branch = worktreeBranch(roomName, roomId, agentId);
  const path = worktreeDir(repo, roomId, agentId);
  await ensureExcluded(repo);
  const existing = await readWorktree(repo, roomId, agentId);
  if (existing) return existing;
  await git(repo, ["worktree", "prune"]);
  await mkdir(join(repo, ".dsh-room", "worktrees"), { recursive: true });
  const has = (await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  if (has) await gitOk(repo, ["worktree", "add", path, branch]);
  else await gitOk(repo, ["worktree", "add", "-b", branch, path, "HEAD"]);
  return { repo, path, branch };
}

/** Commit whatever the agent left uncommitted in its worktree (attributed to the agent). */
export async function commitPending(wt: WorktreeInfo, agentId: string): Promise<boolean> {
  if (!(await exists(wt.path))) return false;
  await gitOk(wt.path, ["add", "-A"]);
  const st = await git(wt.path, ["diff", "--cached", "--quiet"]);
  if (st.code === 0) return false;
  await gitOk(wt.path, ["commit", "-q", "-m", `room: changes by ${agentId}`], agentId);
  return true;
}

export interface DiffFile {
  path: string;
  adds: number;
  dels: number;
}

export interface WorktreeDiff {
  agentId: string;
  branch: string;
  path: string;
  ahead: number;
  files: DiffFile[];
  patch: string;
  truncated: boolean;
  /** Files that would conflict when merged into the main workspace HEAD (git merge-tree precheck). */
  conflicts: string[];
  mainDirty: string[];
}

export async function worktreeDiff(wt: WorktreeInfo, agentId: string): Promise<WorktreeDiff> {
  await commitPending(wt, agentId);
  const base = (await gitOk(wt.repo, ["merge-base", "HEAD", wt.branch])).trim();
  const ahead = Number((await gitOk(wt.repo, ["rev-list", "--count", `HEAD..${wt.branch}`])).trim()) || 0;
  const numstat = await gitOk(wt.repo, ["diff", "--numstat", base, wt.branch]);
  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...p] = l.split("\t");
      return { path: p.join("\t"), adds: Number(a) || 0, dels: Number(d) || 0 };
    });
  let patch = await gitOk(wt.repo, ["diff", base, wt.branch]);
  const truncated = patch.length > MAX_PATCH;
  if (truncated) patch = patch.slice(0, MAX_PATCH);
  return { agentId, branch: wt.branch, path: wt.path, ahead, files, patch, truncated, conflicts: ahead ? await mergeConflicts(wt.repo, wt.branch) : [], mainDirty: await dirtyFiles(wt.repo, files.map((f) => f.path)) };
}

/** Conflict precheck without touching the work tree (git >= 2.38). */
export async function mergeConflicts(repo: string, branch: string): Promise<string[]> {
  const r = await git(repo, ["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", branch]);
  if (r.code === 0) return [];
  if (r.code !== 1) return [];
  return r.stdout.split("\n").slice(1).map((s) => s.trim()).filter(Boolean);
}

/** Snapshot of uncommitted main-workspace changes (porcelain lines, excluding .dsh-room/). */
export async function mainStatus(repo: string): Promise<Set<string>> {
  const r = await git(repo, ["status", "--porcelain", "--untracked-files=all"]);
  return new Set(r.stdout.split("\n").filter((l) => l && !l.slice(3).startsWith(".dsh-room/")));
}

/** Uncommitted changes in the main workspace that overlap the given files. */
async function dirtyFiles(repo: string, files: string[]): Promise<string[]> {
  const r = await git(repo, ["status", "--porcelain", "--untracked-files=all"]);
  const dirty = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .filter((p) => !p.startsWith(".dsh-room/"));
  const want = new Set(files);
  return dirty.filter((p) => want.has(p));
}

export interface MergeResult {
  ok: boolean;
  merged: boolean;
  conflicts?: string[];
  error?: string;
  commit?: string;
}

/** Merge the agent branch into the main workspace's current branch. Aborts cleanly on conflict. */
export async function mergeWorktree(wt: WorktreeInfo, agentId: string): Promise<MergeResult> {
  await commitPending(wt, agentId);
  const ahead = Number((await gitOk(wt.repo, ["rev-list", "--count", `HEAD..${wt.branch}`])).trim()) || 0;
  if (!ahead) return { ok: true, merged: false, error: "nothing to merge" };
  const files = (await gitOk(wt.repo, ["diff", "--name-only", `HEAD...${wt.branch}`])).split("\n").filter(Boolean);
  const dirty = await dirtyFiles(wt.repo, files);
  if (dirty.length) return { ok: false, merged: false, conflicts: dirty, error: "main workspace has uncommitted changes in the same files" };
  const needId = (await git(wt.repo, ["config", "user.email"])).stdout.trim() ? undefined : "dsh-room";
  const r = await git(wt.repo, ["merge", "--no-ff", "--no-edit", "-m", `Merge ${wt.branch} (${agentId})`, wt.branch], { identity: needId });
  if (r.code !== 0) {
    const conflicts = (await git(wt.repo, ["diff", "--name-only", "--diff-filter=U"])).stdout.split("\n").filter(Boolean);
    await git(wt.repo, ["merge", "--abort"]);
    return { ok: false, merged: false, conflicts, error: conflicts.length ? "merge conflict" : (r.stderr || r.stdout).trim().slice(0, 400) };
  }
  const commit = (await gitOk(wt.repo, ["rev-parse", "--short", "HEAD"])).trim();
  // Fast-forward the agent branch to the merged main so its next work starts from it.
  await git(wt.path, ["merge", "--ff-only", "-q", commit]);
  return { ok: true, merged: true, commit };
}

/** Throw away the agent's worktree and branch (a fresh one is created on its next run). */
export async function discardWorktree(wt: WorktreeInfo): Promise<void> {
  await git(wt.repo, ["worktree", "remove", "--force", wt.path]);
  await git(wt.repo, ["worktree", "prune"]);
  await git(wt.repo, ["branch", "-D", wt.branch]);
}

/** Advisory file locks for non-git workspaces. Paths are workspace-relative and normalized. */
export class FileLocks {
  private locks = new Map<string, { owner: string; at: number }>();
  constructor(private root: string, private ttlMs = 30 * 60_000) {}

  norm(p: string): string {
    const abs = isAbsolute(p) ? p : resolve(this.root, p);
    const rel = relative(this.root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path outside workspace: ${p}`);
    return rel.replace(/\\/g, "/");
  }
  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.locks) if (now - v.at > this.ttlMs) this.locks.delete(k);
  }
  /** All-or-nothing acquire. */
  acquire(paths: string[], owner: string): { ok: true; locked: string[] } | { ok: false; held: { path: string; owner: string }[] } {
    this.sweep();
    const norm = paths.map((p) => this.norm(p));
    const held = norm.flatMap((p) => {
      const l = this.locks.get(p);
      return l && l.owner !== owner ? [{ path: p, owner: l.owner }] : [];
    });
    if (held.length) return { ok: false, held };
    const now = Date.now();
    for (const p of norm) this.locks.set(p, { owner, at: now });
    return { ok: true, locked: norm };
  }
  release(owner: string, paths?: string[]): number {
    let n = 0;
    const only = paths ? new Set(paths.map((p) => this.norm(p))) : null;
    for (const [k, v] of this.locks) if (v.owner === owner && (!only || only.has(k))) { this.locks.delete(k); n++; }
    return n;
  }
  holder(path: string): string | undefined {
    this.sweep();
    return this.locks.get(this.norm(path))?.owner;
  }
  list() {
    this.sweep();
    return [...this.locks].map(([path, v]) => ({ path, owner: v.owner, at: v.at }));
  }
}
