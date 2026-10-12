/** Model ids come from dsh's provider catalog; labels retain the exact provider name/version. */
export interface ModelChoice { provider: string; model: string; name: string }
export interface ModelSelection { provider?: string; model?: string; reasoningEffort?: string }
export function resolveSelection(defaults: ModelSelection, room: ModelSelection = {}, agent: ModelSelection = {}): ModelSelection {
  return {
    provider: agent.provider || room.provider || defaults.provider,
    model: agent.model || room.model || defaults.model,
    reasoningEffort: agent.reasoningEffort || room.reasoningEffort || defaults.reasoningEffort,
  };
}
export function describeModel(selection: ModelSelection, catalog: ModelChoice[]): ModelChoice | null {
  if (!selection.provider || !selection.model) return null;
  return catalog.find((m) => m.provider === selection.provider && m.model === selection.model)
    ?? { provider: selection.provider, model: selection.model, name: selection.model };
}
