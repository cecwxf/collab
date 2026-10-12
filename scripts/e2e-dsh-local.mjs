#!/usr/bin/env node
// Real dsh host/API integration with deterministic agents and a disposable git workspace.
// Requires dsh on PATH. Does not use an API key or contact the public relay.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = await mkdtemp(join(tmpdir(), "collab-dsh-e2e-"));
const workspace = join(dir, "workspace");
const home = join(dir, "dsh");
const patch = join(dir, "test.patch.yml");
const env = { ...process.env, DSH_HOME: home, DSH_ROOM_MOCK_AGENTS: "1" };
let child, base, cookie;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await pause(50); }
  throw new Error(`timeout: ${label}`);
}
const git = (...args) => execFileSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@local", ...args], { cwd: workspace, stdio: "pipe" });
async function boot() {
  child = spawn("dsh", ["web", "--patch", patch, "--no-open", "--host", "127.0.0.1", "--port", "0"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((res, rej) => {
    let output = "";
    const timer = setTimeout(() => rej(new Error("dsh startup timeout")), 30_000);
    child.on("error", (e) => { clearTimeout(timer); rej(e); });
    child.on("exit", (code) => { clearTimeout(timer); rej(new Error(`dsh exited during startup: ${code}`)); });
    child.stdout.on("data", (data) => {
      output += data.toString();
      const m = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(output);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    // Consume stderr; do not expose auth links or host diagnostics in test output.
    child.stderr.on("data", () => {});
  });
  base = new URL(url).origin;
  const auth = await fetch(url, { redirect: "manual" });
  cookie = auth.headers.getSetCookie().map((v) => v.split(";", 1)[0]).join("; ");
  assert.ok(cookie, "dsh issued an auth cookie");
  await until(async () => (await api("/version")).version === "0.3.3", "plugin API loaded");
}
async function shutdown() {
  if (!child || child.exitCode !== null) return;
  const proc = child;
  await new Promise((res) => {
    const timer = setTimeout(() => proc.kill("SIGKILL"), 5000);
    proc.once("exit", () => { clearTimeout(timer); res(); });
    proc.kill("SIGTERM");
  });
}
async function api(path, body) {
  const response = await fetch(base + "/api/collab" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${path}: HTTP ${response.status}: ${value.error ?? ""}`);
  return value;
}
try {
  await mkdir(workspace, { recursive: true });
  git("init", "-q", "-b", "main");
  await writeFile(join(workspace, "README.md"), "disposable test workspace\n");
  git("add", "-A"); git("commit", "-qm", "init");
  await writeFile(patch, `- id: collab\n  config:\n    statePath: ${JSON.stringify(join(dir, "collab/state.json"))}\n    identityPath: ${JSON.stringify(join(dir, "collab/identity.json"))}\n    workspacePath: ${JSON.stringify(workspace)}\n    agentName: e2e-host\n    localAgentRunner: mock\n`);
  execFileSync("dsh", ["plugin", "--profile", "web", "add", join(repo, "packages/dsh-room")], { cwd: repo, env, stdio: "pipe" });
  await boot();
  const denied = await fetch(base + "/api/collab/state");
  assert.equal(denied.status, 401, "API requires the dsh auth cookie");
  const t0 = Date.now();
  const room = await api("/rooms", { name: "Local E2E", localOnly: true, workspacePath: workspace, agents: ["moderator", "coder", "reviewer"], concurrency: 2 });
  assert.ok(Date.now() - t0 < 3000, "create returns promptly");
  const prefix = `/rooms/${encodeURIComponent(room.roomId)}`;
  const view = async () => (await api("/state")).rooms.find((r) => r.roomId === room.roomId);
  await until(async () => (await view()).members.length === 4, "host and three agents joined");
  const coder = (await view()).local.agents.find((a) => a.name === "Coder");
  await api(prefix + "/send", { text: "@all hello" });
  await until(async () => (await api(prefix + "/messages")).messages.filter((m) => m.kind === "chat" && m.from !== "e2e-host").length === 2, "@all worker replies");
  await api(prefix + "/task", { title: "Implement local test" });
  await until(async () => (await api(prefix + "/messages")).messages.some((m) => m.text.includes("[mock Moderator] Summary")), "moderator task plan and summary");
  await until(async () => !(await api(prefix + "/runs")).runs.some((r) => ["running", "queued", "approval"].includes(r.state)), "runs finished");
  const diff = await api(prefix + "/diffs");
  assert.deepEqual(diff.agents.find((a) => a.agentId === coder.agentId).files.map((f) => f.path), ["room-notes/coder.md"]);
  const unapproved = await fetch(base + "/api/collab" + prefix + "/merge", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ agentId: coder.agentId }) });
  assert.equal(unapproved.status, 403);
  assert.equal((await api(prefix + "/merge", { agentId: coder.agentId, approve: true })).merged, true);
  assert.match(await readFile(join(workspace, "room-notes/coder.md"), "utf8"), /Written by coder/);
  const writing = api(prefix + "/mcp", { tool: "workspace_write", args: { path: "approved.txt", content: "approved" } });
  await until(async () => (await api("/approvals")).approvals.length === 1, "MCP write approval");
  await api("/approvals/decide", { requestId: (await api("/approvals")).approvals[0].requestId, decision: "allow" });
  assert.equal((await writing).ok, true);
  assert.equal(await readFile(join(workspace, "approved.txt"), "utf8"), "approved");
  await api(prefix + "/config", { peerGrants: { default: { read: "deny" }, byAgent: {} } });
  assert.equal((await api(prefix + "/config")).peerGrants.default.read, "deny", "UI ACL survives HTTP config update");
  const blockedRead = await fetch(base + "/api/collab" + prefix + "/mcp", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ tool: "workspace_read", args: { path: "approved.txt" } }) });
  assert.equal(blockedRead.status, 403, "read deny is enforced through real dsh API");
  await api(prefix + "/agents", { name: "Guarded", approvalRequired: true });
  await api(prefix + "/send", { text: "@guarded test approval" });
  await until(async () => (await api("/approvals")).approvals.length === 1, "agent approval");
  await api(prefix + "/stop", {});
  await until(async () => (await api("/approvals")).approvals.length === 0, "Stop removes approval");
  const before = (await api(prefix + "/messages")).messages.length;
  await shutdown();
  await boot();
  const saved = JSON.parse(await readFile(join(dir, "collab/state.json"), "utf8"));
  assert.equal(saved.rooms.length, 1);
  await until(async () => (await view()).members.length === 5, "all members restored after restart");
  assert.equal((await api(prefix + "/messages")).messages.length, before, "history restored");
  console.log("DSH LOCAL E2E PASS: auth, create, 3 agents, @all, moderator tasks/summary, isolated diff/merge, MCP approval/ACL, Stop, restart/history");
} finally {
  await shutdown();
  await rm(dir, { recursive: true, force: true });
}
