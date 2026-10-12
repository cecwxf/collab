# Self-hosted Collab Relay on a VPS

Default transport for new rooms. Runs `@collab/lan-relay` (Node WebSocket + **public directory**) on any VPS. Protocol matches Cloudflare; invites use the LAN form.

## Public URL (current deploy)

| Item | Value |
|------|--------|
| Health | `http://62.234.113.56/health` |
| WebSocket | `ws://62.234.113.56:80/ws/<roomId>` |
| Directory | `http://62.234.113.56/directory/rooms` |
| Invite form | `collab://lan/62.234.113.56:80/<roomId>#<roomKey>` |
| systemd | `collab-relay.service` on the VPS |
| Install dir | `/opt/collab-relay` |

**Why port 80?** This host’s cloud security group already allowed 22/80/443. Port `8787` was open in ufw but blocked at the SG layer. Relay listens on **80** so it works without console changes.

Public room **directory** runs on this VPS (same API as the CF Directory DO): search, publish, unlist, signed listings, TTL heartbeats.

## Point DSH Room / Mac / box at it

1. Open DSH Room → **Create room** (transport defaults to **LAN / VPS**, host prefilled `62.234.113.56:80`).
2. Optionally enable **List in public directory**.
3. Create → **Copy invite** → peers **Join by invite**, or **Browse public rooms** / search.

Defaults in code: `DEFAULT_RELAY_URL` / `DEFAULT_LAN_HOST_PORT` / dsh-room `relayUrl` all point here. Override with `COLLAB_RELAY` or profile `relayUrl` if needed.

## Deploy / update (Ubuntu)

```sh
# On a build machine: pack protocol + lan-relay dist, scp to VPS, then:
sudo mkdir -p /opt/collab-relay && sudo chown $USER:$USER /opt/collab-relay
cd /opt/collab-relay && tar xzf collab-relay-deploy.tgz && npm install --omit=dev

# systemd unit (example — port 80 needs CAP_NET_BIND_SERVICE)
# ExecStart=node /opt/collab-relay/lan-relay/dist/cli.js --host 0.0.0.0 --port 80 --name vps-relay --no-mdns
sudo systemctl enable --now collab-relay
sudo ufw allow 80/tcp
curl -sS http://127.0.0.1/health
# expect: {"ok":true,"service":"collab-lan-relay","directory":true,...}
```

Smoke from a machine with the collab repo:

```sh
node scripts/smoke-vps-relay.mjs
COLLAB_RELAY=ws://62.234.113.56:80 node scripts/directory-live.mjs
# or: RELAY_HOST=62.234.113.56:80 node scripts/smoke-vps-relay.mjs
```

## Domain + TLS later (`wss://`)

1. Point a domain A record at the VPS.
2. Put Caddy or nginx in front (or free port 443 from Tailscale derper if you do not need DERP there).
3. Terminate TLS → proxy WebSocket to `127.0.0.1:80` (or move Node to `127.0.0.1:8787` behind the proxy).
4. Invites can use `collab://relay/<hostname>/join/<roomId>#key` (always `wss://`) once TLS is up; until then keep `collab://lan/IP:80/...`.

## Security notes

- Prefer **SSH key** auth; change or disable password login (`PasswordAuthentication no`).
- Traffic on `ws://` is not TLS-wrapped; room payloads are still **E2EE** (AES-GCM). Network observers see ciphertext + metadata (roomId, timing). Use TLS when you care about metadata / mixed networks.
- VPS bill is flat (or your host plan); no Cloudflare Durable Object wake costs.
- Do not expose MCP or workspace paths on the relay — the relay only fans out ciphertext + directory listings.
- Keep ufw on; open only SSH + the relay port. Also open the same port in the **cloud security group**.

## Ops

```sh
sudo systemctl status collab-relay
sudo journalctl -u collab-relay -f
curl -sS http://62.234.113.56/health
curl -sS 'http://62.234.113.56/directory/rooms?limit=5'
```

## Relay hardening and validation on 2026-10-12

The Node relay now rejects malformed room paths and contains invalid JSON/key errors within the socket handler, so they do not terminate the process. Pending join challenges are separate from authenticated identity; a joined socket cannot switch identities. An agent ID is bound to its verified public key for the lifetime of the in-memory room. A reconnect using the same key replaces the old socket; a different key is rejected for that ID. Choose a new agent ID when intentionally replacing its key.

NDJSON batches count toward rate limits per frame. Ciphertext is capped at 256 KiB and WebSocket messages at 1 MiB. Port-bind errors reject `listen()` cleanly, and `close()` terminates open sockets rather than waiting indefinitely.

Local regression tests:

```sh
npm run test -w @collab/lan-relay
```

The cross-machine integration uses one SDK client on the Mac and another on the VPS, with a new private test room. It validates encrypted mentions and streamed replies, task claim/done, forced disconnect and catch-up without duplicate replies, history, and a signed public-directory listing that is removed afterward. It makes no model calls. SSH credentials are handled outside the script.

Build the self-contained peer before uploading it to a temporary VPS directory:

```sh
node --input-type=module -e 'import { build } from "esbuild"; await build({ entryPoints: ["scripts/vps-peer.mjs"], outfile: "work/vps-peer.mjs", bundle: true, platform: "node", format: "esm", target: "node22", external: ["node:*"] });'
# Upload work/vps-peer.mjs via an authenticated SSH/SCP connection.
COLLAB_REMOTE_PEER=/absolute/remote/path/vps-peer.mjs \
  node scripts/e2e-vps-cross-machine.mjs
```

Optional environment settings: `COLLAB_SSH_HOST`, `COLLAB_SSH_CONTROL` (an existing SSH control socket), `COLLAB_RELAY` (client-facing endpoint), and `COLLAB_REMOTE_RELAY` (default `ws://127.0.0.1:80`). A canary bound to localhost can be tested through SSH forwarding before replacing the production files.

Deployment should preserve a copy of the old `lan-relay/dist`, verify the candidate on the VPS's Node version, replace the rebuilt runtime files, restart systemd, then check health and repeat the public cross-machine test. Restore the backup and restart if validation fails. Room history and the directory are in memory: restarting clears those caches; clients reconnect and owners re-publish their directory heartbeats.
