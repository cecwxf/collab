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
let O, I, L, P;

before(async () => {
  await build({
    entryPoints: [join(here, "../src/orchestrator.ts"), join(here, "../src/isolation.ts"), join(here, "../src/local-agents.ts")],
    outdir, bundle: true, platform: "node", format: "esm", packages: "bundle", external: ["node:*"],
  });
  O = await import(join(outdir, "orchestrator.js"));
  I = await import(join(outdir, "isolation.js"));
  L = await import(join(outdir, "local-agents.js"));
  P = await import("../dist/index.js");
});

const agent = (name, extra = {}) => ({ id: name.toLowerCase(), agentId: `${name.toLowerCase()}.h0st`, name, scope: "read", approvalRequired: false, createdAt: 0, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const cfg = P.normalizeConfig({ statePath: join(dir, "state.json"), identityPath: join(dir, "identity.json"), workspacePath: ws, agentName: "human" });
  const b = new P.CollabBridge(fakeCtx(), cfg);
  await b.start();
  return b;
}
const texts = (b, roomId) => b.room(roomId).messages.map((m) => `${m.from}|${m.kind}|${m.text}`);

describe("local multi-agent room (loopback, mock runner)", () => {
  test("3 local agents as separate members: @all parallel, moderator task flow + summary, worktree merge, stop", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lma-bridge-"));
    const ws = join(dir, "ws");
    await mkdir(ws);
    const g = gitRepo(ws);
    await writeFile(join(ws, "README.md"), "demo\n");
    g("add", "-A"); g("commit", "-qm", "init");
    const b = await bridgeIn(dir, ws);
    b.localRunner = P.mockLocalRunner;
    const room = await b.createRoom({ name: "Team", localOnly: true, workspacePath: ws, agents: ["moderator", "coder", "reviewer"] });
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
    assert.match(cd.branch, /^room\/team-[a-z0-9]{4}\/coder-/);
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
