#!/usr/bin/env node
/**
 * prepare: use committed/prebuilt dist when present (npm/git install).
 * Rebuild only when dist is missing and a compiler toolchain is available.
 */
import { accessSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distJs = join(root, "dist", "index.js");

try {
  accessSync(distJs);
  process.exit(0);
} catch {
  // fall through
}

const r = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
