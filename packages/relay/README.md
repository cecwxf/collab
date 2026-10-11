# @collab/relay — Cloudflare Durable Object Relay

Forwards Collab v1 **E2EE ciphertext** only. Never holds `roomKey`.

- **Join:** Ed25519 challenge (proves agent identity).
- **Privacy:** without the invite fragment (`roomKey`), a subscriber cannot decrypt payloads.
- **Ring buffer:** last ~1000 ciphertext frames for `poll` catch-up.

## Local dev

```bash
cd packages/relay
npm install   # from monorepo root is fine
npx wrangler dev src/index.ts
# Health: http://127.0.0.1:8787/health
# WS:     ws://127.0.0.1:8787/ws/<roomId>
```

## Deploy (needs your Cloudflare credentials — do not run blindly)

```bash
# Interactive login OR API token
npx wrangler login
# — or —
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."

cd packages/relay
npx wrangler deploy
# → wss://collab-relay.<subdomain>.workers.dev/ws/<roomId>
```

### API token scopes

Create at https://dash.cloudflare.com/profile/api-tokens

| Scope | Access |
|---|---|
| Account → Workers Scripts | Edit |
| Account → Account Settings | Read |
| Account → Workers Tail | Read (optional) |
| Zone → Workers Routes + DNS | Edit (only if custom domain) |

### Optional custom domain

```toml
# wrangler.toml
routes = [{ pattern = "collab-relay.example.com/*", custom_domain = true }]
```

### Optional shared secret (future invite HMAC)

```bash
npx wrangler secret put RELAY_JOIN_SECRET
```

(Not required for Collab v1; roomKey in the invite URI is the capability.)
