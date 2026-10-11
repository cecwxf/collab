import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkRate, pushRing, framesSince } from "../dist/room-logic.js";

describe("room-logic", () => {
  it("rate limits", () => {
    let stamps = [];
    const now = 1000;
    for (let i = 0; i < 20; i++) {
      const r = checkRate(stamps, now, 20);
      assert.equal(r.ok, true);
      stamps = r.next;
    }
    assert.equal(checkRate(stamps, now, 20).ok, false);
  });

  it("ring buffer trims", () => {
    let ring = [];
    for (let i = 1; i <= 5; i++) {
      ring = pushRing(
        ring,
        { v: 1, type: "fwd", roomId: "r", from: "a", seq: i, ciphertext: "c", nonce: "n" },
        3,
      );
    }
    assert.equal(ring.length, 3);
    assert.equal(ring[0].seq, 3);
    assert.deepEqual(framesSince(ring, 3).map((f) => f.seq), [4, 5]);
  });
});
