// src/approval-queue.ts
import { randomUUID } from "node:crypto";
var ApprovalQueue = class {
  pending = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
      }
    }
  }
  list() {
    return [...this.pending.values()].map(({ resolve: _r, ...rest }) => rest);
  }
  /** Ask for approval; resolves with allow|deny. Auto-denies after timeoutMs. */
  request(opts) {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const entry = {
        requestId,
        roomId: opts.roomId,
        action: opts.action,
        summary: opts.summary,
        detail: opts.detail,
        from: opts.from,
        createdAt: Date.now(),
        resolve: (d) => {
          clearTimeout(timer);
          this.pending.delete(requestId);
          this.emit();
          resolve(d);
        }
      };
      this.pending.set(requestId, entry);
      this.emit();
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          this.emit();
          resolve("deny");
        }
      }, opts.timeoutMs ?? 12e4);
      timer.unref?.();
    });
  }
  decide(requestId, decision) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    p.resolve(decision);
    return true;
  }
};
export {
  ApprovalQueue
};
