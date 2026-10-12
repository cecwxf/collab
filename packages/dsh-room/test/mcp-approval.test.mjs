import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, realpath, rm } from "node:fs/promises";
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

test("new files under a symlinked workspace are allowed; outside and dangling links are rejected", async (t) => {
  const { WorkspaceMcp } = await import(join(outdir, "mcp-workspace.js"));
  const { ApprovalQueue } = await import(join(outdir, "approval-queue.js"));
  const { defaultMemberConfig } = await import(join(outdir, "member-config.js"));
  const dir = await realpath(await mkdtemp(join(tmpdir(), "collab-paths-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "root"), outside = join(dir, "outside");
  await mkdir(root); await mkdir(outside);
  await symlink(root, join(dir, "alias"));
  const cfg = defaultMemberConfig(join(dir, "alias"));
  cfg.permissions.autoWrite = true;
  const mcp = new WorkspaceMcp(cfg, new ApprovalQueue(), "room");
  await mcp.call("workspace_write", { path: "nested/new.txt", content: "ok" }, "peer");
  assert.equal(await readFile(join(root, "nested/new.txt"), "utf8"), "ok");
  await symlink(outside, join(root, "outside"));
  await assert.rejects(mcp.call("workspace_write", { path: "outside/nested/new.txt", content: "bad" }, "peer"), /escapes workspace/);
  await symlink(join(outside, "missing.txt"), join(root, "dangling"));
  await assert.rejects(mcp.call("workspace_write", { path: "dangling", content: "bad" }, "peer"), /escapes workspace/);
  await mcp.call("workspace_write", { path: "..valid.txt", content: "ok" }, "peer");
});

test("read deny grants cover all read tools even when autoRead is enabled", async (t) => {
  const { WorkspaceMcp } = await import(join(outdir, "mcp-workspace.js"));
  const { ApprovalQueue } = await import(join(outdir, "approval-queue.js"));
  const { defaultMemberConfig } = await import(join(outdir, "member-config.js"));
  const dir = await mkdtemp(join(tmpdir(), "collab-grants-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "secret.txt"), "secret");
  const cfg = defaultMemberConfig(dir);
  cfg.peerGrants.byAgent.blocked = { read: "deny" };
  const mcp = new WorkspaceMcp(cfg, new ApprovalQueue(), "room");
  for (const tool of ["workspace_read", "workspace_list", "workspace_stat", "workspace_search"]) {
    await assert.rejects(mcp.call(tool, { path: tool === "workspace_list" || tool === "workspace_search" ? "." : "secret.txt", query: "secret" }, "blocked"), /peer grant deny/);
  }
});

test("approval can be decided synchronously by a subscriber", async () => {
  const { ApprovalQueue } = await import(join(outdir, "approval-queue.js"));
  const aq = new ApprovalQueue();
  aq.subscribe(() => { const p = aq.list()[0]; if (p) aq.decide(p.requestId, "allow"); });
  const result = await aq.request({ roomId: "r", action: "shell.exec", from: "a", summary: "test", timeoutMs: 25 });
  assert.equal(result, "allow");
  assert.equal(aq.list().length, 0);
});
