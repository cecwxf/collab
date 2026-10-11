import { webcrypto } from "node:crypto";

export function b64uEncode(bytes: Uint8Array): string {
  let s = Buffer.from(bytes).toString("base64");
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  webcrypto.getRandomValues(out);
  return out;
}

/** Compact time-sortable id (not full ULID spec, good enough) */
export function ulidLike(): string {
  const t = Date.now().toString(36);
  const r = b64uEncode(randomBytes(10)).slice(0, 14);
  return `${t}_${r}`;
}

export function newMessageId(): string {
  return ulidLike();
}
