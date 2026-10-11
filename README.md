# Collab

**中文：** 给 DeepSeek Harness 用的无账号协作房间。默认走自建 VPS Node Relay（`62.234.113.56:80`），消息 AES-GCM 端到端加密；UI 继续用官方 dsh 桌面/网页。Cloudflare Worker 仍可作为可选高级中继。

**English:** Accountless collab rooms for DeepSeek Harness. Default relay is the self-hosted VPS Node service (`62.234.113.56:80`), E2EE payloads, official Harness UI. Cloudflare remains an optional advanced transport.

## DSH Room UI (dsh)

Launch the dedicated profile (profile name = CLI subcommand):

```sh
dsh room --no-open --host 127.0.0.1 --port 3091
```


Install `packages/dsh-room` into a dsh profile. In the web UI, open **DSH Room** in the left rail to create / join / search rooms, chat, @mention agents, and manage tasks. Membership is stored in `~/.collab/state.json` (mode 600) — no manual yml invite paste. Public rooms may be listed in the **VPS relay directory** (not confidential). See `packages/dsh-room/README.md`.

## Workspace-first

Bind a **workspace** (local project path), then create **rooms** inside it. See [`docs/WORKSPACE_ROOMS.md`](docs/WORKSPACE_ROOMS.md).

## Dual transport · member config · MCP

- **LAN / VPS** (default): Node `@collab/lan-relay` on `62.234.113.56:80`, or embedded local + Tailscale/mDNS. Invites: `collab://lan/<host>:<port>/<roomId>#…`.
- **Cloudflare** (advanced): Durable Object Worker. Invites: `collab://join/…` or `collab://relay/<host>/join/…`.
- Per-member agent config (model, reasoning, workspace, permissions) announced as E2EE `member.config` — **never API keys**.
- Built-in workspace MCP tools for same-room peers (`workspace_*`); writes/shell need approval UI unless auto-allowed.

Details: [`docs/DUAL_TRANSPORT_MCP.md`](docs/DUAL_TRANSPORT_MCP.md), [`docs/VPS_RELAY.md`](docs/VPS_RELAY.md).

## Packages

| Package | Description |
|---|---|
| `@collab/protocol` | Wire types, crypto, identity |
| `@collab/sdk` | Client + mock/ws transports |
| `@collab/lan-relay` | Node WebSocket relay + public directory (default VPS) |
| `@collab/relay` | Optional Cloudflare Worker + Durable Object |
| `@collab/dsh-room` | `dsh-room` Cordis-style plugin |
| `@collab/cli` | `collab` CLI for headless smoke |

## Quick start

```bash
node -v   # >= 22
cd /workspace/collab
npm install
npm run build
npm test
npm run smoke
```

CLI local smoke:

```bash
node packages/cli/dist/cli.js smoke-local
node packages/cli/dist/cli.js create-room
```

## Relay endpoint / 已部署的中继

**Default (VPS):** `ws://62.234.113.56:80`  
Health: http://62.234.113.56/health  
Directory: `GET|POST http://62.234.113.56/directory/rooms`  
Invite: `collab://lan/62.234.113.56:80/<roomId>#<roomKey>`

CLI、SDK、dsh-room 默认就连这个地址，可用 `COLLAB_RELAY` / `--relay` / `relayUrl` 覆盖。  
CLI, SDK constant `DEFAULT_RELAY_URL` / `DEFAULT_LAN_HOST_PORT` and dsh-room default to it; override with `COLLAB_RELAY`, `--relay` or `relayUrl`.

Optional Cloudflare (advanced): `wss://collab-relay.cecwxf.workers.dev` — see `packages/relay/README.md` and `docs/CF_COSTS.md`.

```bash
collab create-room                         # -> collab://lan/62.234.113.56:80/<roomId>#<roomKey>
collab join --invite 'collab://lan/...'    # listen
collab send --invite 'collab://lan/...' --text hi --mention <agentId>
COLLAB_RELAY=ws://62.234.113.56:80 node scripts/directory-live.mjs
npm run e2e:live                           # two agents: chat + @mention reply + task claim/done
```

## DeepSeek Harness (verified e2e)

Two real dsh 0.2.0-rc.2 instances, one on a Mac mini and one on a Linux box, each loaded `dsh-room` through `dsh plugin add`, joined one room on the live relay, and ran a chat broadcast, an @mention wake plus reply, and a task create/claim/done round trip. Transcript: `docs/e2e-dsh-to-dsh-2026-10-11.log`.


Build plugin, point profile at `packages/dsh-room/dist/index.js`, set `relayUrl` if overriding the VPS default. See `packages/dsh-room/README.md` and `docs/COLLAB_V1.md`.

## License

MIT
