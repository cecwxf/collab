import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, randomBytes } from "./crypto.js";
import { encodePayload, decodePayload } from "./encode.js";
import {
  generateIdentity,
  signChallenge,
  verifyChallenge,
  createRoomInvite,
  parseInviteUri,
  sealJoinProof,
  openJoinProof,
} from "./identity.js";
import { b64uEncode } from "./util.js";
import { shouldAutoReply } from "./schema.js";
import { encodeFrame, HIBERNATION_PING_LINE, HIBERNATION_PONG_LINE } from "./encode.js";
import type { ChatPayload, TaskCreatePayload } from "./types.js";

describe("AES-GCM room crypto", () => {
  it("roundtrips plaintext", async () => {
    const key = randomBytes(32);
    const plain = new TextEncoder().encode("hello collab");
    const { nonce, ciphertext } = await encrypt(key, plain);
    const out = await decrypt(key, nonce, ciphertext);
    assert.equal(new TextDecoder().decode(out), "hello collab");
  });

  it("fails with wrong key", async () => {
    const key = randomBytes(32);
    const { nonce, ciphertext } = await encrypt(key, new Uint8Array([1, 2, 3]));
    await assert.rejects(() => decrypt(randomBytes(32), nonce, ciphertext));
  });
});

describe("identity Ed25519", () => {
  it("signs and verifies join challenge", async () => {
    const id = await generateIdentity("agent-a");
    const challenge = b64uEncode(randomBytes(32));
    const sig = await signChallenge(id, challenge);
    assert.equal(await verifyChallenge(id.publicKey, challenge, sig), true);
    const other = await generateIdentity("agent-b");
    assert.equal(await verifyChallenge(other.publicKey, challenge, sig), false);
  });
});

describe("room invite", () => {
  it("parses uri", () => {
    const inv = createRoomInvite();
    const parsed = parseInviteUri(inv.uri);
    assert.equal(parsed.roomId, inv.roomId);
    assert.equal(parsed.roomKeyB64, inv.roomKeyB64);
    assert.equal(parsed.mode, "lan");
    assert.equal(parsed.roomKeyB64, inv.roomKeyB64);
  });

  it("join proof seals challenge with roomKey", async () => {
    const inv = createRoomInvite();
    const challenge = b64uEncode(randomBytes(16));
    const sealed = await sealJoinProof(inv.roomKey, challenge);
    assert.equal(
      await openJoinProof(inv.roomKey, sealed.nonce, sealed.ciphertext, challenge),
      true,
    );
    assert.equal(
      await openJoinProof(randomBytes(32), sealed.nonce, sealed.ciphertext, challenge),
      false,
    );
  });
});

describe("payload encode", () => {
  it("roundtrips chat", () => {
    const p: ChatPayload = {
      v: 1,
      kind: "chat",
      messageId: "m1",
      ts: 1,
      sender: "a",
      text: "hi",
      mentions: ["b"],
    };
    const back = decodePayload(encodePayload(p));
    assert.deepEqual(back, p);
  });
});

describe("shouldAutoReply", () => {
  const chat = (mentions?: string[]): ChatPayload => ({
    v: 1,
    kind: "chat",
    messageId: "m",
    ts: 1,
    sender: "a",
    text: "x",
    mentions,
  });
  const task = (assignee?: string): TaskCreatePayload => ({
    v: 1,
    kind: "task.create",
    messageId: "m",
    ts: 1,
    sender: "a",
    taskId: "t1",
    title: "do",
    assignee,
  });

  it("mention mode", () => {
    assert.equal(shouldAutoReply("mention", chat(["b"]), "b"), true);
    assert.equal(shouldAutoReply("mention", chat(["c"]), "b"), false);
    assert.equal(shouldAutoReply("mention", task(), "b"), false);
  });

  it("mention-or-task", () => {
    assert.equal(shouldAutoReply("mention-or-task", task(), "b"), true);
    assert.equal(shouldAutoReply("mention-or-task", task("c"), "b"), false);
    assert.equal(shouldAutoReply("off", chat(["b"]), "b"), false);
  });
});


describe("hibernation ping bytes", () => {
  it("encodeFrame(minimal ping)+\\n matches HIBERNATION_PING_LINE", () => {
    const line = encodeFrame({ v: 1, type: "ctrl", method: "ping" }) + "\n";
    assert.equal(line, HIBERNATION_PING_LINE);
    assert.ok(HIBERNATION_PONG_LINE.includes("pong"));
  });
});
