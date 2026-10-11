/**
 * dsh-collab — DeepSeek Harness plugin for Collab rooms.
 * Cordis plugin module shape used by dsh 0.2.x: `name`, `inject`, `Config`, `apply(ctx, config)`.
 * Loaded by the bundle patch in ../cordis.patch.yml (insert row id `collab`).
 */
import { CollabBridge } from "./plugin.js";
import { Config, normalizeConfig } from "./config.js";
import type { DshCollabConfig, HostContext } from "./adapter.js";

export const name = "dsh-collab";
/** Only the tool registry is required; agent services are looked up at wake time via ctx.get. */
export const inject = ["tools"];
export { Config, normalizeConfig, CollabBridge };
export type * from "./adapter.js";

export function apply(ctx: HostContext, config: DshCollabConfig) {
  const bridge = new CollabBridge(ctx, normalizeConfig(config));
  const unregister = bridge.tools().map((t) => ctx.tools.register(t));
  ctx.effect(() => () => {
    for (const u of unregister) u();
    void bridge.dispose();
  }, "dsh-collab");
  if (bridge.config.invite) {
    bridge.join(bridge.config.invite).catch((e) => bridge.log("error", `auto-join failed: ${(e as Error).message}`));
  }
  bridge.log("info", `loaded (relay ${bridge.config.relayUrl}, autoReply ${bridge.config.autoReply}, ${unregister.length} tools)`);
}
