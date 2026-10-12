/**
 * `/collab …` grammar for the dsh command surface (dsh-commands): pure parsing, no I/O.
 * dsh hands the command everything after `/collab` verbatim as rawInput.
 */
export type CollabCommand =
  | { op: "help" }
  | { op: "status" }
  | { op: "create"; name?: string; description?: string; tags: string[]; public: boolean; localOnly?: boolean }
  | { op: "join"; invite: string }
  | { op: "join-result"; index: number }
  | { op: "search"; query?: string; tag?: string }
  | { op: "rooms" }
  | { op: "use"; room: string }
  | { op: "invite" }
  | { op: "members" }
  | { op: "say"; text: string; mentions: string[] }
  | { op: "task"; title: string; body?: string; assignee?: string }
  | { op: "log"; limit: number }
  | { op: "leave" }
  | { op: "agents" }
  | { op: "agent-add"; preset?: string; name?: string }
  | { op: "agent-rm"; agent: string }
  | { op: "stop"; agent?: string }
  | { op: "transport"; target: "local" | "relay" | "lan" }
  | { op: "error"; message: string };

const MENTION = /(^|\s)@([A-Za-z0-9][A-Za-z0-9._:-]*)/g;

export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION)) out.add(m[2]!.replace(/[.:]+$/, ""));
  return [...out];
}

export const HELP = [
  "/collab — Collab room for this session (end-to-end encrypted, via the Collab relay)",
  "  /collab                     status: room, you, members, bound session",
  "  /collab create [name] [-- description] [#tag ...]   private (invite-only) room bound to this session",
  "  /collab create public <name> [-- description] [#tag ...]   list it in the public directory (NOT confidential)",
  "  /collab search [text] [#tag]   search public rooms",
  "  /collab join <invite | n>   join by invite, or result n of the last search",
  "  /collab rooms               rooms you are in;  /collab use <name|roomId>  switch the active room",
  "  /collab invite              print the invite again to copy/share",
  "  /collab members             who is in the room right now",
  "  /collab say <text>          send to the room; @agentId wakes that agent; @all wakes everyone",
  "  /collab task [@agent] <title> [-- details]   create a task (assignee is woken)",
  "  /collab log [n]             last n room messages (default 20)",
  "  /collab leave               leave the room and forget it on this machine",
  "  /collab create local [name]   local-only room (in-process loopback, no network) for local agents",
  "  /collab agents              local agents hosted by this dsh in the active room",
  "  /collab agent add <moderator|architect|coder|reviewer|name>   add a local agent (preset or custom name)",
  "  /collab agent rm <name>     remove a local agent",
  "  /collab stop [@agent]       stop all (or one) local agent runs",
  "  /collab transport <local|relay|lan>   switch transport (relay/lan lets remote hosts join)",
].join("\n");

