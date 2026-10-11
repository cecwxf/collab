#!/usr/bin/env node
import { WebSocket as Ws } from "ws";
globalThis.WebSocket = Ws;

import { generateIdentity, createRoomInvite, inviteWsUrl, parseInviteUri } from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";

const HOST = process.env.RELAY_HOST || "62.234.113.56:80";
const room = createRoomInvite({ mode: "lan", lanHostPort: HOST, name: "vps-smoke" });
const parsed = parseInviteUri(room.uri);
const wsUrl = inviteWsUrl(parsed);
console.log("invite", room.uri);
console.log("ws", wsUrl);

const idA = await generateIdentity("vps-smoke-a");
const idB = await generateIdentity("vps-smoke-b");

const a = new CollabClient({
  identity: idA,
  roomId: room.roomId,
  roomKey: room.roomKey,
  transport: new WsTransport(wsUrl),
});
const b = new CollabClient({
  identity: idB,
  roomId: room.roomId,
  roomKey: room.roomKey,
  transport: new WsTransport(wsUrl),
});

const inbox = [];
b.onPayload((p) => inbox.push(p));

await a.join();
await b.join();
console.log("peers A", a.getPeers().map((p) => p.agentId));
console.log("peers B", b.getPeers().map((p) => p.agentId));

await a.sendChat("hello from VPS smoke", ["vps-smoke-b"]);
await new Promise((r) => setTimeout(r, 800));

const chats = inbox.filter((p) => p.kind === "chat");
console.log("inbox chats", chats.map((c) => c.text));
if (chats.length < 1 || chats[0].text !== "hello from VPS smoke") {
  console.error("FAIL", inbox);
  process.exit(1);
}
await a.dispose();
await b.dispose();
console.log("VPS_SMOKE_PASS");
