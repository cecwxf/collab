import { webcrypto } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentId } from "./types.js";
import { b64uEncode, b64uDecode, randomBytes, ulidLike } from "./util.js";

const subtle = webcrypto.subtle;

export interface Identity {
  agentId: AgentId;
  /** PKCS8 raw for Ed25519 private key — base64url */
  privateKey: string;
  /** SPKI raw for Ed25519 public key — base64url */
  publicKey: string;
  createdAt: number;
}

function asAB(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await subtle.exportKey("pkcs8", key));
  return b64uEncode(raw);
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await subtle.exportKey("spki", key));
  return b64uEncode(raw);
}

export async function generateIdentity(agentId?: AgentId): Promise<Identity> {
  const pair = (await subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return {
    agentId: agentId ?? ulidLike(),
    privateKey: await exportPrivateKey(pair.privateKey),
    publicKey: await exportPublicKey(pair.publicKey),
    createdAt: Date.now(),
  };
}

export async function importPrivateKey(b64: string): Promise<CryptoKey> {
  return subtle.importKey("pkcs8", asAB(b64uDecode(b64)), { name: "Ed25519" }, false, [
    "sign",
  ]);
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
  return subtle.importKey("spki", asAB(b64uDecode(b64)), { name: "Ed25519" }, false, [
    "verify",
  ]);
}

export async function signChallenge(
  identity: Identity,
  challengeB64: string,
): Promise<string> {
  const key = await importPrivateKey(identity.privateKey);
  const challenge = b64uDecode(challengeB64);
  const roomPrefix = new TextEncoder().encode("collab-v1-join:");
  const msg = new Uint8Array(roomPrefix.length + challenge.length);
  msg.set(roomPrefix, 0);
  msg.set(challenge, roomPrefix.length);
  const sig = new Uint8Array(await subtle.sign({ name: "Ed25519" }, key, asAB(msg)));
  return b64uEncode(sig);
}

export async function verifyChallenge(
  publicKeyB64: string,
  challengeB64: string,
  signatureB64: string,
): Promise<boolean> {
  const key = await importPublicKey(publicKeyB64);
  const challenge = b64uDecode(challengeB64);
  const roomPrefix = new TextEncoder().encode("collab-v1-join:");
  const msg = new Uint8Array(roomPrefix.length + challenge.length);
  msg.set(roomPrefix, 0);
  msg.set(challenge, roomPrefix.length);
  return subtle.verify(
    { name: "Ed25519" },
    key,
    asAB(b64uDecode(signatureB64)),
    asAB(msg),
  );
}

export async function loadOrCreateIdentity(path: string): Promise<Identity> {
  try {
    const raw = await readFile(path, "utf8");
    const id = JSON.parse(raw) as Identity;
    if (!id.agentId || !id.privateKey || !id.publicKey) {
      throw new Error("corrupt identity");
    }
    return id;
  } catch {
    const id = await generateIdentity();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(id, null, 2), { mode: 0o600 });
    return id;
  }
}

/** Prove knowledge of roomKey by AEAD-sealing the challenge (client-side helper) */
export async function sealJoinProof(
  roomKeyBytes: Uint8Array,
  challengeB64: string,
): Promise<{ nonce: string; ciphertext: string }> {
  const { encrypt } = await import("./crypto.js");
  const plain = b64uDecode(challengeB64);
  return encrypt(roomKeyBytes, plain);
}

export async function openJoinProof(
  roomKeyBytes: Uint8Array,
  nonceB64: string,
  ciphertextB64: string,
  expectedChallengeB64: string,
): Promise<boolean> {
  const { decrypt } = await import("./crypto.js");
  try {
    const plain = await decrypt(roomKeyBytes, nonceB64, ciphertextB64);
    const expected = b64uDecode(expectedChallengeB64);
    if (plain.length !== expected.length) return false;
    let ok = 0;
    for (let i = 0; i < plain.length; i++) ok |= plain[i]! ^ expected[i]!;
    return ok === 0;
  } catch {
    return false;
  }
}

export function createRoomInvite(): {
  roomId: string;
  roomKey: Uint8Array;
  roomKeyB64: string;
  uri: string;
} {
  const roomId = ulidLike();
  const roomKey = randomBytes(32);
  const roomKeyB64 = b64uEncode(roomKey);
  const uri = `collab://join/${roomId}#${roomKeyB64}`;
  return { roomId, roomKey, roomKeyB64, uri };
}

export function parseInviteUri(uri: string): { roomId: string; roomKeyB64: string } {
  const m = /^collab:\/\/join\/([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?$/.exec(
    uri.trim(),
  );
  if (!m) throw new Error("invalid invite URI");
  if (!m[2]) throw new Error("invite URI missing room key fragment");
  return { roomId: m[1]!, roomKeyB64: m[2]! };
}
