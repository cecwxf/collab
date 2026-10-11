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
