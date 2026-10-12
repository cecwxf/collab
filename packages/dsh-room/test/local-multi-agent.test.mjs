import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, ".lma-build");
let O, I, L, P, S;

before(async () => {
  await build({
    entryPoints: [join(here, "../src/orchestrator.ts"), join(here, "../src/isolation.ts"), join(here, "../src/local-agents.ts"), join(here, "../src/state.ts")],
    outdir, bundle: true, platform: "node", format: "esm", packages: "bundle", external: ["node:*"],
  });
  O = await import(join(outdir, "orchestrator.js"));
  I = await import(join(outdir, "isolation.js"));
  L = await import(join(outdir, "local-agents.js"));
  P = await import("../dist/index.js");
  S = await import(join(outdir, "state.js"));
});

const agent = (name, extra = {}) => ({ id: name.toLowerCase(), agentId: `${name.toLowerCase()}.h0st`, name, scope: "read", approvalRequired: false, createdAt: 0, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitConnected(bridge, roomId, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const conn = bridge.room(roomId);
    if (conn.status === "online" && conn.client?.isJoined()) {
      const agents = conn.local.agents;
      if (!agents.length || agents.every((a) => conn.agents.get(a.agentId)?.isJoined())) return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const conn = bridge.room(roomId);
  throw new Error(`room ${roomId} not ready: status=${conn.status} agents=${conn.local.agents.map((a) => a.agentId + ":" + !!conn.agents.get(a.agentId)?.isJoined()).join(",")}`);
}


describe("routing", () => {
  const mod = agent("Moderator", { moderator: true });
  const coder = agent("Coder", { scope: "write" });
  const rev = agent("Reviewer");
  const all = [mod, coder, rev];
  const chat = (mentions, extra = {}) => ({ kind: "chat", messageId: "m" + Math.random(), sender: "human", mentions, ...extra });

test("@agent wakes only that agent; aliases resolve; unknown mentions wake nobody", () => {
    assert.deepEqual(O.routeLocalTargets(chat(["coder.h0st"]), all).targets, ["coder.h0st"]);
    assert.deepEqual(O.routeLocalTargets(chat(["coder"]), all).targets, ["coder.h0st"]);
    assert.deepEqual(O.routeLocalTargets(chat(["someone-remote"]), all).targets, []);
    assert.deepEqual(O.routeLocalTargets(chat(undefined, { replyTo: "x" }), all).targets, [], "plain replies wake nobody");
  });
  test("@all wakes every worker in parallel (moderator only when named) and never the sender", () => {
    assert.deepEqual(O.routeLocalTargets(chat(["all"]), all).targets.sort(), ["coder.h0st", "reviewer.h0st"]);
    assert.deepEqual(O.routeLocalTargets(chat(["all", "moderator"]), all).targets.sort(), ["coder.h0st", "moderator.h0st", "reviewer.h0st"]);
    assert.deepEqual(O.routeLocalTargets(chat(["all"], { sender: "coder.h0st" }), all).targets, ["reviewer.h0st"]);
  });
  test("tasks go to the assignee; unassigned tasks go to the moderator", () => {
    assert.deepEqual(O.routeLocalTargets({ kind: "task.create", messageId: "t", sender: "human", taskId: "T1", assignee: "reviewer.h0st" }, all).targets, ["reviewer.h0st"]);
    const r = O.routeLocalTargets({ kind: "task.create", messageId: "t", sender: "human", taskId: "T2" }, all);
    assert.deepEqual(r, { targets: ["moderator.h0st"], reason: "task-moderator" });
    assert.deepEqual(O.routeLocalTargets({ kind: "task.create", messageId: "t", sender: "human", taskId: "T3" }, [coder, rev]).targets.sort(), ["coder.h0st", "reviewer.h0st"]);
  });
});

describe("turn limit", () => {
  test("threads follow replies / runs; budget is consumed per agent turn and resets on human posts", () => {
    const t = new O.ThreadTracker(3);
    const root = t.threadFor({ kind: "chat", messageId: "h1", sender: "human" });
    assert.equal(root, "h1");
    assert.equal(t.threadFor({ kind: "chat", messageId: "a1", sender: "a", replyTo: "h1" }), "h1");
    assert.equal(t.threadFor({ kind: "chat", messageId: "a2", sender: "a" }, "h1"), "h1", "message sent during a run joins the run's thread");
    assert.equal(t.threadFor({ kind: "task.update", messageId: "u", sender: "a", taskId: "T" }), "task:T");
    assert.equal(t.consume("h1", 2), 2);
    assert.equal(t.consume("h1", 2), 1, "partial allowance at the edge");
    assert.equal(t.consume("h1", 1), 0);
    assert.equal(t.shouldNotify("h1"), true);
    assert.equal(t.shouldNotify("h1"), false, "notified once");
    t.reset("h1");
    assert.equal(t.consume("h1", 1), 1);
  });
});

describe("concurrency scheduler", () => {
  test("requesting zero finished runs returns only active runs", async () => {
    const s = new O.RunScheduler(async () => {}, () => 1);
    s.enqueue({ roomId: "r", agentId: "a", threadId: "t", reason: "x", summary: "run" });
    await s.whenIdle();
    assert.deepEqual(s.list("r", 0), []);
  });
  test("stop retains the execution slot until cleanup finishes; the same agent never overlaps", async () => {
    let release;
    let live = 0, peak = 0, started = 0;
    const s = new O.RunScheduler(async () => {
      live++; started++; peak = Math.max(peak, live);
      if (started === 1) await new Promise((r) => { release = r; });
      live--;
    }, () => 1);
    s.enqueue({ roomId: "r", agentId: "a", threadId: "t", reason: "x", summary: "first" });
    await sleep(0);
    s.stop("r", "a");
    s.enqueue({ roomId: "r", agentId: "a", threadId: "t", reason: "x", summary: "second" });
    let idle = false;
    const idleP = s.whenIdle().then(() => { idle = true; });
    await sleep(0);
    const startedBeforeCleanup = started;
    const idleBeforeCleanup = idle;
    release();
    await idleP;
    assert.equal(startedBeforeCleanup, 1);
    assert.equal(idleBeforeCleanup, false);
    assert.equal(peak, 1);
    assert.equal(started, 2);
  });
  test("rejected approval settles whenIdle waiters", async () => {
    let reject;
    const s = new O.RunScheduler(async () => assert.fail("must not execute"), () => 1);
    s.enqueue({ roomId: "r", agentId: "a", threadId: "t", reason: "x", summary: "gate", gate: () => new Promise((_, r) => { reject = r; }) });
    const idleP = s.whenIdle();
    await sleep(0);
    reject(new Error("approval service failed"));
    const settled = await Promise.race([idleP.then(() => true), sleep(100).then(() => false)]);
    assert.equal(settled, true);
    assert.equal(s.list("r")[0].state, "failed");
  });
  test("caps parallel runs per room, keeps a FIFO queue, one run per agent at a time", async () => {
    let live = 0, peak = 0;
    const order = [];
    const s = new O.RunScheduler(async (run) => { live++; peak = Math.max(peak, live); order.push(run.agentId); await sleep(40); live--; }, () => 2);
    for (const id of ["a", "b", "c", "a", "d"]) s.enqueue({ roomId: "r", agentId: id, threadId: "t", reason: "x", summary: id });
    const snap = s.list("r");
    assert.equal(snap.filter((r) => r.state === "running").length, 2);
    assert.equal(snap.filter((r) => r.state === "queued").length, 3, "queue is visible");
    await s.whenIdle();
    assert.equal(peak, 2);
    assert.deepEqual(order.slice(0, 2), ["a", "b"]);
    assert.ok(order.indexOf("a", 1) > order.indexOf("c"), "second run of a waited for its first");
  });
  test("stop aborts running and drops queued runs; denied approval never starts", async () => {
    let aborted = 0;
    const s = new O.RunScheduler((run, req, signal) => new Promise((res, rej) => signal.addEventListener("abort", () => { aborted++; rej(new Error("stop")); })), () => 1);
    s.enqueue({ roomId: "r", agentId: "a", threadId: "t", reason: "x", summary: "1" });
    s.enqueue({ roomId: "r", agentId: "b", threadId: "t", reason: "x", summary: "2" });
    s.enqueue({ roomId: "r", agentId: "c", threadId: "t", reason: "x", summary: "3", gate: async () => false });
    await sleep(10);
    assert.equal(s.stop("r"), 2);
    await s.whenIdle();
    assert.equal(aborted, 1);
    const states = s.list("r").map((r) => r.state).sort();
    assert.deepEqual(states, ["stopped", "stopped", "stopped"]);
  });
});

function gitRepo(dir) {
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "pipe" }).toString();
  g("init", "-q", "-b", "main");
  return g;
}

describe("workspace isolation", () => {
  test("worktree per agent: diff, conflict precheck, merge, conflict abort, discard", async () => {
    const repo = await mkdtemp(join(tmpdir(), "lma-git-"));
    const g = gitRepo(repo);
    await writeFile(join(repo, "a.txt"), "base\n");
    g("add", "-A"); g("commit", "-qm", "init");
    const top = await I.gitTop(repo);
    assert.ok(top);
    const wt = await I.ensureWorktree(top, "Demo Room", "ROOM1234", "coder.h0st");
    assert.equal(wt.branch, "room/demo-room-1234/coder-h0st");
    assert.ok((await readFile(join(top, ".git/info/exclude"), "utf8")).includes(".dsh-room/"));
    await writeFile(join(wt.path, "new.txt"), "from coder\n");
    let d = await I.worktreeDiff(wt, "coder.h0st");
    assert.equal(d.ahead, 1);
    assert.deepEqual(d.files.map((f) => f.path), ["new.txt"]);
    assert.deepEqual(d.conflicts, []);
    let m = await I.mergeWorktree(wt, "coder.h0st");
    assert.equal(m.merged, true);
    assert.equal(await readFile(join(repo, "new.txt"), "utf8"), "from coder\n");
    // conflicting edit
    await writeFile(join(wt.path, "a.txt"), "coder version\n");
    await writeFile(join(repo, "a.txt"), "main version\n");
    g("commit", "-qam", "main edit");
    d = await I.worktreeDiff(wt, "coder.h0st");
    assert.deepEqual(d.conflicts, ["a.txt"], "precheck reports the conflict before merging");
    m = await I.mergeWorktree(wt, "coder.h0st");
    assert.equal(m.ok, false);
    assert.deepEqual(m.conflicts, ["a.txt"]);
    assert.equal(g("status", "--porcelain").trim(), "", "merge aborted cleanly");
    await I.discardWorktree(wt);
    assert.equal(g("branch", "--list", wt.branch).trim(), "");
  });
  test("file locks for non-git workspaces: all-or-nothing, owner release, no escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "lma-locks-"));
    const locks = new I.FileLocks(root);
    assert.equal(locks.acquire(["src/a.ts", "b.ts"], "coder").ok, true);
    const r = locks.acquire(["b.ts", "c.ts"], "reviewer");
    assert.equal(r.ok, false);
    assert.deepEqual(r.held, [{ path: "b.ts", owner: "coder" }]);
    assert.equal(locks.holder("c.ts"), undefined, "nothing taken on failure");
    assert.throws(() => locks.acquire(["../etc/passwd"], "x"), /outside workspace/);
    assert.equal(locks.release("coder"), 2);
    assert.equal(locks.acquire(["b.ts"], "reviewer").ok, true);
  });
});

