import { WebSocket as Ws } from "ws";
globalThis.WebSocket = Ws as unknown as typeof WebSocket;

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity, createRoomInvite, inviteWsUrl, parseInviteUri } from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";
import { LanRelayServer } from "./server.js";

test("two clients exchange chat over LAN relay", async () => {
  const server = new LanRelayServer({ port: 0, mdns: false, host: "127.0.0.1" });
  const { port } = await server.listen();
  const inv = createRoomInvite({ mode: "lan", lanHostPort: `127.0.0.1:${port}` });
  const parsed = parseInviteUri(inv.uri);
  assert.equal(parsed.mode, "lan");
  const url = inviteWsUrl(parsed);

  const aId = await generateIdentity("lan-a");
  const bId = await generateIdentity("lan-b");
  const a = new CollabClient({ identity: aId, roomId: inv.roomId, roomKey: inv.roomKeyB64, transport: new WsTransport(url), reconnect: false });
  const b = new CollabClient({ identity: bId, roomId: inv.roomId, roomKey: inv.roomKeyB64, transport: new WsTransport(url), reconnect: false });

  const got = new Promise<string>((resolve) => {
    b.onPayload((p) => {
      if (p.kind === "chat") resolve(p.text);
    });
  });
  await b.join();
  await a.join();
  await a.publish({ kind: "chat", text: "hello-lan" });
  const text = await Promise.race([got, new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]);
  assert.equal(text, "hello-lan");
  await a.dispose();
  await b.dispose();
  await server.close();
});

test("real WebSocket automatic reconnect delivers missed mentions without duplicates", async () => {
  const server = new LanRelayServer({ port: 0, mdns: false, host: "127.0.0.1" });
  const { port } = await server.listen();
  const room = createRoomInvite({ mode: "lan", lanHostPort: `127.0.0.1:${port}` });
  const url = inviteWsUrl(parseInviteUri(room.uri));
  const aTransport = new WsTransport(url);
  const a = new CollabClient({ identity: await generateIdentity("reconnect-a"), roomId: room.roomId, roomKey: room.roomKey, transport: aTransport, reconnect: true });
  const b = new CollabClient({ identity: await generateIdentity("reconnect-b"), roomId: room.roomId, roomKey: room.roomKey, transport: new WsTransport(url) });
  const texts: string[] = [];
  a.onPayload((p) => { if (p.kind === "chat") texts.push(p.text); });
  try {
    await a.join(); await b.join();
    // First-ever incoming message arrives while offline (cursor is zero).
    const socket = (aTransport as unknown as { ws: Ws }).ws;
    socket.terminate();
    const end = Date.now() + 5000;
    while (a.isJoined() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    assert.equal(a.isJoined(), false);
    await b.sendChat("offline mention", ["reconnect-a"]);
    while (!texts.includes("offline mention") && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(texts, ["offline mention"]);
    assert.equal(a.isJoined(), true);
    await b.sendChat("online again");
    assert.deepEqual(texts, ["offline mention", "online again"]);
  } finally { await a.dispose(); await b.dispose(); await server.close(); }
});
