import type { WireFrame, CollabPayload } from "./types.js";

export function encodeFrame(frame: WireFrame): string {
  return JSON.stringify(frame);
}

export function decodeFrame(line: string): WireFrame {
  const trimmed = line.trim();
  if (!trimmed) throw new Error("empty frame");
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new Error("invalid JSON frame");
  }
  if (!obj || typeof obj !== "object") throw new Error("frame must be object");
  const f = obj as Record<string, unknown>;
  if (f.v !== 1) throw new Error(`unsupported protocol version: ${String(f.v)}`);
  if (f.type !== "ctrl" && f.type !== "fwd") {
    throw new Error(`unknown frame type: ${String(f.type)}`);
  }
  return obj as WireFrame;
}

export function encodePayload(payload: CollabPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodePayload(bytes: Uint8Array): CollabPayload {
  const text = new TextDecoder().decode(bytes);
  const obj = JSON.parse(text) as CollabPayload;
  if (!obj || obj.v !== 1 || !obj.kind) {
    throw new Error("invalid payload");
  }
  return obj;
}

/** Split NDJSON buffer into complete lines + remainder */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const lines = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return { lines, rest };
}
