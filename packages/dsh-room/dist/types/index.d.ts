/**
 * dsh room — DeepSeek Harness plugin for Collab rooms (sidebar: DSH Room).
 * Host half: tools, the `/collab` command, the /api/collab routes the Rooms UI uses,
 * and the room bridge. Browser half: ./client (Rooms panel, see src/client/).
 */
import { CollabBridge } from "./plugin.js";
import { Config, normalizeConfig } from "./config.js";
import type { DshCollabConfig, HostContext } from "./adapter.js";
export declare const name = "dsh-room";
/** Only the tool registry is required; commands/webServer/agent services are optional. */
export declare const inject: string[];
export { Config, normalizeConfig, CollabBridge };
export type * from "./adapter.js";
export declare function apply(ctx: HostContext, config: DshCollabConfig): void;
//# sourceMappingURL=index.d.ts.map