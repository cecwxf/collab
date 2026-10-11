#!/usr/bin/env node
/**
 * collab CLI — create-room / join / send / peers without DeepSeek Harness
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { generateIdentity, loadOrCreateIdentity, b64uEncode } from "@collab/protocol";
import { CollabClient, RoomHub, WsTransport } from "@collab/sdk";

function usage(): never {
  console.log(`collab — Collab v1 CLI

Usage:
  collab create-room
  collab join --invite <uri> [--relay <wss://...>] [--identity <path>]
  collab send --invite <uri> --text <msg> [--mention <agentId>] [--relay ...]
  collab peers --invite <uri> [--relay ...]
  collab smoke-local

Env:
  COLLAB_RELAY   default relay base, e.g. wss://collab-relay.example.com
  COLLAB_IDENTITY  default ~/.collab/identity.json
`);
  process.exit(1);
}

function identityPath(flag?: string): string {
  return flag ?? process.env.COLLAB_IDENTITY ?? join(homedir(), ".collab", "identity.json");
}

function relayUrl(roomId: string, flag?: string): string | null {
  const base = flag ?? process.env.COLLAB_RELAY;
  if (!base) return null;
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}/ws/${encodeURIComponent(roomId)}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();

  const flags = parseFlags(argv.slice(1));

  if (cmd === "create-room") {
    const room = CollabClient.createRoom();
    console.log(JSON.stringify({
      roomId: room.roomId,
      roomKey: room.roomKeyB64,
      uri: room.uri,
    }, null, 2));
    return;
  }

  if (cmd === "smoke-local") {
    await smokeLocal();
    return;
  }

  if (cmd === "join" || cmd === "send" || cmd === "peers") {
    const invite = flags.invite;
    if (!invite) {
      console.error("--invite required");
      process.exit(2);
    }
    const parsed = CollabClient.parseInvite(invite);
    const id = await loadOrCreateIdentity(identityPath(flags.identity));
    const url = relayUrl(parsed.roomId, flags.relay);

    let client: CollabClient;
    if (url) {
      client = new CollabClient({
        identity: id,
        roomId: parsed.roomId,
        roomKey: parsed.roomKeyB64,
        transport: new WsTransport(url),
        reconnect: false,
      });
    } else {
      console.error("No --relay / COLLAB_RELAY; use smoke-local for in-process demo");
      process.exit(2);
    }

    client.onPayload((p) => {
      console.log("[msg]", JSON.stringify(p));
    });
    client.onPeers((peers, ev) => {
      console.log("[peers]", peers.map((p) => p.agentId).join(", "), ev ?? "");
    });

    await client.join();
    console.log("joined as", id.agentId, "seq=", client.getSeq());

    if (cmd === "peers") {
      console.log(JSON.stringify(client.getPeers(), null, 2));
      await client.dispose();
      return;
    }

    if (cmd === "send") {
      const text = flags.text ?? "";
      if (!text) {
        console.error("--text required");
        process.exit(2);
      }
      const mentions = flags.mention ? [flags.mention] : undefined;
      const r = await client.sendChat(text, mentions);
      console.log("sent", r);
      await client.dispose();
      return;
    }

    // join: stay connected until SIGINT
    console.log("listening… Ctrl+C to exit");
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => resolve());
    });
    await client.dispose();
    return;
  }

  usage();
}

async function smokeLocal(): Promise<void> {
  const hub = new RoomHub();
  const room = CollabClient.createRoom();
  const idA = await generateIdentity("cli-a");
  const idB = await generateIdentity("cli-b");
  const [a, b] = CollabClient.createMockPair(
    hub,
    { identity: idA, roomId: room.roomId, roomKey: room.roomKey },
    { identity: idB, roomId: room.roomId, roomKey: room.roomKey },
  );
  const got: string[] = [];
  b.onPayload((p) => {
    if (p.kind === "chat") got.push(p.text);
  });
  await a.join();
  await b.join();
  await a.sendChat("smoke-local ok", ["cli-b"]);
  await new Promise((r) => setTimeout(r, 50));
  await a.dispose();
  await b.dispose();
  if (got[0] !== "smoke-local ok") {
    console.error("FAIL", got);
    process.exit(1);
  }
  console.log("smoke-local PASS", { room: room.uri, key: b64uEncode(room.roomKey).slice(0, 8) + "…" });
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1] && !args[i + 1]!.startsWith("--") ? args[++i]! : "true";
      out[key] = val;
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
