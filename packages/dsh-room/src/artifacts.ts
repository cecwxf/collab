import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve a local output, preferring its author's worktree before the shared workspace. */
export async function resolveRoomFile(root: string, preferred: string, path: string): Promise<string> {
  if (!path || path.includes("\0") || /^[a-z]+:\/\//i.test(path)) throw new Error("workspace file path required");
  const realRoot = await realpath(root);
  // A room rooted in a monorepo subdirectory can own a worktree beside that subdirectory.
  const allowed = [realRoot];
  if (preferred !== root) { try { allowed.push(await realpath(preferred)); } catch { /* Discarded worktree: use root. */ } }
  const outside = (p: string) => isAbsolute(p) || p === ".." || p.startsWith(`..${sep}`);
  for (const base of [...new Set([preferred, root])]) {
    const candidate = resolve(base, path);
    // Resolve aliases (e.g. /var on macOS) before comparing the containment boundary.
    let file: string;
    try { file = await realpath(candidate); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
    if (allowed.every(base => outside(relative(base, file)))) throw new Error("path escapes room workspace or agent worktree");
    if (!(await stat(file)).isFile()) throw new Error("workspace path is not a file");
    return file;
  }
  throw new Error("file not found in the room workspace or agent worktree");
}
