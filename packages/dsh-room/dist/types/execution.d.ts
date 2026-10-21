import type { ExecutionStatusPayload } from '@collab/protocol';
import type { RunInfo, RunPhase } from './orchestrator.js';
export declare const EXECUTION_TTL = 45000;
/** Deliberate allowlist: never publish summary, errors, prompts, or assistant text. */
export declare function publicRuns(runs: RunInfo[]): ExecutionStatusPayload['runs'];
export declare function assistantPhase(frame: {
    type?: string;
    chunk?: {
        type?: string;
    };
}): RunPhase | undefined;
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