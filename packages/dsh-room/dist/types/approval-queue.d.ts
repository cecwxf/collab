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
export declare class ApprovalQueue {
    private pending;
    private listeners;
    subscribe(fn: () => void): () => void;
    private emit;
    list(): Omit<PendingApproval, "resolve">[];
    /** Ask for approval; resolves with allow|deny. Auto-denies after timeoutMs. */
    request(opts: {
        roomId: string;
        action: ApprovalAction;
        summary: string;
        detail?: string;
        from: string;
        timeoutMs?: number;
    }): Promise<"allow" | "deny">;
    decide(requestId: string, decision: "allow" | "deny"): boolean;
}
//# sourceMappingURL=approval-queue.d.ts.map