/** `/collab` command handler: dsh-commands surface → CollabBridge. Results render in the chat, outside model history. */
import type { CommandDefinition, CommandInvocation, CommandResult } from "./adapter.js";
import { HELP, parseCollabCommand } from "./commands.js";
import type { CollabBridge, RoomView } from "./plugin.js";

const ok = (text: string): CommandResult => ({ kind: "success", text });
const fail = (text: string): CommandResult => ({ kind: "error", text });

function roomLine(r: RoomView, active: boolean) {
  const vis = r.public ? "public" : "private";
  return `${active ? "▸" : " "} ${r.name}  [${vis}, ${r.status}, ${r.members.length} online]  ${r.roomId}`;
}

export function collabCommand(bridge: CollabBridge): CommandDefinition {
  let lastResults: { name: string; invite: string; description: string; tags: string[]; roomId: string }[] = [];
  return {
    name: "collab",
    description: "Collab rooms: create/join/search rooms, members, invite, send, tasks (see /collab help)",
    input: { hint: "[create|join|search|members|invite|say|task|log|rooms|leave|help] …" },
    async handler(inv: CommandInvocation): Promise<CommandResult> {
      const cmd = parseCollabCommand(inv.rawInput);
      try {
        await bridge.start();
        switch (cmd.op) {
          case "help":
            return ok(HELP);
          case "error":
            return fail(cmd.message);
          case "status": {
            const st = bridge.state();
            if (!st.rooms.length) return ok(`You are ${st.self}. Not in any room.\n\n${HELP}`);
            const r = bridge.view(bridge.room());
            return ok(
              [
                `You are ${st.self} · relay ${st.relayUrl}`,
                `Active room: ${r.name} (${r.roomId}) — ${r.public ? "public (listed, not confidential)" : "private (invite only)"}, ${r.status}`,
                `Members (${r.members.length}): ${r.members.map((m) => m.agentId + (m.self ? " (you)" : "")).join(", ")}`,
                `Wakes go to: ${r.bound ? "the bound session" : `an auto-created "${r.sessionTitle}" session`}`,
                st.rooms.length > 1 ? `\nOther rooms:\n${st.rooms.filter((x) => x.roomId !== r.roomId).map((x) => roomLine(x, false)).join("\n")}` : "",
              ].filter(Boolean).join("\n"),
            );
          }
          case "create": {
            const r = await bridge.createRoom({ name: cmd.name, description: cmd.description, tags: cmd.tags, public: cmd.public, localOnly: cmd.localOnly }, inv.agent);
            return ok(
              `Created ${r.public ? "PUBLIC" : "private"} room "${r.name}" (${r.roomId}); this session now receives its @mentions and tasks.\n` +
                (r.public ? (r.listed ? "Listed in the public directory — anyone can find, join and read it.\n" : "Directory listing failed; see logs (room still works by invite).\n") : "") +
                `\nInvite (share with other agents; anyone holding it can read the room):\n${r.invite}`,
            );
          }
          case "join":
          case "join-result": {
            let invite: string;
            let info = {};
            if (cmd.op === "join-result") {
              const hit = lastResults[cmd.index - 1];
              if (!hit) return fail(`no search result #${cmd.index}; run /collab search first`);
              invite = hit.invite;
              info = { name: hit.name, description: hit.description, tags: hit.tags, public: true };
            } else invite = cmd.invite;
            const r = await bridge.joinInvite(invite, info, inv.agent);
            return ok(`Joined "${r.name}" (${r.roomId}) as ${bridge.identity!.agentId}. Members (${r.members.length}): ${r.members.map((m) => m.agentId).join(", ")}\nThis session now receives the room's @mentions and tasks.`);
          }
          case "search": {
            const rooms = await bridge.search(cmd.query, cmd.tag);
            lastResults = rooms;
            if (!rooms.length) return ok(`No public rooms match${cmd.query ? ` "${cmd.query}"` : ""}${cmd.tag ? ` #${cmd.tag}` : ""}.`);
            return ok(
              rooms
                .map((r, i) => `${i + 1}. ${r.name}${r.joined ? " (joined)" : ""} — ${r.members} online · ${r.tags.map((t) => "#" + t).join(" ")}\n   ${r.description || "(no description)"}  [${r.roomId}]`)
                .join("\n") + "\n\nJoin with /collab join <n>. Public rooms are not confidential.",
            );
          }
          case "rooms": {
            const st = bridge.state();
            return ok(st.rooms.length ? st.rooms.map((r) => roomLine(r, r.roomId === st.activeRoomId)).join("\n") : "Not in any room.");
          }
          case "use": {
            const q = cmd.room.toLowerCase();
            const r = bridge.state().rooms.find((x) => x.roomId === cmd.room || x.name.toLowerCase() === q);
            if (!r) return fail(`no joined room named ${cmd.room}`);
            bridge.setActive(r.roomId);
            return ok(`Active room: ${r.name} (${r.roomId})`);
          }
          case "invite": {
            const conn = bridge.room();
            return ok(`Invite for "${conn.meta.name}" (anyone holding it can read the room):\n${conn.meta.invite}`);
          }
          case "members": {
            const r = bridge.view(bridge.room());
            return ok(`${r.name}: ${r.members.length} online\n${r.members.map((m) => `● ${m.agentId}${m.self ? " (you)" : ""}`).join("\n")}`);
          }
          case "say": {
            const r = await bridge.send(undefined, cmd.text, cmd.mentions);
            return ok(`sent #${r.seq}${cmd.mentions.length ? ` (wakes ${cmd.mentions.map((m) => "@" + m).join(", ")})` : " (broadcast)"}`);
          }
          case "task": {
            const r = await bridge.createTask(undefined, cmd.title, cmd.body, cmd.assignee);
            return ok(`task ${r.taskId} created${cmd.assignee ? ` for @${cmd.assignee}` : " (unassigned: every agent is woken)"}`);
          }
          case "log": {
            const msgs = bridge.room().messages.slice(-cmd.limit);
            return ok(msgs.length ? msgs.map((m) => `${new Date(m.ts).toISOString().slice(11, 19)} ${m.self ? "you" : m.from}: ${m.text}`).join("\n") : "(no messages yet)");
          }
          case "agents": {
            const r = bridge.view(bridge.room());
            const agents = r.local?.agents ?? [];
            if (!agents.length) return ok(`No local agents in "${r.name}". Add one with /collab agent add <moderator|architect|coder|reviewer|name>.`);
            return ok(
              `${r.name}: ${agents.length} local agent(s)\n` +
                agents.map((a) => `● @${a.agentId}  ${a.name}${a.moderator ? " (moderator)" : ""} · ${a.scope}${a.approvalRequired ? " · approval" : ""}${a.persona ? ` — ${a.persona}` : ""}`).join("\n"),
            );
          }
          case "agent-add": {
            const conn = bridge.room();
            const a = await bridge.addLocalAgent(conn.meta.roomId, cmd.preset ? { preset: cmd.preset } : { name: cmd.name, scope: "read" });
            return ok(`Added local agent ${a.name} (@${a.agentId}, ${a.scope}). Mention it with @${a.agentId}.`);
          }
          case "agent-rm": {
            const conn = bridge.room();
            const q = cmd.agent.toLowerCase();
            const a = conn.local.agents.find((x) => x.agentId.toLowerCase() === q || x.id === q || x.name.toLowerCase() === q);
            if (!a) return fail(`no local agent ${cmd.agent}`);
            await bridge.removeLocalAgent(conn.meta.roomId, a.id);
            return ok(`Removed local agent ${a.name}.`);
          }
          case "stop": {
            const conn = bridge.room();
            const q = cmd.agent?.toLowerCase();
            const a = q ? conn.local.agents.find((x) => x.agentId.toLowerCase() === q || x.id === q || x.name.toLowerCase() === q) : undefined;
            if (q && !a) return fail(`no local agent ${cmd.agent}`);
            const n = bridge.stopLocal(conn.meta.roomId, a?.agentId);
            return ok(`Stopped ${n} local agent run(s).`);
          }
          case "transport": {
            const r = await bridge.setTransport(bridge.room().meta.roomId, cmd.target);
            return ok(`Transport → ${cmd.target}${cmd.target === "local" ? " (in-process, no network)" : `\nInvite for remote hosts:\n${r.invite}`}`);
          }
          case "leave": {
            const conn = bridge.room();
            await bridge.leave(conn.meta.roomId);
            return ok(`Left "${conn.meta.name}" and removed it from ~/.collab/state.json${conn.meta.owner && conn.meta.public ? " (unlisted from the directory)" : ""}.`);
          }
        }
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  };
}
