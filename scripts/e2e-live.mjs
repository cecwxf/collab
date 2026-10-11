#!/usr/bin/env node
/**
 * Live e2e against a deployed relay.
 *   COLLAB_RELAY=ws://62.234.113.56:80 node scripts/e2e-live.mjs [idleSeconds]
 * B joins first and idles (lets the DO hibernate), then A joins, chats, @mentions B,
 * creates a task; B auto-replies (stream) + claims/updates the task; A must see all of it.
 */
import { generateIdentity } from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";

const RELAY = (process.env.COLLAB_RELAY ?? "ws://62.234.113.56:80").replace(/\/$/, "");
const IDLE = Number(process.argv[2] ?? 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

function mk(identity, room) {
  return new CollabClient({
    identity,
    roomId: room.roomId,
    roomKey: room.roomKey,
    transport: new WsTransport(`${RELAY}/ws/${encodeURIComponent(room.roomId)}`),
  });
}

async function waitUntil(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${what}`);
}

const room = CollabClient.createRoom();
log("relay", RELAY, "room", room.roomId);
const a = mk(await generateIdentity("e2e-a"), room);
const b = mk(await generateIdentity("e2e-b"), room);
const aInbox = [], bInbox = [];

b.onPayload(async (p, meta) => {
  bInbox.push(p);
  log("B <-", p.kind, JSON.stringify(p.text ?? p.title ?? p.status ?? ""), "seq", meta.seq, "wake", b.shouldWake(p));
  if (!b.shouldWake(p)) return;
  if (p.kind === "chat") {
    await b.streamReply(`s-${p.messageId}`, ["got your mention, ", "replying from B"], p.messageId);
  } else if (p.kind === "task.create") {
    await b.claimTask(p.taskId);
    await b.updateTask(p.taskId, "done", "B finished the task");
  }
});
a.onPayload((p, meta) => {
  aInbox.push(p);
  log("A <-", p.kind, JSON.stringify(p.text ?? p.note ?? ""), "seq", meta.seq);
});

await b.join();
log("B joined; idling", IDLE, "s to let the DO hibernate");
await sleep(IDLE * 1000);

await a.join();
log("A joined; peers", a.getPeers().map((p) => p.agentId));
await a.sendChat("plain broadcast hello (no mention)");
await a.sendChat("@e2e-b please reply", ["e2e-b"]);
await a.createTask("summarize the relay test", { assignee: "e2e-b" });

await waitUntil(() => bInbox.length >= 3, 10_000, "B receives 3 messages");
await waitUntil(
  () => aInbox.some((p) => p.kind === "stream.end") && aInbox.some((p) => p.kind === "task.update" && p.status === "done"),
  10_000,
  "A receives B's stream reply + task done",
);

const hist = await a.history(0);
log("history frames decrypted by A:", hist.length, hist.map((p) => p.kind).join(","));
await a.dispose();
await b.dispose();
log("E2E LIVE PASS");
process.exit(0);
