#!/usr/bin/env node
/**
 * Two SDK agents through in-process mock relay.
 * Run: npm run smoke  (after npm run build)
 */
import { generateIdentity } from "@collab/protocol";
import { CollabClient, RoomHub } from "@collab/sdk";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const hub = new RoomHub();
  const room = CollabClient.createRoom();
  console.log("room", room.uri);

  const idA = await generateIdentity("smoke-a");
  const idB = await generateIdentity("smoke-b");

  const [a, b] = CollabClient.createMockPair(
    hub,
    { identity: idA, roomId: room.roomId, roomKey: room.roomKey },
    { identity: idB, roomId: room.roomId, roomKey: room.roomKey },
  );

  /** @type {import("@collab/protocol").CollabPayload[]} */
  const inbox = [];
  b.onPayload((p) => inbox.push(p));

  await a.join();
  await b.join();
  console.log("peers A", a.getPeers().map((p) => p.agentId));
  console.log("peers B", b.getPeers().map((p) => p.agentId));

  await a.sendChat("hello B", ["smoke-b"]);
  await a.createTask("run smoke check");
  await sleep(80);

  const chats = inbox.filter((p) => p.kind === "chat");
  const tasks = inbox.filter((p) => p.kind === "task.create");
  if (chats.length !== 1 || chats[0].text !== "hello B") {
    console.error("FAIL chat", chats);
    process.exit(1);
  }
  if (tasks.length !== 1) {
    console.error("FAIL task", tasks);
    process.exit(1);
  }
  if (!b.shouldWake(chats[0]) || !b.shouldWake(tasks[0])) {
    console.error("FAIL autoReply wake");
    process.exit(1);
  }

  // late history
  const hist = await b.history(0);
  if (hist.length < 2) {
    console.error("FAIL history", hist.length);
    process.exit(1);
  }

  await a.dispose();
  await b.dispose();
  console.log("smoke-two-agents PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
