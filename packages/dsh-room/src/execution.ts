import type { ExecutionStatusPayload } from '@collab/protocol';
import type { RunInfo, RunPhase } from './orchestrator.js';

export const EXECUTION_TTL = 45_000;
/** Explicit public projection: no prompts, reasoning, tool arguments/results or raw errors. */
export function publicRuns(runs: RunInfo[]): ExecutionStatusPayload['runs'] {
  return runs.map(({ id, state, phase, enqueuedAt, startedAt, endedAt, activity }) => ({ id, state, phase, enqueuedAt, startedAt, endedAt,
    ...(activity ? { activity: { output: activity.output.slice(0, 16384), tools: activity.tools.slice(-32).map(({ id, name, state }) => ({ id, name, state })) } } : {}),
  }));
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


/** Per-run attempt bookkeeping is private and never copied into room snapshots. */
export class ExecutionActivityTracker {
  private attempts = new WeakMap<RunInfo, { base: string; id?: string }>();
  stream(run: RunInfo, frame: { type?: string; attemptId?: string; outcome?: { kind?: string; eventType?: string }; chunk?: { type?: string; text?: string } }) {
    const phase = assistantPhase(frame);
    if (phase) run.phase = phase;
    if (frame.type === 'start') {
      this.attempts.set(run, { base: run.activity?.output ?? '', id: frame.attemptId });
      return;
    }
    const attempt = this.attempts.get(run);
    if (attempt?.id && frame.attemptId && attempt.id !== frame.attemptId) return;
    if (frame.type === 'end') {
      if (attempt && (frame.outcome?.kind === 'abandoned' || frame.outcome?.eventType === 'assistant/attempt') && run.activity) run.activity.output = attempt.base;
      this.attempts.delete(run);
      return;
    }
    if (frame.type !== 'chunk' || frame.chunk?.type !== 'text-delta' || typeof frame.chunk.text !== 'string') return;
    const activity = run.activity ??= { output: '', tools: [] };
    const prefix = attempt && activity.output === attempt.base && attempt.base ? '\n\n' : '';
    activity.output = (activity.output + prefix + frame.chunk.text).slice(0, 16384);
  }
  tool(run: RunInfo, id: string, name: string, state: 'running' | 'done' | 'failed') {
    if (typeof id !== 'string' || typeof name !== 'string') return;
    const activity = run.activity ??= { output: '', tools: [] };
    const tool = activity.tools.find(t => t.id === id);
    if (tool) tool.state = state;
    else activity.tools.push({ id: id.slice(0, 200), name: name.slice(0, 120), state });
    activity.tools = activity.tools.slice(-32);
    run.phase = state === 'running' ? 'tool' : 'working';
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
