/** Pure helpers for Durable Object room (testable in Node) */

export const RING_SIZE = 1000;
export const RATE_PER_SEC = 20;
export const ROOM_RATE_PER_SEC = 200;

export interface FwdFrame {
  v: 1;
  type: "fwd";
  roomId: string;
  from: string;
  seq: number;
  ciphertext: string;
  nonce: string;
}

export interface PeerInfo {
  agentId: string;
  publicKey: string;
  capabilities?: string[];
}

export function checkRate(
  stamps: number[],
  now: number,
  limit: number,
): { ok: boolean; next: number[] } {
  const recent = stamps.filter((t) => now - t < 1000);
  if (recent.length >= limit) return { ok: false, next: recent };
  recent.push(now);
  return { ok: true, next: recent };
}

export function pushRing(ring: FwdFrame[], frame: FwdFrame, max = RING_SIZE): FwdFrame[] {
  const next = ring.concat(frame);
  if (next.length > max) return next.slice(next.length - max);
  return next;
}

export function framesSince(ring: FwdFrame[], sinceSeq: number): FwdFrame[] {
  return ring.filter((f) => f.seq > sinceSeq);
}

export function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function asAB(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

export function randomChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64uEncode(bytes);
}

export async function verifyEd25519(
  publicKeyB64: string,
  challengeB64: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      asAB(b64uDecode(publicKeyB64)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const challenge = b64uDecode(challengeB64);
    const prefix = new TextEncoder().encode("collab-v1-join:");
    const msg = new Uint8Array(prefix.length + challenge.length);
    msg.set(prefix, 0);
    msg.set(challenge, prefix.length);
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      asAB(b64uDecode(signatureB64)),
      asAB(msg),
    );
  } catch {
    return false;
  }
}
