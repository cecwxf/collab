import { randomUUID } from "node:crypto";
import type { ApprovalAction } from "@collab/protocol";

export interface PendingApproval {
  requestId: string;
  roomId: string;
  action: ApprovalAction;
  summary: string;
  detail?: string;
  /** Who triggered it (peer agentId or "local"). */
  from: string;
  createdAt: number;
  /** Promise settle hooks. */
  resolve: (decision: "allow" | "deny") => void;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* */
      }
    }
  }

  list(): Omit<PendingApproval, "resolve">[] {
    return [...this.pending.values()].map(({ resolve: _r, ...rest }) => rest);
  }

  /** Ask for approval; resolves with allow|deny. Auto-denies after timeoutMs. */
  request(opts: {
    roomId: string;
    action: ApprovalAction;
    summary: string;
    detail?: string;
    from: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<"allow" | "deny"> {
    if (opts.signal?.aborted) return Promise.resolve("deny");
    const requestId = randomUUID();
    return new Promise<"allow" | "deny">((resolve) => {
      const entry: PendingApproval = {
        requestId,
        roomId: opts.roomId,
        action: opts.action,
        summary: opts.summary,
        detail: opts.detail,
        from: opts.from,
        createdAt: Date.now(),
        resolve: (d) => {
          if (!this.pending.has(requestId)) return;
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", abort);
          this.pending.delete(requestId);
          this.emit();
          resolve(d);
        },
      };
      const abort = () => entry.resolve("deny");
      const timer = setTimeout(() => {
        entry.resolve("deny");
      }, opts.timeoutMs ?? 120_000);
      (timer as { unref?: () => void }).unref?.();
      this.pending.set(requestId, entry);
      opts.signal?.addEventListener("abort", abort, { once: true });
      this.emit();
    });
  }

  decide(requestId: string, decision: "allow" | "deny"): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    p.resolve(decision);
    return true;
  }
}
