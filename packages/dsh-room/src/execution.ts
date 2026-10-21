import type { ExecutionStatusPayload } from '@collab/protocol';
import type { RunInfo, RunPhase } from './orchestrator.js';

export const EXECUTION_TTL = 45_000;
/** Deliberate allowlist: never publish summary, errors, prompts, or assistant text. */
export function publicRuns(runs: RunInfo[]): ExecutionStatusPayload['runs'] {
  return runs.map(({ id, state, phase, enqueuedAt, startedAt, endedAt }) => ({ id, state, phase, enqueuedAt, startedAt, endedAt }));
}

export function assistantPhase(frame: { type?: string; chunk?: { type?: string } }): RunPhase | undefined {
  if (frame.type === 'start' || frame.type === 'end') return 'working';
  if (frame.type !== 'chunk') return;
  switch (frame.chunk?.type) {
    case 'reasoning-delta': return 'thinking';
    case 'text-delta': return 'streaming';
    case 'tool-call-delta': return 'tool';
  }
}

/** Sender-bound snapshots, ordered by relay sequence; expire missed terminal updates. */
export class RemoteExecutions {
  private peers = new Map<string, { seq: number; ts: number; runs: RunInfo[] }>();
  private streams = new Map<string, { ts: number; run: RunInfo }>();
  constructor(private roomId: string) {}
  receive(from: string, p: ExecutionStatusPayload, seq: number, now = Date.now()) {
    if (now - p.ts > EXECUTION_TTL || p.ts > now + EXECUTION_TTL) return;
    const prev = this.peers.get(from);
    if (prev && seq <= prev.seq) return;
    const runs = publicRuns(p.runs as RunInfo[]).map(r => ({ ...r, roomId: this.roomId, agentId: from, remote: true, threadId: '', reason: 'remote', summary: '' }));
    this.peers.set(from, { seq, ts: p.ts, runs });
    this.streams.delete(from);
  }
  stream(from: string, streamId: string, phase: 'thinking' | 'streaming', ts: number) {
    if (Date.now() - ts > EXECUTION_TTL) return;
    this.streams.set(from, { ts, run: { id: `stream:${from}:${streamId}`, roomId: this.roomId, agentId: from, remote: true, state: 'running', phase, enqueuedAt: ts, threadId: '', reason: 'stream', summary: '' } });
  }
  endStream(from: string) { this.streams.delete(from); }
  remove(from: string) { this.peers.delete(from); this.streams.delete(from); }
  list(now = Date.now()): RunInfo[] {
    const result: RunInfo[] = [];
    for (const [from, p] of this.peers) {
      if (now - p.ts > EXECUTION_TTL) { this.peers.delete(from); continue; }
      result.push(...p.runs);
    }
    for (const [from, s] of this.streams) {
      if (now - s.ts > EXECUTION_TTL) { this.streams.delete(from); continue; }
      if (!result.some(r => r.agentId === from && ['running', 'queued', 'approval'].includes(r.state))) result.push(s.run);
    }
    return result;
  }
}
