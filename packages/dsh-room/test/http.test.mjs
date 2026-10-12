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

test('room reconnect API uses the connection fence and preserves the requested room id',async()=>{
  let allowed=false,called;
  const bridge={start:async()=>{},reconnectRoom:async id=>{called=id;return {roomId:id,status:'online'};}};
  const server=createServer(createApiHandler(bridge,()=>({requestRejection:()=>allowed?undefined:401})));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/collab/rooms/r/reconnect`;
  try {assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);assert.equal(called,undefined);allowed=true;const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{roomId:'r',status:'online'});assert.equal(called,'r');}finally{await new Promise(r=>server.close(r));}
});

test('room settings validate labels and do not forward identity or visibility changes',async()=>{
 let patch;const bridge={start:async()=>{},updateRoom:async(id,data)=>{patch=data;return {roomId:id,...data};}};
 const server=createServer(createApiHandler(bridge,()=>({requestRejection:()=>undefined})));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/collab/rooms/r/settings`;
 const post=body=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try {assert.equal((await post({name:' ',description:''})).status,400);assert.equal((await post({name:'New name',description:'',tags:['tag'],public:true,roomId:'different'})).status,200);assert.deepEqual(patch,{name:'New name',description:'',tags:['tag']});assert.equal((await post({tags:[1]})).status,400);}finally{await new Promise(r=>server.close(r));}
});

test('delete room endpoint is fenced and invokes removal only for the requested room',async()=>{
 let allowed=false,removed;const bridge={start:async()=>{},leave:async id=>{removed=id;return {ok:true,left:true};}};const server=createServer(createApiHandler(bridge,()=>({requestRejection:()=>allowed?undefined:401})));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/collab/rooms/r/delete`;const post=()=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 try {assert.equal((await post()).status,401);assert.equal(removed,undefined);allowed=true;assert.equal((await post()).status,200);assert.equal(removed,'r');}finally{await new Promise(r=>server.close(r));}
});
