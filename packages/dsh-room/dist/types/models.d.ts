/** Model ids come from dsh's provider catalog; labels retain the exact provider name/version. */
export interface ModelChoice {
    provider: string;
    model: string;
    name: string;
}
export interface ModelSelection {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}
export declare function resolveSelection(defaults: ModelSelection, room?: ModelSelection, agent?: ModelSelection): ModelSelection;
export declare function describeModel(selection: ModelSelection, catalog: ModelChoice[]): ModelChoice | null;
//# sourceMappingURL=models.d.ts.map