import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoomInvite, parseInviteUri, inviteWsUrl } from "./invite.js";

test("default relay invite", () => {
  const inv = createRoomInvite({ name: "crew" });
  const p = parseInviteUri(inv.uri);
  assert.equal(p.mode, "relay");
  assert.equal(p.roomId, inv.roomId);
  assert.equal(p.name, "crew");
  assert.match(inviteWsUrl(p), /\/ws\//);
});

test("lan invite", () => {
  const inv = createRoomInvite({ mode: "lan", lanHostPort: "192.168.1.10:7421", name: "lan-room" });
  assert.match(inv.uri, /^collab:\/\/lan\/192\.168\.1\.10:7421\//);
  const p = parseInviteUri(inv.uri);
  assert.equal(p.mode, "lan");
  assert.equal(p.lanHostPort, "192.168.1.10:7421");
  assert.equal(inviteWsUrl(p), `ws://192.168.1.10:7421/ws/${encodeURIComponent(p.roomId)}`);
});

test("explicit relay host invite", () => {
  const inv = createRoomInvite({ relayHost: "collab-relay.cecwxf.workers.dev" });
  const p = parseInviteUri(inv.uri);
  assert.equal(p.mode, "relay");
  assert.equal(p.wsBase, "wss://collab-relay.cecwxf.workers.dev");
});
