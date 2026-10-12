import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
let createApiHandler;
before(async () => {
  const outfile = join(here, ".http-build", "http.js");
  await build({ entryPoints: [join(here, "../src/http.ts")], outfile, bundle: true, platform: "node", format: "esm" });
  ({ createApiHandler } = await import(outfile));
});

test("config API forwards valid peer ACLs, rejects bad grants, and reports denied MCP as forbidden", async () => {
  let saved;
  const bridge = {
    start: async () => {},
    updateMemberConfig: async (_id, patch) => { saved = patch; return patch; },
    callLocalMcp: async () => { throw new Error("peer grant deny: read for local"); },
  };
  const server = createServer(createApiHandler(bridge, () => ({ requestRejection: () => undefined })));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/collab/rooms/r`;
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const grants = { default: { read: "deny", write: "ask", exec: "deny", delete: "deny" }, byAgent: { reviewer: { read: "auto" } } };
    const result = await post("/config", { peerGrants: grants });
    assert.equal(result.status, 200);
    assert.deepEqual(saved.peerGrants, grants);
    assert.equal((await post("/config", { peerGrants: { default: { read: "anything" } } })).status, 400);
    assert.equal((await post("/mcp", { tool: "workspace_read", args: { path: "secret" } })).status, 403);
  } finally { await new Promise((r) => server.close(r)); }
});
