const active = new Set(['approval', 'queued', 'running']);
export function executionRows(room) {
  const runs = room.runs || [];
  const members = new Map((room.members || []).filter(m => !m.self || runs.some(r => r.agentId === m.agentId)).map(m => [m.agentId, m]));
  for (const a of room.local?.agents || []) members.set(a.agentId, { ...members.get(a.agentId), ...a });
  for (const r of runs) if (!members.has(r.agentId)) members.set(r.agentId, { agentId: r.agentId });
  return [...members.values()].map(m => {
    const own = runs.filter(r => r.agentId === m.agentId);
    const running = own.find(r => r.state === 'running');
    const waiting = own.filter(r => r.state === 'queued');
    const current = running || own.find(r => active.has(r.state)) || own.at(-1);
    const state = current?.state || (m.online === false ? 'offline' : 'idle');
    const phase = running?.phase;
    const label = state === 'running' ? `running · ${phase === 'thinking' ? 'thinking / 推理中' : phase === 'streaming' ? 'streaming / 输出中' : phase === 'tool' ? 'tool / 工具执行' : 'working / 执行中'}` : state;
    return { agentId: m.agentId, name: m.name || m.agentId, state, label: label + (running && waiting.length ? ` · ${waiting.length} queued` : ''), remote: !!current?.remote };
  });
}
