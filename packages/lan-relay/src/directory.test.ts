import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdentity, signListing, createRoomInvite, DirectoryClient } from "@collab/protocol";
import { LanRelayServer } from "./server.js";

test("VPS/LAN directory publish search unlist", async () => {
  const server = new LanRelayServer({ port: 0, mdns: false, host: "127.0.0.1" });
  const { port } = await server.listen();
  const base = `ws://127.0.0.1:${port}`;
  const dir = new DirectoryClient(base);
  const owner = await generateIdentity("dir-owner");
  const other = await generateIdentity("dir-other");
  const room = createRoomInvite({ mode: "lan", lanHostPort: `127.0.0.1:${port}`, name: "probe" });
  const tag = `t${Date.now().toString(36)}`;

  const e = await dir.publish(owner, {
    roomId: room.roomId,
    name: "Directory probe",
    description: "lan directory test",
    tags: [tag, "probe"],
    invite: room.uri,
    members: 1,
  });
  assert.equal(e.roomId, room.roomId);
  assert.ok((await dir.search({ tag })).some((r) => r.roomId === room.roomId && r.invite === room.uri));
  assert.ok((await dir.search({ q: "directory probe" })).some((r) => r.roomId === room.roomId));

  const forged = await signListing(owner, { roomId: room.roomId, name: "Directory probe", tags: [tag], invite: room.uri });
  const res = await fetch(`${dir.base}/directory/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...forged, name: "Hijacked" }),
  });
  assert.equal(res.status, 401);

  await assert.rejects(
    () => dir.publish(other, { roomId: room.roomId, name: "Hijacked", invite: room.uri }),
    /403/,
  );
  await assert.rejects(() => dir.unlist(other, room.roomId), /403/);

  await dir.unlist(owner, room.roomId);
  assert.equal((await dir.search({ tag })).length, 0);

  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.directory, true);

  await server.close();
});
