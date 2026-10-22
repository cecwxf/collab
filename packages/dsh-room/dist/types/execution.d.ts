import type { ExecutionStatusPayload } from '@collab/protocol';
import type { RunInfo, RunPhase } from './orchestrator.js';
export declare const EXECUTION_TTL = 45000;
/** Explicit public projection: no prompts, reasoning, tool arguments/results or raw errors. */
export declare function publicRuns(runs: RunInfo[]): ExecutionStatusPayload['runs'];
export declare function assistantPhase(frame: {
    type?: string;
    chunk?: {
        type?: string;
    };
}): RunPhase | undefined;
/** Per-run attempt bookkeeping is private and never copied into room snapshots. */
export declare class ExecutionActivityTracker {
    private attempts;
    stream(run: RunInfo, frame: {
        type?: string;
        attemptId?: string;
        outcome?: {
            kind?: string;
            eventType?: string;
        };
        chunk?: {
            type?: string;
            text?: string;
        };
    }): void;
    tool(run: RunInfo, id: string, name: string, state: 'running' | 'done' | 'failed'): void;
}
/** Sender-bound snapshots, ordered by relay sequence; expire missed terminal updates. */
export declare class RemoteExecutions {
    private roomId;
    private peers;
    private streams;
    constructor(roomId: string);
    receive(from: string, p: ExecutionStatusPayload, seq: number, now?: number): void;
    stream(from: string, streamId: string, phase: 'thinking' | 'streaming', ts: number): void;
    endStream(from: string): void;
    remove(from: string): void;
    list(now?: number): RunInfo[];
}
//# sourceMappingURL=execution.d.ts.map