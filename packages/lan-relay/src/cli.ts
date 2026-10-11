#!/usr/bin/env node
/**
 * collab-lan-relay — local WebSocket relay + mDNS (_collab._tcp).
 * Usage: collab-lan-relay [--port 7421] [--host 0.0.0.0] [--name my-lan] [--no-mdns]
 */
import { LanRelayServer } from "./server.js";
import { browseLanRelays } from "./mdns.js";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(n);

if (has("--browse") || has("browse")) {
  const peers = await browseLanRelays({ timeoutMs: Number(flag("--timeout") ?? 2500) });
  console.log(JSON.stringify({ peers }, null, 2));
  process.exit(0);
}

const server = new LanRelayServer({
  host: flag("--host") ?? "0.0.0.0",
  port: Number(flag("--port") ?? 7421),
  name: flag("--name") ?? "collab-lan",
  mdns: !has("--no-mdns"),
});
const { host, port } = await server.listen();
console.log(`collab-lan-relay listening on ${host}:${port}`);
console.log(`  WS     ws://<this-host>:${port}/ws/<roomId>`);
console.log(`  invite collab://lan/<this-host>:${port}/<roomId>#<roomKey>`);
console.log(`  mDNS   ${has("--no-mdns") ? "off" : "_collab._tcp.local (auto-discovery)"}`);
console.log(`  browse collab-lan-relay --browse`);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
