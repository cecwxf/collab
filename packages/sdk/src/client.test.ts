import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity } from "@collab/protocol";
import { CollabClient, RoomHub } from "./client.js";

describe("CollabClient mock relay", () => {
  it("two agents join and chat with E2EE", async () => {
    const hub = new RoomHub();
    const room = CollabClient.createRoom();
    const idA = await generateIdentity("agent-a");
    const idB = await generateIdentity("agent-b");

    const [a, b] = CollabClient.createMockPair(
      hub,
      { identity: idA, roomId: room.roomId, roomKey: room.roomKey },
      { identity: idB, roomId: room.roomId, roomKey: room.roomKey },
    );

    const received: string[] = [];
    b.onPayload((p) => {
      if (p.kind === "chat") received.push(p.text);
    });

    await a.join();
    await b.join();

    assert.equal(a.isJoined(), true);
    assert.equal(b.isJoined(), true);
    assert.ok(a.getPeers().some((p) => p.agentId === "agent-b"));
    assert.ok(b.getPeers().some((p) => p.agentId === "agent-a"));

    await a.sendChat("hello from A", ["agent-b"]);
    await sleep(50);

    assert.deepEqual(received, ["hello from A"]);
    assert.equal(b.shouldWake({
      v: 1,
      kind: "chat",
      messageId: "x",
      ts: 1,
      sender: "agent-a",
      text: "hello from A",
      mentions: ["agent-b"],
    }), true);

    await a.dispose();
    await b.dispose();
  });

  it("wrong room key joins fanout but cannot decrypt", async () => {
    const hub = new RoomHub();
    const room = CollabClient.createRoom();
    const idA = await generateIdentity("a1");
    const idB = await generateIdentity("b1");
    const wrongKey = new Uint8Array(32);
    wrongKey.fill(7);

    const ta = CollabClient.mockTransport(hub, "a");
    const tb = CollabClient.mockTransport(hub, "b");
    const a = new CollabClient({
      identity: idA,
      roomId: room.roomId,
      roomKey: room.roomKey,
      transport: ta,
    });
    const b = new CollabClient({
      identity: idB,
      roomId: room.roomId,
      roomKey: wrongKey,
      transport: tb,
    });

    const received: string[] = [];
    b.onPayload((p) => {
      if (p.kind === "chat") received.push(p.text);
    });

    await a.join();
    await b.join();
    await a.sendChat("secret");
    await sleep(50);
    assert.deepEqual(received, []); // cannot decrypt
    await a.dispose();
    await b.dispose();
  });

  it("task create wakes mention-or-task", async () => {
    const hub = new RoomHub();
    const room = CollabClient.createRoom();
    const idA = await generateIdentity("ta");
    const idB = await generateIdentity("tb");
    const [a, b] = CollabClient.createMockPair(
      hub,
      { identity: idA, roomId: room.roomId, roomKey: room.roomKey },
      { identity: idB, roomId: room.roomId, roomKey: room.roomKey },
    );
    const tasks: string[] = [];
    b.onPayload((p) => {
      if (p.kind === "task.create") tasks.push(p.title);
    });
    await a.join();
    await b.join();
    await a.createTask("fix the smoke");
    await sleep(50);
    assert.deepEqual(tasks, ["fix the smoke"]);
    await a.dispose();
    await b.dispose();
  });

  it("poll returns history for late joiner via ring", async () => {
    const hub = new RoomHub();
    const room = CollabClient.createRoom();
    const idA = await generateIdentity("ha");
    const idB = await generateIdentity("hb");
    const ta = CollabClient.mockTransport(hub);
    const a = new CollabClient({
      identity: idA,
      roomId: room.roomId,
      roomKey: room.roomKey,
      transport: ta,
    });
    await a.join();
    await a.sendStatus("early status");
    await sleep(30);

    const tb = CollabClient.mockTransport(hub);
    const b = new CollabClient({
      identity: idB,
      roomId: room.roomId,
      roomKey: room.roomKey,
      transport: tb,
    });
    await b.join();
    const hist = await b.history(0);
    assert.ok(hist.some((p) => p.kind === "status" && p.text === "early status"));
    await a.dispose();
    await b.dispose();
  });
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
