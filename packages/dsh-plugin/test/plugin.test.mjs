import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as plugin from "../dist/index.js";

function fakeCtx(services = {}) {
  const tools = new Map(); const effects = []; const logs = [];
  return {
    tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } },
    logger: { info: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) },
    effect(fn) { effects.push(fn()); },
    get: (n) => services[n],
    _tools: tools, _effects: effects, _logs: logs,
  };
}

describe("dsh-collab plugin module (dsh 0.2 shape)", () => {
  it("exports name/inject/Config/apply", () => {
    assert.equal(plugin.name, "dsh-collab");
    assert.deepEqual(plugin.inject, ["tools"]);
    assert.equal(typeof plugin.apply, "function");
    assert.equal(plugin.Config["~standard"].version, 1);
  });

  it("Config (Standard Schema) applies defaults and rejects bad values", () => {
    const ok = plugin.Config["~standard"].validate({});
    assert.equal(ok.value.relayUrl, "wss://collab-relay.cecwxf.workers.dev");
    assert.equal(ok.value.autoReply, "mention-or-task");
    assert.equal(ok.value.permissionPreset, "read-only");
    assert.equal(ok.value.wakeOnReplies, false);
    assert.equal(ok.value.maxWakesPerMinute, 6);
    assert.ok(plugin.Config["~standard"].validate({ autoReply: "always" }).issues);
    assert.ok(plugin.Config["~standard"].validate({ relayUrl: "http://x" }).issues);
  });

  it("registers 9 tools with JSON-schema params + output contract, and unregisters on dispose", async () => {
    const ctx = fakeCtx();
    plugin.apply(ctx, plugin.normalizeConfig({}));
    const names = [...ctx._tools.keys()].sort();
    assert.deepEqual(names, ["collab_broadcast_status", "collab_claim_task", "collab_create_room", "collab_create_task", "collab_history", "collab_join", "collab_peers", "collab_send", "collab_update_task"]);
    for (const t of ctx._tools.values()) {
      assert.equal(t.parameters.type, "object");
      assert.deepEqual(t.output.schema, {});
      assert.equal(typeof t.output.render, "function");
      assert.equal(typeof t.execute, "function");
    }
    await assert.rejects(ctx._tools.get("collab_send").execute({}, {}), /missing required argument "text"/);
    await assert.rejects(ctx._tools.get("collab_send").execute({ text: "hi" }, {}), /not in a collab room/);
    for (const dispose of ctx._effects) dispose();
    assert.equal(ctx._tools.size, 0);
  });
});
