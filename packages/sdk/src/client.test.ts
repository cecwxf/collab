import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity, encodePayload, encrypt } from "@collab/protocol";
import { CollabClient, RoomHub } from "./client.js";

describe("CollabClient mock relay", () => {
  it("rejoining replays messages missed offline once through onPayload", async () => {
    const hub = new RoomHub();
    const room = CollabClient.createRoom();
    const ta = CollabClient.mockTransport(hub);
    const a = new CollabClient({ identity: await generateIdentity("a"), roomId: room.roomId, roomKey: room.roomKey, transport: ta });
    const b = new CollabClient({ identity: await generateIdentity("b"), roomId: room.roomId, roomKey: room.roomKey, transport: CollabClient.mockTransport(hub) });
    const received: string[] = [];
    a.onPayload((p) => { if (p.kind === "chat") received.push(p.text); });
    try {
      await a.join(); await b.join();
      await b.sendChat("before disconnect");
      await sleep(10);
      ta.close();
      await b.sendChat("missed task mention", ["a"]);
      await a.join();
      await a.join();
      assert.deepEqual(received, ["before disconnect", "missed task mention"]);
    } finally { await a.dispose(); await b.dispose(); }
  });

  it("rejects encrypted payloads whose sender differs from the authenticated frame sender", async () => {
    const hub = new RoomHub();
    const room = CollabClient.createRoom();
    const transport = CollabClient.mockTransport(hub);
    const a = new CollabClient({ identity: await generateIdentity("a"), roomId: room.roomId, roomKey: room.roomKey, transport });
    const received: string[] = [];
    a.onPayload((p) => received.push(p.sender));
    try {
      await a.join();
      const full = { v: 1 as const, kind: "chat" as const, messageId: "spoof", ts: 1, sender: "host", text: "spoofed" };
      const sealed = await encrypt(room.roomKey, encodePayload(full), new TextEncoder().encode(`${room.roomId}:peer`));
      transport.deliver({ v: 1, type: "fwd", roomId: room.roomId, from: "peer", seq: 1, ...sealed });
      await sleep(10);
      assert.deepEqual(received, []);
      assert.deepEqual(await a.history(), []);
    } finally { await a.dispose(); }
  });
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

it('keeps a peer update received immediately after joined before the join promise resumes',async()=>{
  const hub=new RoomHub(),room=CollabClient.createRoom(),identity=await generateIdentity('batch-owner'),newcomer=await generateIdentity('batch-peer');
  const transport=CollabClient.mockTransport(hub),onFrame=transport.onFrame.bind(transport);
  transport.onFrame=handler=>onFrame(frame=>{
    handler(frame);
    if(frame.type==='ctrl'&&frame.method==='joined')handler({v:1,type:'ctrl',method:'peer_update',roomId:room.roomId,peers:[...frame.peers,{...frame.peers[0]!,agentId:newcomer.agentId,publicKey:newcomer.publicKey}],event:'joined',agentId:newcomer.agentId});
  });
  const client=new CollabClient({identity,roomId:room.roomId,roomKey:room.roomKey,transport});
  try {await client.join();assert.ok(client.getPeers().some(p=>p.agentId===newcomer.agentId),'join must not overwrite newer presence with its older response snapshot');}finally{await client.dispose();}
});
