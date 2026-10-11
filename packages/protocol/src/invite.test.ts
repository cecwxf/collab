import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoomInvite, parseInviteUri, inviteWsUrl } from "./invite.js";
import { DEFAULT_LAN_HOST_PORT, DEFAULT_RELAY_URL } from "./types.js";

test("default invite is LAN/VPS", () => {
  const inv = createRoomInvite({ name: "crew" });
  const p = parseInviteUri(inv.uri);
  assert.equal(inv.mode, "lan");
  assert.equal(p.mode, "lan");
  assert.equal(p.lanHostPort, DEFAULT_LAN_HOST_PORT);
  assert.equal(p.roomId, inv.roomId);
  assert.equal(p.name, "crew");
  assert.equal(inviteWsUrl(p), `ws://${DEFAULT_LAN_HOST_PORT}/ws/${encodeURIComponent(p.roomId)}`);
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
  const inv = createRoomInvite({ mode: "relay", relayHost: "collab-relay.cecwxf.workers.dev" });
  const p = parseInviteUri(inv.uri);
  assert.equal(p.mode, "relay");
  assert.equal(p.wsBase, "wss://collab-relay.cecwxf.workers.dev");
});

test("collab://join uses DEFAULT_RELAY_URL", () => {
  const inv = createRoomInvite({ mode: "relay", name: "legacy" });
  assert.match(inv.uri, /^collab:\/\/join\//);
  const p = parseInviteUri(inv.uri);
  assert.equal(p.wsBase, DEFAULT_RELAY_URL.replace(/\/+$/, ""));
});
