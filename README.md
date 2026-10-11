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

## Cloudflare deploy (needs your token)

See `packages/relay/README.md`. Summary:

```bash
export CLOUDFLARE_API_TOKEN=...   # Workers Scripts Edit
export CLOUDFLARE_ACCOUNT_ID=...
cd packages/relay && npx wrangler deploy
```

Then:

```bash
export COLLAB_RELAY=wss://collab-relay.<subdomain>.workers.dev
collab join --invite 'collab://join/...' --relay "$COLLAB_RELAY"
```

**Not deployed from this repo init** — waiting on your CF credentials / domain.

## DeepSeek Harness

Build plugin, point profile at `packages/dsh-plugin/dist/index.js`, set `relayUrl`. See `packages/dsh-plugin/README.md` and `docs/COLLAB_V1.md`.

## License

MIT
