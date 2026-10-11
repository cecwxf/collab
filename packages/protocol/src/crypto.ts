import { webcrypto } from "node:crypto";
import { b64uEncode, b64uDecode, randomBytes } from "./util.js";

const subtle = webcrypto.subtle;

function asBufferSource(u8: Uint8Array): BufferSource {
  // Ensure ArrayBuffer (not SharedArrayBuffer) for DOM lib typings
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy;
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("roomKey must be 32 bytes");
  return subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(
  roomKey: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<{ nonce: string; ciphertext: string }> {
  const key = await importAesKey(roomKey);
  const nonce = randomBytes(12);
  const params: AesGcmParams = { name: "AES-GCM", iv: asBufferSource(nonce) };
  if (aad) params.additionalData = asBufferSource(aad);
  const ct = new Uint8Array(
    await subtle.encrypt(params, key, asBufferSource(plaintext)),
  );
  return { nonce: b64uEncode(nonce), ciphertext: b64uEncode(ct) };
}

export async function decrypt(
  roomKey: Uint8Array,
  nonceB64: string,
  ciphertextB64: string,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(roomKey);
  const nonce = b64uDecode(nonceB64);
  const ct = b64uDecode(ciphertextB64);
  const params: AesGcmParams = { name: "AES-GCM", iv: asBufferSource(nonce) };
  if (aad) params.additionalData = asBufferSource(aad);
  return new Uint8Array(await subtle.decrypt(params, key, asBufferSource(ct)));
}

export { b64uEncode, b64uDecode, randomBytes };
