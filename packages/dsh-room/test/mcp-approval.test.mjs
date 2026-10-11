import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, ".mcp-build");

before(async () => {
  await build({
    entryPoints: [
      join(here, "../src/mcp-workspace.ts"),
      join(here, "../src/approval-queue.ts"),
      join(here, "../src/member-config.ts"),
    ],
    outdir,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "bundle",
    external: ["node:*"],
  });
});

test("workspace MCP sandbox + write approval", async () => {
  const { WorkspaceMcp } = await import(join(outdir, "mcp-workspace.js"));
  const { ApprovalQueue } = await import(join(outdir, "approval-queue.js"));
  const { defaultMemberConfig } = await import(join(outdir, "member-config.js"));

  const root = await mkdtemp(join(tmpdir(), "collab-mcp-"));
  await writeFile(join(root, "hello.txt"), "hi", "utf8");
  const cfg = defaultMemberConfig(root);
  const aq = new ApprovalQueue();
  const mcp = new WorkspaceMcp(cfg, aq, "room1");

  const listed = await mcp.call("workspace_list", { path: "." }, "peer-a");
  assert.ok(listed.entries.some((e) => e.name === "hello.txt"));
  assert.equal((await mcp.call("workspace_read", { path: "hello.txt" }, "peer-a")).content, "hi");

  const writeP = mcp.call("workspace_write", { path: "out.txt", content: "ok" }, "peer-a");
  await new Promise((r) => setTimeout(r, 40));
  const pending = aq.list();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].action, "fs.write");
  aq.decide(pending[0].requestId, "allow");
  assert.equal((await writeP).ok, true);
  assert.equal(await readFile(join(root, "out.txt"), "utf8"), "ok");

  await assert.rejects(() => mcp.call("workspace_read", { path: "../secret" }, "peer-a"));
});
