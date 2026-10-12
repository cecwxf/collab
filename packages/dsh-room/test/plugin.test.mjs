import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as plugin from "../dist/index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("dsh-room plugin module (dsh 0.2 shape)", () => {
  it("exports name/inject/Config/apply", () => {
    assert.equal(plugin.name, "dsh-room");
    assert.deepEqual(plugin.inject, ["tools"]);
    assert.equal(typeof plugin.apply, "function");
    assert.equal(plugin.Config["~standard"].version, 1);
  });

  it("Config (Standard Schema) applies defaults and rejects bad values", () => {
    const ok = plugin.Config["~standard"].validate({});
    assert.equal(ok.value.relayUrl, "ws://62.234.113.56:80");
    assert.equal(ok.value.autoReply, "mention-or-task");
    assert.equal(ok.value.permissionPreset, "read-only");
    assert.equal(ok.value.wakeOnReplies, false);
    assert.equal(ok.value.maxWakesPerMinute, 6);
    assert.ok(plugin.Config["~standard"].validate({ autoReply: "always" }).issues);
    assert.ok(plugin.Config["~standard"].validate({ relayUrl: "http://x" }).issues);
  });

  it("registers 12 tools with JSON-schema params + output contract, and unregisters on dispose", async () => {
    const ctx = fakeCtx();
    const dir = await mkdtemp(join(tmpdir(), "collab-plugin-"));
    plugin.apply(ctx, plugin.normalizeConfig({ statePath: join(dir, "state.json"), identityPath: join(dir, "identity.json"), workspacePath: join(dir, "workspace") }));
    const names = [...ctx._tools.keys()].sort();
    assert.deepEqual(names, ["collab_broadcast_status", "collab_claim_task", "collab_create_room", "collab_create_task", "collab_history", "collab_join", "collab_lock_files", "collab_peers", "collab_rooms", "collab_search_rooms", "collab_send", "collab_update_task"]);
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

describe("Web and Desktop storage ownership", () => {
  it("defers default paths until profile context exists and retains explicit legacy paths", () => {
    const validated=plugin.Config['~standard'].validate({});
    assert.ok(!validated.issues);assert.equal(validated.value.identityPath,undefined);
    const desktop=plugin.normalizeConfig(validated.value,'/test/profiles/desktop/.collab');
    assert.equal(desktop.identityPath,'/test/profiles/desktop/.collab/identity.json');
    assert.equal(desktop.statePath,'/test/profiles/desktop/.collab/state.json');
    const web=plugin.normalizeConfig(validated.value);assert.notEqual(web.identityPath,desktop.identityPath);
    const explicit=plugin.Config['~standard'].validate({identityPath:web.identityPath,statePath:web.statePath});
    const custom=plugin.normalizeConfig(explicit.value,'/test/profiles/desktop/.collab');
    assert.equal(custom.identityPath,web.identityPath);assert.equal(custom.statePath,web.statePath);
  });
  it("uses Desktop profile context in the mounted plugin, with a distinct identity/state", async () => {
    const dir=await mkdtemp(join(tmpdir(),'desktop-profile-'));
    const ctx=fakeCtx({profileContext:{name:'desktop',dir}});
    plugin.apply(ctx,plugin.Config['~standard'].validate({}).value);
    const rooms=ctx._tools.get('collab_rooms');
    for(let i=0;i<100;i++){if((await rooms.execute({},{})).self)break;await new Promise(r=>setTimeout(r,20));}
    const {readFile}=await import('node:fs/promises');
    const statePath=join(dir,'.collab/state.json');
    for(let i=0;i<100;i++){try{await readFile(statePath);break;}catch{await new Promise(r=>setTimeout(r,20));}}
    assert.ok(JSON.parse(await readFile(join(dir,'.collab/identity.json'),'utf8')).agentId);
    assert.equal(JSON.parse(await readFile(statePath,'utf8')).version,3);
    for(const cleanup of ctx._effects)cleanup();
  });
});
