export interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}
export declare function git(cwd: string, args: string[], opts?: {
    identity?: string;
}): Promise<GitResult>;
/** Repo top-level for a path, or null when not a git work tree (or no commits yet). */
export declare function gitTop(path: string): Promise<string | null>;
export declare function worktreeBranch(roomName: string, roomId: string, agentId: string): string;
export declare function worktreeDir(repo: string, roomId: string, agentId: string): string;
export interface WorktreeInfo {
    repo: string;
    path: string;
    branch: string;
}
/** Read the stable worktree path and its actual branch; room names are editable labels. */
export declare function readWorktree(repo: string, roomId: string, agentId: string): Promise<WorktreeInfo | null>;
/** Create (or reuse) the agent's worktree on its own branch from the repo's current HEAD. */
export declare function ensureWorktree(repo: string, roomName: string, roomId: string, agentId: string): Promise<WorktreeInfo>;
/** Commit whatever the agent left uncommitted in its worktree (attributed to the agent). */
export declare function commitPending(wt: WorktreeInfo, agentId: string): Promise<boolean>;
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
export declare function worktreeDiff(wt: WorktreeInfo, agentId: string): Promise<WorktreeDiff>;
/** Conflict precheck without touching the work tree (git >= 2.38). */
export declare function mergeConflicts(repo: string, branch: string): Promise<string[]>;
/** Snapshot of uncommitted main-workspace changes (porcelain lines, excluding .dsh-room/). */
export declare function mainStatus(repo: string): Promise<Set<string>>;
export interface MergeResult {
    ok: boolean;
    merged: boolean;
    conflicts?: string[];
    error?: string;
    commit?: string;
}
/** Merge the agent branch into the main workspace's current branch. Aborts cleanly on conflict. */
export declare function mergeWorktree(wt: WorktreeInfo, agentId: string): Promise<MergeResult>;
/** Throw away the agent's worktree and branch (a fresh one is created on its next run). */
export declare function discardWorktree(wt: WorktreeInfo): Promise<void>;
/** Advisory file locks for non-git workspaces. Paths are workspace-relative and normalized. */
export declare class FileLocks {
    private root;
    private ttlMs;
    private locks;
    constructor(root: string, ttlMs?: number);
    norm(p: string): string;
    private sweep;
    /** All-or-nothing acquire. */
    acquire(paths: string[], owner: string): {
        ok: true;
        locked: string[];
    } | {
        ok: false;
        held: {
            path: string;
            owner: string;
        }[];
    };
    release(owner: string, paths?: string[]): number;
    holder(path: string): string | undefined;
    list(): {
        path: string;
        owner: string;
        at: number;
    }[];
}
//# sourceMappingURL=isolation.d.ts.map