function fakeCtx() {
  const logs = [];
  return { tools: { register: () => () => {} }, logger: { info: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) }, effect() {}, get: () => undefined, _logs: logs };
}

async function bridgeIn(dir, ws) {
  const cfg = P.normalizeConfig({ localAgentRunner: "mock", statePath: join(dir, "state.json"), identityPath: join(dir, "identity.json"), workspacePath: ws, agentName: "human" });
  const b = new P.CollabBridge(fakeCtx(), cfg);
  await b.start();
  return b;
}
const texts = (b, roomId) => b.room(roomId).messages.map((m) => `${m.from}|${m.kind}|${m.text}`);

describe("local multi-agent room (loopback, mock runner)", () => {
  test("merge/discard refuse a stopped agent while its execution is still cleaning up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-merge-stop-"));
    const ws = join(dir, "ws");
    await mkdir(ws);
    const g = gitRepo(ws);
    await writeFile(join(ws, "a.txt"), "base\n");
    g("add", "-A"); g("commit", "-qm", "init");
    const b = await bridgeIn(dir, ws);
    let release;
    b.localRunner = async () => new Promise((r) => { release = r; });
    try {
      const room = await b.createRoom({ localOnly: true, agents: ["coder"] });
      await waitConnected(b, room.roomId);
      const coder = b.room(room.roomId).local.agents[0];
      await b.send(room.roomId, "@coder go");
      for (let i = 0; !release && i < 200; i++) await sleep(5);
      assert.ok(release);
      b.stopLocal(room.roomId);
      await assert.rejects(b.mergeAgent(room.roomId, coder.agentId, true), /still running/);
      await assert.rejects(b.discardAgent(room.roomId, coder.agentId, true), /still running/);
    } finally { release?.(); await b.scheduler.whenIdle(); await b.dispose(); }
  });
  test("concurrent state snapshots finish in invocation order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-save-order-"));
    const path = join(dir, "state.json");
    const base = { version: 3, rooms: [], activeRoomId: null, activeWorkspaceId: null };
    await Promise.all([
      S.saveState(path, { ...base, workspaces: [{ id: "w", name: "old", path: "a".repeat(2_000_000), createdAt: 0 }] }),
      S.saveState(path, { ...base, workspaces: [{ id: "w", name: "new", path: "/new", createdAt: 0 }] }),
    ]);
    assert.equal(JSON.parse(await readFile(path, "utf8")).workspaces[0].name, "new");
  });
  test("stop while a dsh session is being created never starts a followup turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-session-stop-"));
    const b = await bridgeIn(dir, join(dir, "ws"));
    let release, started = 0;
    b.config.localAgentRunner = "dsh";
    b.agentServices = () => ({});
    b.agentSessionFor = () => new Promise((r) => { release = () => r({ agent: { session: { seq: 0 }, followup() { started++; this.session.seq++; }, whenIdle: async () => {} } }); });
    try {
      const room = await b.createRoom({ localOnly: true, agents: ["reviewer"] });
      await waitConnected(b, room.roomId);
      await b.send(room.roomId, "@reviewer go");
      for (let i = 0; !release && i < 100; i++) await sleep(5);
      assert.ok(release, "session creation reached");
      b.stopLocal(room.roomId);
      release();
      await b.scheduler.whenIdle();
      assert.equal(started, 0);
    } finally { release?.(); await b.dispose(); }
  });
  test("loopback to localhost relay and back preserves members/history and refuses to cut off remote peers", async () => {
    const { LanRelayServer } = await import("@collab/lan-relay");
    const { CollabClient, WsTransport } = await import("@collab/sdk");
    const { generateIdentity } = await import("@collab/protocol");
    const server = new LanRelayServer({ port: 0, mdns: false, host: "127.0.0.1" });
    const { port } = await server.listen();
    const dir = await mkdtemp(join(tmpdir(), "lma-transport-"));
    const b = await bridgeIn(dir, join(dir, "ws"));
    b.localRunner = async () => {};
    let peer;
    try {
      const room = await b.createRoom({ localOnly: true, lanHostPort: `127.0.0.1:${port}`, agents: ["architect", "reviewer"] });
      await waitConnected(b, room.roomId);
      await b.send(room.roomId, "loopback history");
      await b.setTransport(room.roomId, "relay");
      await waitConnected(b, room.roomId);
      const parsed = CollabClient.parseInvite(room.invite);
      peer = new CollabClient({ identity: await generateIdentity("remote"), roomId: room.roomId, roomKey: parsed.roomKeyB64, transport: new WsTransport(`ws://127.0.0.1:${port}/ws/${room.roomId}`) });
      const configs = new Set();
      peer.onPayload((p) => { if (p.kind === "member.config") configs.add(p.sender); });
      await peer.join();
      await sleep(1000);
      assert.equal(configs.size, 3, "new peer receives host and every local agent config");
      await peer.sendChat("relay history");
      await sleep(20);
      await assert.rejects(b.setTransport(room.roomId, "local"), /remote members are connected/);
      await peer.dispose();
      await sleep(30);
      await b.setTransport(room.roomId, "local");
      await waitConnected(b, room.roomId);
      assert.ok(texts(b, room.roomId).some((m) => m.endsWith("|loopback history")));
      assert.ok(texts(b, room.roomId).some((m) => m.endsWith("|relay history")));
      assert.equal(b.view(b.room(room.roomId)).members.length, 3);
    } finally { await peer?.dispose(); await b.dispose(); await server.close(); }
  });
  test("acknowledged local messages are durable before a host shutdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-history-"));
    const b = await bridgeIn(dir, join(dir, "ws"));
    try {
      const room = await b.createRoom({ localOnly: true });
      await waitConnected(b, room.roomId);
      await b.send(room.roomId, "last message before restart");
      const stored = JSON.parse(await readFile(join(dir, "local-history", `${room.roomId}.json`), "utf8").catch(() => "[]"));
      assert.ok(stored.some((m) => m.text === "last message before restart"));
    } finally { await b.dispose(); }
  });
  test("stopping an approval run removes its pending approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-stop-approval-"));
    const b = await bridgeIn(dir, join(dir, "ws"));
    try {
      const room = await b.createRoom({ localOnly: true, agents: [{ name: "Guarded", approvalRequired: true }] });
      await waitConnected(b, room.roomId);
      await b.send(room.roomId, "@guarded go");
      assert.equal(b.approvals.list().length, 1);
      b.stopLocal(room.roomId);
      await b.scheduler.whenIdle();
      assert.equal(b.approvals.list().length, 0);
    } finally { await b.dispose(); }
  });
  test("concurrent state writes do not share a temporary file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-save-"));
    const path = join(dir, "state.json");
    const state = { version: 3, rooms: [], workspaces: [], activeRoomId: null, activeWorkspaceId: null };
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => S.saveState(path, state)));
    assert.deepEqual(results.filter((r) => r.status === "rejected"), []);
    assert.equal(JSON.parse(await readFile(path, "utf8")).version, 3);
  });
  test("restart persists room membership before background reconnect; concurrent saves are atomic", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-restart-"));
    const ws = join(dir, "ws");
    await mkdir(ws);
    const b = await bridgeIn(dir, ws);
    const room = await b.createRoom({ name: "Persisted", localOnly: true, agents: ["reviewer"] });
    await waitConnected(b, room.roomId);
    await b.dispose();
    const restarted = await bridgeIn(dir, ws);
    try {
      const saved = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
      assert.equal(saved.rooms.length, 1, "startup must not erase rooms before reconnect");
      assert.equal(saved.rooms[0].roomId, room.roomId);
      await waitConnected(restarted, room.roomId);
      await Promise.all(Array.from({ length: 20 }, () => restarted.persist()));
      assert.equal(JSON.parse(await readFile(join(dir, "state.json"), "utf8")).rooms[0].roomId, room.roomId);
    } finally {
      await restarted.dispose();
    }
  });
  test("3 local agents as separate members: @all parallel, moderator task flow + summary, worktree merge, stop", async (tc) => {
    const dir = await mkdtemp(join(tmpdir(), "lma-bridge-"));
    const ws = join(dir, "ws");
    await mkdir(ws);
    const g = gitRepo(ws);
    await writeFile(join(ws, "README.md"), "demo\n");
    g("add", "-A"); g("commit", "-qm", "init");
    const b = await bridgeIn(dir, ws);
    tc.after(() => b.dispose());
    b.localRunner = P.mockLocalRunner;
    const room = await b.createRoom({ name: "Team", localOnly: true, workspacePath: ws, agents: ["moderator", "coder", "reviewer"] });
    await waitConnected(b, room.roomId);
    assert.equal(room.transport, "local");
    const v = b.view(b.room(room.roomId));
    assert.equal(v.local.agents.length, 3);
    const ids = v.local.agents.map((a) => a.agentId);
    assert.ok(ids.every((id) => /^[a-z-]+\.[a-z0-9]{4}$/.test(id)), ids.join());
    assert.deepEqual(new Set(v.members.map((m) => m.agentId)), new Set(["human", ...ids]), "each local agent is its own member");
    const coder = v.local.agents.find((a) => a.name === "Coder");
    const reviewer = v.local.agents.find((a) => a.name === "Reviewer");
    const mod = v.local.agents.find((a) => a.moderator);

    // @all → both workers in parallel, moderator stays quiet
    await b.send(room.roomId, "@all say hi");
    await b.scheduler.whenIdle();
    let t = texts(b, room.roomId);
    assert.ok(t.some((x) => x.startsWith(coder.agentId + "|chat|[mock Coder]")));
    assert.ok(t.some((x) => x.startsWith(reviewer.agentId + "|chat|[mock Reviewer]")));
    assert.ok(!t.some((x) => x.startsWith(mod.agentId + "|chat|")));

    // unassigned task → moderator decomposes → workers do subtasks → moderator summarizes
    await b.createTask(room.roomId, "Add a feature");
    await b.scheduler.whenIdle();
    await sleep(50);
    await b.scheduler.whenIdle();
    t = texts(b, room.roomId);
    assert.ok(t.some((x) => x.startsWith(mod.agentId + "|chat|[mock Moderator] Plan")), t.join("\n"));
    assert.equal(t.filter((x) => x.startsWith(mod.agentId + "|task.create|")).length, 2);
    assert.ok(t.some((x) => x.startsWith(coder.agentId + "|task.update|") && x.includes("wrote room-notes/coder.md")));
    assert.ok(t.some((x) => x.startsWith(mod.agentId + "|chat|[mock Moderator] Summary")), "moderator summarized after all subtasks finished");

    // the coder wrote in its own worktree, not the main workspace
    const diffs = await b.agentDiffs(room.roomId);
    const cd = diffs.agents.find((a) => a.agentId === coder.agentId);
    assert.equal(cd.isolation, "worktree");
    assert.match(cd.branch, /^room\/team-[a-z0-9_-]{4}\/coder-/);
    assert.deepEqual(cd.files.map((f) => f.path), ["room-notes/coder.md"]);
    await assert.rejects(b.mergeAgent(room.roomId, coder.agentId, false), /explicit approval/);
    const mr = await b.mergeAgent(room.roomId, coder.agentId, true);
    assert.equal(mr.merged, true);
    assert.match(await readFile(join(ws, "room-notes/coder.md"), "utf8"), /Written by coder/);

    // concurrency + stop
    await b.updateLocalSettings(room.roomId, { concurrency: 1 });
    await b.send(room.roomId, "@all again");
    await sleep(20);
    const runs = b.view(b.room(room.roomId)).runs;
    assert.equal(runs.filter((r) => r.state === "running").length, 1);
    assert.equal(runs.filter((r) => r.state === "queued").length, 1);
    assert.equal(b.stopLocal(room.roomId).stopped, 2);
    await b.scheduler.whenIdle();
    await b.dispose();
  });

  test("turn limit stops agent ping-pong; tool calls from an agent session post as that agent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-turns-"));
    const ws = join(dir, "ws");
    await mkdir(ws);
    const b = await bridgeIn(dir, ws);
    const room = await b.createRoom({ name: "Loop", localOnly: true, workspacePath: ws, agents: ["architect", "reviewer"] });
    await waitConnected(b, room.roomId);
    await b.updateLocalSettings(room.roomId, { turnLimit: 4 });
    const [arch, rev] = b.room(room.roomId).local.agents;
    let runs = 0;
    // each agent always hands off to the other → would loop forever without the limit
    b.localRunner = async (ctx) => {
      runs++;
      const other = ctx.agent.agentId === arch.agentId ? rev : arch;
      await ctx.bridge.publishAs(ctx.roomId, ctx.agent.agentId, { kind: "chat", text: `@${other.agentId} your turn`, mentions: [other.agentId], replyTo: ctx.trigger?.messageId });
    };
    await b.send(room.roomId, `@${arch.agentId} start`);
    for (let i = 0; i < 20; i++) { await b.scheduler.whenIdle(); await sleep(20); }
    assert.equal(runs, 1 + 4, "1 human-triggered turn + 4 agent hand-offs");
    assert.ok(texts(b, room.roomId).some((x) => x.includes("Turn limit (4) reached")));

    // tool routing by calling session
    const tools = Object.fromEntries(b.tools().map((t) => [t.name, t]));
    b.room(room.roomId).meta.agentSessions = { [rev.agentId]: "sess-rev" };
    const r = await tools.collab_send.execute({ text: "hello from the reviewer session" }, { agent: { session: { id: "sess-rev" } } });
    assert.ok(r.seq >= 0);
    assert.ok(texts(b, room.roomId).includes(`${rev.agentId}|chat|hello from the reviewer session`));
    await b.dispose();
  });

  test("agent config CRUD + loopback → relay switch keeps agents (offline relay tolerated)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-crud-"));
    const ws = join(dir, "ws");
    await mkdir(ws);
    const b = await bridgeIn(dir, ws);
    b.localRunner = async () => {};
    const room = await b.createRoom({ name: "Crud", localOnly: true, workspacePath: ws });
    await waitConnected(b, room.roomId);
    const a = await b.addLocalAgent(room.roomId, { name: "Tester", persona: "writes tests", scope: "write", approvalRequired: true, model: "deepseek-chat", agentId: "evil" });
    assert.notEqual(a.agentId, "evil", "client cannot choose the member id");
    await b.updateLocalAgent(room.roomId, a.id, { reasoningEffort: "high", scope: "read" });
    assert.equal(b.room(room.roomId).local.agents[0].scope, "read");
    // approval-required agents wait in the queue for the user
    await b.send(room.roomId, `@${a.agentId} go`);
    await sleep(10);
    assert.equal(b.view(b.room(room.roomId)).runs[0].state, "approval");
    assert.equal(b.approvals.list().length, 1);
    b.decideApproval(b.approvals.list()[0].requestId, "deny").catch(() => {});
    await b.scheduler.whenIdle();
    const st = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    assert.equal(st.rooms[0].local.agents[0].name, "Tester");
    assert.equal(st.rooms[0].local.loopback, true);
    await assert.rejects(b.setTransport(room.roomId, "local").then(() => { throw new Error("noop-ok"); }), /noop-ok/);
    await b.removeLocalAgent(room.roomId, a.id);
    assert.equal(b.room(room.roomId).local.agents.length, 0);
    await b.dispose();
  });
});

