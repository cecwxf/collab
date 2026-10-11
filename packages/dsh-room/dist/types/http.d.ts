/**
 * Host API for the Rooms UI (same pattern as DeepSeekBot's /api/botharness/*):
 * same-origin JSON routes + one SSE stream on dsh's web server, every request
 * admitted through dsh's own connection fence (trusted host + browser auth cookie).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CollabBridge } from "./plugin.js";
export declare const API = "/api/collab";
export interface WebServerLike {
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
export interface ConnectionLike {
    requestRejection(req: IncomingMessage): number | undefined;
}
/** Pure router so tests can drive it without a dsh web server. */
export declare function createApiHandler(bridge: CollabBridge, connection: () => ConnectionLike | undefined): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export declare function registerRoutes(bridge: CollabBridge, webServer: WebServerLike, connection: () => ConnectionLike | undefined): () => void;
//# sourceMappingURL=http.d.ts.map