export function parseCollabCommand(rawInput: string): CollabCommand {
  const input = rawInput.trim();
  if (!input) return { op: "status" };
  const sp = input.search(/\s/);
  const sub = (sp < 0 ? input : input.slice(0, sp)).toLowerCase();
  const rest = sp < 0 ? "" : input.slice(sp).trim();
  switch (sub) {
    case "help":
    case "-h":
    case "--help":
      return { op: "help" };
    case "status":
      return { op: "status" };
    case "create":
    case "new": {
      let t = rest;
      let isPublic = false;
      let localOnly = false;
      const pm = /^(public|private|local)\b\s*/i.exec(t);
      if (pm) {
        isPublic = pm[1]!.toLowerCase() === "public";
        localOnly = pm[1]!.toLowerCase() === "local";
        t = t.slice(pm[0].length);
      }
      const tags = [...t.matchAll(/(^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/g)].map((m) => m[2]!.toLowerCase());
      t = t.replace(/(^|\s)#[A-Za-z0-9][A-Za-z0-9_-]*/g, " ").trim();
      const [name, ...desc] = t.split(/\s+--\s+|^--\s+/);
      const description = desc.join(" -- ").trim();
      if (isPublic && !name?.trim()) return { op: "error", message: "usage: /collab create public <name> [-- description] [#tag ...]" };
      return { op: "create", name: name?.trim() || undefined, description: description || undefined, tags, public: isPublic, ...(localOnly ? { localOnly } : {}) };
    }
    case "search":
    case "find":
    case "discover": {
      const tag = /(^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/.exec(rest)?.[2]?.toLowerCase();
      const query = rest.replace(/(^|\s)#[A-Za-z0-9][A-Za-z0-9_-]*/g, " ").trim();
      return { op: "search", query: query || undefined, tag };
    }
    case "rooms":
    case "list":
      return { op: "rooms" };
    case "use":
    case "switch":
      if (!rest) return { op: "error", message: "usage: /collab use <name|roomId>" };
      return { op: "use", room: rest };
    case "join": {
      if (/^\d+$/.test(rest)) return { op: "join-result", index: Number(rest) };
      const invite = rest.split(/\s+/)[0] ?? "";
      if (!/^collab:\/\/join\/[^#\s]+#\S+$/.test(invite)) return { op: "error", message: "usage: /collab join collab://join/<roomId>#<roomKey>  (or /collab join <n> after /collab search)" };
      return { op: "join", invite };
    }
    case "invite":
    case "share":
      return { op: "invite" };
    case "members":
    case "peers":
    case "who":
      return { op: "members" };
    case "say":
    case "send":
    case "msg":
      if (!rest) return { op: "error", message: "usage: /collab say <text>  (use @agentId to wake an agent)" };
      return { op: "say", text: rest, mentions: extractMentions(rest) };
    case "task": {
      let t = rest;
      let assignee: string | undefined;
      const m = /^@([A-Za-z0-9][A-Za-z0-9._:-]*)\s+/.exec(t);
      if (m) {
        assignee = m[1];
        t = t.slice(m[0].length);
      }
      const [title, ...bodyParts] = t.split(/\s+--\s+/);
      if (!title?.trim()) return { op: "error", message: "usage: /collab task [@agentId] <title> [-- details]" };
      const body = bodyParts.join(" -- ").trim();
      return { op: "task", title: title.trim(), body: body || undefined, assignee };
    }
    case "log":
    case "history": {
      const n = rest ? Number.parseInt(rest, 10) : 20;
      return { op: "log", limit: Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 20 };
    }
    case "leave":
    case "quit":
      return { op: "leave" };
    case "agents":
      return { op: "agents" };
    case "agent": {
      const [verb, ...args] = rest.split(/\s+/).filter(Boolean);
      const arg = args.join(" ").replace(/^@/, "");
      if ((verb === "add" || verb === "new") && arg) {
        const k = arg.toLowerCase();
        return ["moderator", "architect", "coder", "reviewer"].includes(k) ? { op: "agent-add", preset: k } : { op: "agent-add", name: arg };
      }
      if ((verb === "rm" || verb === "remove" || verb === "del") && arg) return { op: "agent-rm", agent: arg };
      return { op: "error", message: "usage: /collab agent add <preset|name>  |  /collab agent rm <name>" };
    }
    case "stop":
    case "interrupt":
      return { op: "stop", ...(rest ? { agent: rest.replace(/^@/, "") } : {}) };
    case "transport": {
      const t = rest.toLowerCase();
      if (t === "local" || t === "relay" || t === "lan") return { op: "transport", target: t };
      return { op: "error", message: "usage: /collab transport <local|relay|lan>" };
    }
    default:
      // `/collab @agent hi` or `/collab hello` → say
      if (input.startsWith("@")) return { op: "say", text: input, mentions: extractMentions(input) };
      return { op: "error", message: `unknown subcommand "${sub}"\n\n${HELP}` };
  }
}
