import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { LanRelayServer } from "./server.js";
import { generateIdentity, signChallenge, type WireFrame } from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function childRelay(t: TestContext) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "--host", "127.0.0.1", "--port", "0", "--no-mdns"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("relay start timeout")), 3000);
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("relay exited before listening")); });
    child.stdout.on("data", (d) => {
      output += d.toString();
      const m = /listening on 127\.0\.0\.1:(\d+)/.exec(output);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });
  return { child, port };
}

async function socket(url: string, t: TestContext) {
  const ws = new WebSocket(url);
  t.after(() => ws.terminate());
  ws.on("error", () => {});
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return ws;
}

function nextFrame(ws: WebSocket): Promise<WireFrame> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); ws.off("message", receive); ws.off("close", closed); };
    const receive = (data: WebSocket.RawData) => { cleanup(); resolve(JSON.parse(data.toString().trim())); };
    const closed = () => { cleanup(); reject(new Error("socket closed before response")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("response timeout")); }, 1000);
    ws.once("message", receive); ws.once("close", closed);
  });
}

for (const [name, text] of [["JSON null", "null"], ["invalid public key", JSON.stringify({ v: 1, type: "ctrl", method: "join", roomId: "probe", agentId: "bad", publicKey: "invalid", challengeResp: "" })]] as const) {
  test(`malformed ${name} cannot terminate the relay process`, async (t) => {
    const { child, port } = await childRelay(t);
    const ws = await socket(`ws://127.0.0.1:${port}/ws/probe`, t);
    ws.send(text);
    if (name === "invalid public key") {
      await pause(30);
      ws.send(JSON.stringify({ v: 1, type: "ctrl", method: "join", roomId: "probe", agentId: "bad", publicKey: "invalid", challengeResp: "invalid" }));
    }
    await pause(100);
    assert.equal(child.exitCode, null, `${name} crashed the relay`);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  });
}

test("malformed percent-encoded WebSocket room path cannot terminate the relay", async (t) => {
  const { child, port } = await childRelay(t);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/%`);
  ws.on("error", () => {});
  t.after(() => ws.terminate());
  await pause(100);
  assert.equal(child.exitCode, null, "upgrade path crashed the relay");
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

test("a new join challenge cannot change an already authenticated socket identity", async (t) => {
  const server = new LanRelayServer({ host: "127.0.0.1", port: 0, mdns: false });
  const { port } = await server.listen();
  const ws = await socket(`ws://127.0.0.1:${port}/ws/probe`, t);
  t.after(() => server.close());
  const identity = await generateIdentity("original");
  const first = nextFrame(ws);
  ws.send(JSON.stringify({ v: 1, type: "ctrl", method: "join", roomId: "probe", agentId: identity.agentId, publicKey: identity.publicKey, challengeResp: "" }));
  const challenge = await first;
  assert.ok(challenge.type === "ctrl" && challenge.method === "challenge");
  const joined = nextFrame(ws);
  ws.send(JSON.stringify({ v: 1, type: "ctrl", method: "join", roomId: "probe", agentId: identity.agentId, publicKey: identity.publicKey, challengeResp: await signChallenge(identity, challenge.challenge) }));
  await joined;
  assert.equal(server.room("probe").members()[0]!.agentId, "original");
  const response = nextFrame(ws);
  ws.send(JSON.stringify({ v: 1, type: "ctrl", method: "join", roomId: "probe", agentId: "victim", publicKey: identity.publicKey, challengeResp: "" }));
  await response;
  assert.equal(server.room("probe").members()[0]!.agentId, "original", "identity changed before a signature was verified");
  ws.terminate();
});

test("same-key reconnect replaces the previous socket and different-key identity reuse is rejected", async (t) => {
  const server = new LanRelayServer({ host: "127.0.0.1", port: 0, mdns: false });
  const { port } = await server.listen();
  const room = CollabClient.createRoom();
  const identity = await generateIdentity("same-agent");
  const make = (identity: Awaited<ReturnType<typeof generateIdentity>>) => new CollabClient({ identity, roomId: room.roomId, roomKey: room.roomKey, transport: new WsTransport(`ws://127.0.0.1:${port}/ws/${room.roomId}`) });
  const a = make(identity), resumed = make(identity), imposter = make(await generateIdentity("same-agent"));
  t.after(async () => { await a.dispose(); await resumed.dispose(); await imposter.dispose(); await server.close(); });
  await a.join(); await resumed.join();
  await pause(30);
  assert.equal(a.isJoined(), false);
  assert.equal(resumed.isJoined(), true);
  assert.equal(server.room(room.roomId).members().length, 1);
  await assert.rejects(imposter.join(), /another public key/);
  assert.equal(server.room(room.roomId).members()[0]!.publicKey, identity.publicKey);
});

test("NDJSON batches are rate limited per frame", async (t) => {
  const server = new LanRelayServer({ host: "127.0.0.1", port: 0, mdns: false });
  const { port } = await server.listen();
  const ws = await socket(`ws://127.0.0.1:${port}/ws/probe`, t);
  t.after(() => server.close());
  const frames: WireFrame[] = [];
  ws.on("message", (d) => frames.push(JSON.parse(d.toString().trim())));
  ws.send((JSON.stringify({ v: 1, type: "ctrl", method: "ping" }) + "\n").repeat(41));
  await pause(100);
  assert.equal(frames.filter((f) => f.type === "ctrl" && f.method === "pong").length, 40);
  assert.ok(frames.some((f) => f.type === "ctrl" && f.method === "error" && f.code === "rate_limit"));
});

test("relay close terminates open sockets and bind errors reject listen", async (t) => {
  const server = new LanRelayServer({ host: "127.0.0.1", port: 0, mdns: false });
  const { port } = await server.listen();
  const occupied = new LanRelayServer({ host: "127.0.0.1", port, mdns: false });
  t.after(() => occupied.close());
  await assert.rejects(occupied.listen(), /EADDRINUSE/);
  await socket(`ws://127.0.0.1:${port}/ws/probe`, t);
  await server.close();
  await server.close();
  await new LanRelayServer().close();
});