test("model catalog exposes concrete names and agents inherit the room selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lma-models-"));
  const ctx = fakeCtx();
  const services = {
    agentDefaultModel: { currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-flash" }) },
    llm: { listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }], listModels: async () => [
      { provider: "deepseek-official", id: "deepseek-flash", name: "DeepSeek-V41-Flash" },
      { provider: "deepseek-official", id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    ] },
  };
  ctx.get = (name) => services[name];
  const b = new P.CollabBridge(ctx, P.normalizeConfig({ statePath: join(dir, "state.json"), identityPath: join(dir, "identity.json"), workspacePath: join(dir, "ws") }));
  try {
    await b.start();
    const room = await b.createRoom({ localOnly: true, agents: [{ name: "Worker" }] });
    assert.equal(b.state().defaultModel.name, "DeepSeek-V41-Flash");
    assert.equal(b.view(b.room(room.roomId)).memberConfig.resolvedModel.name, "DeepSeek-V41-Flash");
    await b.updateMemberConfig(room.roomId, { provider: "deepseek-official", model: "deepseek-v4-pro" });
    assert.equal(b.localView(b.room(room.roomId)).agents[0].resolvedModel.name, "DeepSeek-V4-Pro");
    const ag = b.localView(b.room(room.roomId)).agents[0];
    await b.updateLocalAgent(room.roomId, ag.agentId, { model: "deepseek-flash" });
    assert.equal(b.localView(b.room(room.roomId)).agents[0].resolvedModel.name, "DeepSeek-V41-Flash");
    await b.updateLocalAgent(room.roomId, ag.agentId, { model: "", provider: "" });
    assert.equal(b.localView(b.room(room.roomId)).agents[0].resolvedModel.name, "DeepSeek-V4-Pro");
  } finally { await b.dispose(); }
});

