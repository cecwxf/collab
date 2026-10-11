// Live check of the relay's public room directory: publish → search (text/tag) → reject forgery/hijack → unlist.
import { DirectoryClient, generateIdentity, signListing, DEFAULT_RELAY_URL } from "../packages/protocol/dist/index.js";
import { CollabClient } from "../packages/sdk/dist/index.js";

const relay = process.env.COLLAB_RELAY ?? DEFAULT_RELAY_URL;
const dir = new DirectoryClient(relay);
const owner = await generateIdentity("dir-owner");
const other = await generateIdentity("dir-other");
const room = CollabClient.createRoom();
const tag = `t${Date.now().toString(36)}`;
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } console.log("ok  ", m); };

const e = await dir.publish(owner, { roomId: room.roomId, name: "Directory probe", description: "live directory test", tags: [tag, "probe"], invite: room.uri, members: 1 });
ok(e.roomId === room.roomId && e.ownerAgentId === owner.agentId, `published ${room.roomId} (#${tag})`);
ok((await dir.search({ tag })).some((r) => r.roomId === room.roomId && r.invite === room.uri), "search by tag finds it with its invite");
ok((await dir.search({ q: "directory probe" })).some((r) => r.roomId === room.roomId), "search by name finds it");
ok(!(await dir.search({ q: "zzzz-no-such-room-" + tag })).length, "unrelated query finds nothing");
const forged = await signListing(owner, { roomId: room.roomId, name: "Directory probe", tags: [tag], invite: room.uri });
const res = await fetch(`${dir.base}/directory/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...forged, name: "Hijacked" }) });
ok(res.status === 401, `tampered listing rejected (${res.status})`);
let hijack = 0;
try { await dir.publish(other, { roomId: room.roomId, name: "Hijacked", invite: room.uri }); } catch (err) { hijack = /403/.test(err.message) ? 403 : -1; }
ok(hijack === 403, "another identity cannot overwrite the listing (403)");
let unlistOther = 0;
try { await dir.unlist(other, room.roomId); } catch (err) { unlistOther = /403/.test(err.message) ? 403 : -1; }
ok(unlistOther === 403, "another identity cannot unlist (403)");
await dir.unlist(owner, room.roomId);
ok(!(await dir.search({ tag })).length, "owner unlist removes it");
console.log("directory live test passed against", dir.base);
