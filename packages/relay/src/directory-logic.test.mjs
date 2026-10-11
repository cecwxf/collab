import { test } from "node:test";
import assert from "node:assert/strict";
import { searchEntries, validateListing, listingMessage, unlistMessage, isLive, DIRECTORY_TTL_MS } from "../dist/directory-logic.js";

test("validateListing accepts a well-formed public listing", () => {
  const now = Date.now();
  const body = {
    roomId: "room1", name: "Alpha", description: "desc", tags: ["demo"],
    invite: "collab://join/room1#key", members: 1, agentId: "a", publicKey: "pk", ts: now, sig: "sig",
  };
  assert.equal(validateListing(body, now), null);
});

test("validateListing rejects invite/roomId mismatch", () => {
  const now = Date.now();
  assert.match(validateListing({
    roomId: "a", name: "n", description: "", tags: [], invite: "collab://join/b#k", members: 0,
    agentId: "x", publicKey: "pk", ts: now, sig: "s",
  }, now) || "", /invite/);
});

test("searchEntries ranks name hits and filters dead rooms", () => {
  const now = Date.now();
  const live = { roomId: "1", name: "Release Crew", description: "ship", tags: ["demo"], invite: "i", members: 1, ownerAgentId: "o", ownerKey: "k", createdAt: now, lastSeen: now };
  const dead = { ...live, roomId: "2", name: "Old", lastSeen: now - DIRECTORY_TTL_MS - 1 };
  const hits = searchEntries([live, dead], { q: "release" }, now);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].roomId, "1");
  assert.ok(!("ownerKey" in hits[0]));
});

test("canonical messages stay stable", () => {
  assert.match(listingMessage({ roomId: "r", name: "n", description: "", tags: [], invite: "i", members: 0, agentId: "a", publicKey: "p", ts: 1 }), /^collab-v1-dir:/);
  assert.match(unlistMessage("r", "p", 1), /^collab-v1-dir:/);
  assert.equal(isLive({ lastSeen: Date.now() }, Date.now()), true);
});

test("validateListing accepts lan invite form", () => {
  const now = Date.now();
  assert.equal(validateListing({
    roomId: "room1", name: "Alpha", description: "", tags: [],
    invite: "collab://lan/62.234.113.56:80/room1#key", members: 1, agentId: "a", publicKey: "pk", ts: now, sig: "sig",
  }, now), null);
});
