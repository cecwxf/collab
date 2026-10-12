import type { DshCollabConfig } from "./adapter.js";
export declare function normalizeConfig(raw: unknown, dataRoot?: string): DshCollabConfig;
/**
 * Cordis accepts any Standard Schema v1 validator as `Config`
 * (cordis resolveConfig → Config["~standard"].validate). Hand-rolled so no schemastery import is needed.
 */
export declare const Config: {
    "~standard": {
        version: 1;
        vendor: string;
        validate(value: unknown): {
            value: Partial<DshCollabConfig>;
            issues?: undefined;
        } | {
            issues: {
                message: string;
            }[];
            value?: undefined;
        };
    };
};
//# sourceMappingURL=config.d.ts.map