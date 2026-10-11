# Self-hosted Collab Relay on a VPS

You can run the same Node relay (`@collab/lan-relay`) on any VPS instead of Cloudflare. Protocol and invites are identical; use **LAN / VPS** transport in DSH Room.

## Public URL (current deploy)

| Item | Value |
|------|--------|
| Health | `http://62.234.113.56/health` |
| WebSocket | `ws://62.234.113.56:80/ws/<roomId>` |
| Invite form | `collab://lan/62.234.113.56:80/<roomId>#<roomKey>` |
| systemd | `collab-relay.service` on the VPS |
| Install dir | `/opt/collab-relay` |

**Why port 80?** This host’s cloud security group already allowed 22/80/443. Port `8787` was open in ufw but blocked at the SG layer. Relay listens on **80** so it works without console changes. You can still run on `8787` after opening that port in the Tencent/云厂商安全组.

Public room **directory** is Cloudflare-only today → VPS rooms are **invite-only**.

## Point DSH Room / Mac / box at it

1. Open DSH Room → **Create room**.
2. Transport → **LAN / VPS**.
3. Set **Relay host:port** to `62.234.113.56:80` (do not leave blank — blank starts an embedded local relay).
4. Create → **Copy invite** → peers **Join by invite**.

Peers do not need the Cloudflare Worker. Any dsh with `@collab/dsh-room` that can reach `ws://62.234.113.56:80` can join.

Config alternative (always use CF by default, VPS only when invite says so): leave `relayUrl` as the CF `wss://…` URL; LAN/VPS invites carry the host in the URI.

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
```

Smoke from a machine with the collab repo:

```sh
node scripts/smoke-vps-relay.mjs
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
- Do not expose MCP or workspace paths on the relay — the relay only fans out ciphertext.
- Keep ufw on; open only SSH + the relay port. Also open the same port in the **cloud security group**.

## Ops

```sh
sudo systemctl status collab-relay
sudo journalctl -u collab-relay -f
curl -sS http://62.234.113.56/health
```