test("room and worker sessions use their resolved model; changing it disposes old handles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lma-model-session-"));
  const calls = []; let disposed = 0;
  const services = {
    agentDefaultModel: { currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-flash" }) },
    agents: { create: async (o) => { calls.push(o.agentOptions); return { agent: { session: {}, followup() {} }, dispose: async () => { disposed++; } }; } },
    agentPresets: { resolve: async () => ({ id: "default" }), acquireScope: async () => ({ [Symbol.asyncDispose]: async () => {} }), mount: async () => {} },
    permissionPresets: { resolve() {}, set() {} }, sessionTitle: { rename() {} },
    workspaceRegistry: { create: async (path) => ({ path, attachSession: async () => {} }) },
  };
  const ctx=fakeCtx();ctx.get=(name)=>services[name];
  const b=new P.CollabBridge(ctx,P.normalizeConfig({statePath:join(dir,'state.json'),identityPath:join(dir,'id.json'),workspacePath:join(dir,'ws')}));
  try {
    await b.start();const room=await b.createRoom({localOnly:true,agents:[{name:'Worker'}]});const conn=b.room(room.roomId);const a=conn.local.agents[0];
    await b.updateMemberConfig(room.roomId,{model:'deepseek-v4-pro',reasoningEffort:'low'});
    await b.sessionFor(conn,services);await b.agentSessionFor(conn,a,join(dir,'ws'));
    assert.deepEqual(calls,[{provider:'deepseek-official',model:'deepseek-v4-pro',reasoningEffort:'low'},{provider:'deepseek-official',model:'deepseek-v4-pro',reasoningEffort:'low'}]);
    await b.updateMemberConfig(room.roomId,{model:'deepseek-flash'});assert.equal(disposed,2);
    await b.agentSessionFor(conn,a,join(dir,'ws'));assert.equal(calls.at(-1).model,'deepseek-flash');
  } finally { await b.dispose(); }
});

