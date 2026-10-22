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
  "member.config",
  "execution.status",
  "approval.request",
  "approval.response",
  "mcp.call",
  "mcp.result",
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
  if (o.kind === "execution.status") {
    if (!Array.isArray(o.runs) || o.runs.length > 500) throw new Error("invalid execution runs");
    for (const r of o.runs) {
      const a = r?.activity;
      if (a !== undefined && (!a || typeof a.output !== "string" || a.output.length > 16384 ||
          !Array.isArray(a.tools) || a.tools.length > 32 || a.tools.some((t: any) =>
            !t || typeof t.id !== "string" || t.id.length > 200 || typeof t.name !== "string" || t.name.length > 120 ||
            !["running", "done", "failed", "stopped"].includes(t.state)))) throw new Error("invalid execution activity");
      if (!r || typeof r.id !== "string" || r.id.length > 200 ||
          !["approval", "queued", "running", "done", "failed", "stopped"].includes(r.state) ||
          (r.phase !== undefined && !["working", "thinking", "streaming", "tool"].includes(r.phase)) ||
          !Number.isFinite(r.enqueuedAt) ||
          (r.startedAt !== undefined && !Number.isFinite(r.startedAt)) ||
          (r.endedAt !== undefined && !Number.isFinite(r.endedAt))) throw new Error("invalid execution run");
    }
  }
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
    // "@all" wakes every member (broadcast wake)
    return mentions.includes(selfId) || mentions.includes("all");
  }
  if (mode === "mention-or-task" && payload.kind === "task.create") {
    const t = payload as { assignee?: string };
    return !t.assignee || t.assignee === selfId;
  }
  return false;
}
