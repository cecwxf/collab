#!/usr/bin/env node
/**
 * Join a room as a probe agent, optionally send one chat (with mentions) or task, and print every
 * message for N seconds.  node scripts/room-probe.mjs <invite> <seconds> [chat|task] [text] [mention,...]
 */
import { loadOrCreateIdentity, DEFAULT_RELAY_URL } from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";
const [invite, secs = "60", mode, text, mentionArg] = process.argv.slice(2);
const relay = (process.env.COLLAB_RELAY ?? DEFAULT_RELAY_URL).replace(/\/$/, "");
const { roomId, roomKeyB64 } = CollabClient.parseInvite(invite);
const id = await loadOrCreateIdentity(process.env.COLLAB_IDENTITY ?? `${process.env.HOME}/.collab-e2e/probe.identity.json`);
const c = new CollabClient({ identity: id, roomId, roomKey: roomKeyB64, transport: new WsTransport(`${relay}/ws/${roomId}`) });
const ts = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
c.onPayload((p, m) => console.log(`${ts()} <- #${m.seq} ${m.from} ${p.kind}`, JSON.stringify(p.text ?? p.title ?? (p.status ? `${p.status}: ${p.note ?? ""}` : p.taskId ?? ""))));
c.onPeers((peers, ev) => ev && console.log(`${ts()} peer ${ev.type} ${ev.agentId}`));
await c.join();
console.log(`${ts()} joined as ${id.agentId}; peers: ${c.getPeers().map((p) => p.agentId).join(", ")}`);
const mentions = mentionArg ? mentionArg.split(",") : undefined;
if (mode === "chat") { const r = await c.sendChat(text, mentions); console.log(`${ts()} -> chat #${r.seq}`, JSON.stringify(text), mentions ?? ""); }
if (mode === "task") { const r = await c.createTask(text, { assignee: mentions?.[0] }); console.log(`${ts()} -> task #${r.seq}`, JSON.stringify(text), "assignee", mentions?.[0] ?? "-"); }
await new Promise((r) => setTimeout(r, Number(secs) * 1000));
await c.dispose();
process.exit(0);
