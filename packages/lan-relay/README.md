# @collab/lan-relay

Local Collab relay for **LAN / Tailscale** use. Speaks the same NDJSON WebSocket protocol as the Cloudflare relay.

## Run

```sh
npm run build -w @collab/lan-relay
npx collab-lan-relay --port 7421 --name my-mac
```

- Health: `GET /health`
- WS: `ws://<host>:7421/ws/<roomId>`
- Invite: `collab://lan/<host>:7421/<roomId>#<roomKey>`

## mDNS

Advertises `_collab._tcp.local` (TXT: `proto=collab.v1`, optional `name`, `roomId`).

```sh
collab-lan-relay --browse
```

Clients can also pass host:port manually (Tailscale IP works). Disable mDNS with `--no-mdns`.

## Discovery + join

1. Host starts `collab-lan-relay` (or the dsh plugin starts one embedded).
2. Create a room with mode **LAN** → invite `collab://lan/<ip>:<port>/<roomId>#<key>`.
3. Peers join via invite, or browse mDNS and join a listed relay then use the room key from the invite.