test("missing real agent services fail visibly instead of silently generating mock replies", async () => {
  const dir=await mkdtemp(join(tmpdir(),'lma-no-services-'));const b=await bridgeIn(dir,join(dir,'ws'));b.config.localAgentRunner='dsh';
  try {const room=await b.createRoom({localOnly:true,agents:['reviewer']});await waitConnected(b,room.roomId);await b.send(room.roomId,'@reviewer hello');await b.scheduler.whenIdle();assert.equal(b.scheduler.list(room.roomId)[0].state,'failed');assert.ok(!b.room(room.roomId).messages.some(m=>m.text.includes('[mock')));}finally{await b.dispose();}
});

test("short invites use configured relayUrl for both the host and local agent sockets", async () => {
  const {LanRelayServer}=await import('@collab/lan-relay');const relay=new LanRelayServer({host:'127.0.0.1',port:0,mdns:false});await relay.listen();
  const dir=await mkdtemp(join(tmpdir(),'lma-relay-config-'));const ctx=fakeCtx();const b=new P.CollabBridge(ctx,P.normalizeConfig({relayUrl:`ws://127.0.0.1:${relay.port}`,statePath:join(dir,'state.json'),identityPath:join(dir,'id.json'),workspacePath:join(dir,'ws'),localAgentRunner:'mock'}));
  try {await b.start();const room=await b.createRoom({mode:'relay',agents:['reviewer']});await waitConnected(b,room.roomId);assert.equal(b.view(b.room(room.roomId)).members.length,2);}finally{await b.dispose();await relay.close();}
});

test("model-facing history and room state contain only lossless JSON values", async () => {
  const dir=await mkdtemp(join(tmpdir(),'lma-tool-json-'));const b=await bridgeIn(dir,join(dir,'ws'));
  try {const room=await b.createRoom({localOnly:true});await waitConnected(b,room.roomId);await b.send(room.roomId,'json history marker');for(const name of ['collab_history','collab_rooms','collab_peers']){const out=await b.tools().find(t=>t.name===name).execute({roomId:room.roomId},{});assert.deepEqual(out,JSON.parse(JSON.stringify(out)),name+' must satisfy dsh lossless JSON output validation');}}finally{await b.dispose();}
});
