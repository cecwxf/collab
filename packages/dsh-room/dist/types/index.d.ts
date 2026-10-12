import { Config, normalizeConfig } from "./config.js";
import type { DshCollabConfig, HostContext } from "./adapter.js";
export declare const name = "dsh-room";
/** Only the tool registry is required; commands/webServer/agent services are optional. */
export declare const inject: string[];
export { PLUGIN_VERSION, CollabBridge, mockLocalRunner } from "./plugin.js";
export { Config, normalizeConfig };
export { AGENT_PRESETS } from "./local-agents.js";
export declare function apply(ctx: HostContext, config: DshCollabConfig): void;
//# sourceMappingURL=index.d.ts.map