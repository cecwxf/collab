// One SDK client on this machine and one on the VPS; fresh private room, no model calls.
// The remote peer must be uploaded first. SSH auth is external to this script.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { generateIdentity, DirectoryClient, signListing } from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";

const relay = process.env.COLLAB_RELAY ?? "ws://62.234.113.56:80";
const remoteRelay = process.env.COLLAB_REMOTE_RELAY ?? "ws://127.0.0.1:80";
const remotePath = process.env.COLLAB_REMOTE_PEER;
if (!remotePath) throw new Error("COLLAB_REMOTE_PEER is required (path to uploaded bundled vps-peer.mjs)");
const endpoint = new URL(relay);
const room = CollabClient.createRoom({ mode: "lan", lanHostPort: `${endpoint.hostname}:${endpoint.port || (endpoint.protocol === "wss:" ? "443" : "80")}` });
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const sshArgs = ["-o", "BatchMode=yes"];
if (process.env.COLLAB_SSH_CONTROL) sshArgs.push("-S", process.env.COLLAB_SSH_CONTROL);
sshArgs.push(process.env.COLLAB_SSH_HOST ?? "ubuntu@62.234.113.56", `node ${quote(remotePath)}`);
const child = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "pipe"] });
const remoteEvents = [];
let output = "", remoteError = "";
child.stdout.on("data", (data) => {
  output += data.toString();
  let i;
  while ((i = output.indexOf("\n")) >= 0) {
    const line = output.slice(0, i); output = output.slice(i + 1);
    if (line) remoteEvents.push(JSON.parse(line));
  }
});
child.stderr.on("data", (data) => { remoteError = (remoteError + data).slice(-1000); });
child.stdin.on("error", () => {});
child.on("error", (e) => remoteEvents.push({ kind: "error", message: e.message }));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const error = remoteEvents.find((e) => e.kind === "error");
    if (error) throw new Error(error.message);
    if (child.exitCode !== null) throw new Error(`remote peer exited (${child.exitCode}): ${remoteError}`);
    if (await fn()) return;
    await pause(30);
  }
  throw new Error(`timeout: ${label}`);
}
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const identity = await generateIdentity(`mac-probe-${tag}`);
const remoteId = `vps-probe-${tag}`;
const local = new CollabClient({ identity, roomId: room.roomId, roomKey: room.roomKey, transport: new WsTransport(`${relay}/ws/${room.roomId}`) });
const received = [];
local.onPayload((p, meta) => received.push({ ...p, from: meta.from }));
const directory = new DirectoryClient(relay);
let listed = false;
try {
  child.stdin.write(JSON.stringify({ roomId: room.roomId, roomKey: room.roomKeyB64, agentId: remoteId, url: `${remoteRelay}/ws/${room.roomId}` }) + "\n");
  await until(() => remoteEvents.some((e) => e.kind === "ready"), "remote client ready");
  const ready = remoteEvents.find((e) => e.kind === "ready");
  console.log(`Remote client: ${ready.host}, Node ${ready.node}; local Node ${process.version}`);
  await local.join();
  assert.ok(local.getPeers().some((p) => p.agentId === remoteId));
  const chat = await local.sendChat("cross-machine mention", [remoteId]);
  await until(() => received.some((p) => p.kind === "stream.end" && p.replyTo === chat.messageId), "streamed reply");
  await local.createTask("Cross-machine task claim and completion", { assignee: remoteId });
  await until(() => received.some((p) => p.kind === "task.update" && p.status === "done"), "task done");
  assert.ok(received.some((p) => p.kind === "task.claim" && p.from === remoteId));
  child.stdin.write('{"kind":"disconnect"}\n');
  await until(() => remoteEvents.some((e) => e.kind === "status" && e.status === "disconnected"), "remote disconnected");
  const missed = await local.sendChat("mention while remote client is offline", [remoteId]);
  await until(() => received.some((p) => p.kind === "stream.end" && p.replyTo === missed.messageId), "reconnect catch-up reply");
  assert.equal(received.filter((p) => p.kind === "stream.end" && p.replyTo === missed.messageId).length, 1);
  const history = await local.history(0);
  assert.ok(history.some((p) => p.kind === "task.update" && p.status === "done"));
  assert.ok(history.some((p) => p.kind === "chat" && p.messageId === missed.messageId));
  await directory.publish(identity, { roomId: room.roomId, name: "Temporary cross-machine validation", tags: [tag], invite: room.uri, members: 2 });
  listed = true;
  assert.ok((await directory.search({ tag })).some((r) => r.roomId === room.roomId));
  const signed = await signListing(identity, { roomId: room.roomId, name: "Temporary cross-machine validation", tags: [tag], invite: room.uri });
  const forged = await fetch(`${directory.base}/directory/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...signed, name: "Changed without signing" }) });
  assert.equal(forged.status, 401);
  await directory.unlist(identity, room.roomId);
  listed = false;
  assert.equal((await directory.search({ tag })).length, 0);
  console.log("CROSS-MACHINE PASS: encrypted mention/stream, task claim/done, forced disconnect/catch-up once, history, signed directory/forgery rejection/cleanup");
} finally {
  if (listed) await directory.unlist(identity, room.roomId).catch(() => {});
  await local.dispose();
  if (child.exitCode === null && child.signalCode === null) {
    child.stdin.write('{"kind":"stop"}\n');
    await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
