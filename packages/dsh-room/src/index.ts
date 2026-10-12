/**
 * dsh room — DeepSeek Harness plugin for Collab rooms (sidebar: DSH Room).
 * Host half: tools, the `/collab` command, the /api/collab routes the Rooms UI uses,
 * and the room bridge. Browser half: ./client (Rooms panel, see src/client/).
 */
import { CollabBridge } from "./plugin.js";
import { Config, normalizeConfig } from "./config.js";
import { collabCommand } from "./command-handler.js";
import { registerRoutes, type ConnectionLike, type WebServerLike } from "./http.js";
import type { DshCollabConfig, HostContext } from "./adapter.js";

export const name = "dsh-room";
/** Only the tool registry is required; commands/webServer/agent services are optional. */
export const inject = ["tools"];
export { PLUGIN_VERSION, CollabBridge, mockLocalRunner } from "./plugin.js";
export { Config, normalizeConfig };
export { AGENT_PRESETS } from "./local-agents.js";

export function apply(ctx: HostContext, config: DshCollabConfig) {
  const bridge = new CollabBridge(ctx, normalizeConfig(config));
  const unregister = bridge.tools().map((t) => ctx.tools.register(t));
  ctx.effect(() => () => {
    for (const u of unregister) u();
    void bridge.dispose();
  }, "dsh-room");

  // Slash command surface (dsh-commands): works in the Web UI, desktop and TUI composers.
  ctx.inject?.(["commands"], (c) => {
    c.effect(() => c.commands.register(collabCommand(bridge)), "dsh-room: /collab command");
  });
  // Rooms UI host API on the dsh web server, behind dsh's own connection fence.
  ctx.inject?.(["webServer"], (c) => {
    c.effect(() => registerRoutes(bridge, c.webServer as WebServerLike, () => c.get("connection") as ConnectionLike | undefined), "dsh-room: /api/collab routes");
  });

  bridge.start().catch((e) => bridge.log("error", `start failed: ${(e as Error).message}`));
  bridge.log("info", `loaded (relay ${bridge.config.relayUrl}, autoReply ${bridge.config.autoReply}, ${unregister.length} tools)`);
}
