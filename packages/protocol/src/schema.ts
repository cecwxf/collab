import type { CollabPayload, WireFrame, FwdFrame, CtrlFrame } from "./types.js";

export function isFwdFrame(f: WireFrame): f is FwdFrame {
  return f.type === "fwd";
}

export function isCtrlFrame(f: WireFrame): f is CtrlFrame | import("./types.js").CtrlServerFrame {
  return f.type === "ctrl";
}

const PAYLOAD_KINDS = new Set([
  "chat",
  "status",
  "stream.delta",
  "stream.end",
  "task.create",
  "task.claim",
  "task.update",
  "presence",
  "hello",
]);

export function assertPayload(p: unknown): CollabPayload {
  if (!p || typeof p !== "object") throw new Error("payload not object");
  const o = p as Record<string, unknown>;
  if (o.v !== 1) throw new Error("bad payload version");
  if (typeof o.kind !== "string" || !PAYLOAD_KINDS.has(o.kind)) {
    throw new Error(`bad payload kind: ${String(o.kind)}`);
  }
  if (typeof o.messageId !== "string" || typeof o.sender !== "string") {
    throw new Error("payload missing messageId/sender");
  }
  if (typeof o.ts !== "number") throw new Error("payload missing ts");
  return p as CollabPayload;
}

export function shouldAutoReply(
  mode: "off" | "mention" | "mention-or-task",
  payload: CollabPayload,
  selfId: string,
): boolean {
  if (mode === "off") return false;
  if (payload.sender === selfId) return false;
  if (payload.kind === "chat") {
    const mentions = (payload as { mentions?: string[] }).mentions ?? [];
    return mentions.includes(selfId);
  }
  if (mode === "mention-or-task" && payload.kind === "task.create") {
    const t = payload as { assignee?: string };
    return !t.assignee || t.assignee === selfId;
  }
  return false;
}
