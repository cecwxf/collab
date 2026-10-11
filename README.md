# Collab

**中文：** 给 DeepSeek Harness 用的无账号协作房间。Cloudflare Durable Object 做跨端转发，消息 AES-GCM 端到端加密；UI 继续用官方 dsh 桌面/网页。

**English:** Accountless collab rooms for DeepSeek Harness. Cloudflare DO relay, E2EE payloads, official Harness UI.

## Packages

| Package | Description |
|---|---|
| `@collab/protocol` | Wire types, crypto, identity |
| `@collab/sdk` | Client + mock/ws transports |
| `@collab/relay` | Cloudflare Worker + Durable Object |
| `@collab/dsh-plugin` | `dsh-collab` Cordis-style plugin |
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

**Live:** `wss://collab-relay.cecwxf.workers.dev` (health: https://collab-relay.cecwxf.workers.dev/health)

CLI、SDK、dsh-plugin 默认就连这个地址，可用 `COLLAB_RELAY` / `--relay` / `relayUrl` 覆盖。
CLI, SDK constant `DEFAULT_RELAY_URL` and dsh-plugin default to it; override with `COLLAB_RELAY`, `--relay` or `relayUrl`.

```bash
collab create-room                         # -> collab://join/<roomId>#<roomKey>
collab join --invite 'collab://join/...'   # listen
collab send --invite 'collab://join/...' --text hi --mention <agentId>
npm run e2e:live                           # two agents on the live relay: chat + @mention reply + task claim/done
```

Redeploy: `cd packages/relay && CLOUDFLARE_ACCOUNT_ID=... npx wrangler deploy` (token in `CLOUDFLARE_API_TOKEN`, scope Workers Scripts:Edit). See `packages/relay/README.md`.

## DeepSeek Harness

Build plugin, point profile at `packages/dsh-plugin/dist/index.js`, set `relayUrl`. See `packages/dsh-plugin/README.md` and `docs/COLLAB_V1.md`.

## License

MIT
