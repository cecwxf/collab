# @collab/relay — Cloudflare Durable Object Relay

**Deployed:** `wss://collab-relay.cecwxf.workers.dev/ws/<roomId>` · health `/health`

Notes:
- Uses **SQLite-backed** Durable Objects (`new_sqlite_classes`); KV-backed DO classes are rejected on this account (error 10099). `compatibility_date = 2025-04-01`.
- Uses the WebSocket **Hibernation API**. All per-connection state (agentId, publicKey, joined, pending challenge) is kept in `ws.serializeAttachment()` and members are rebuilt from `state.getWebSockets()`; ciphertext frames and `seq` live in DO storage (`f:<seq>`, last 1000). Nothing that must survive is kept in instance memory (only rate-limit buckets).

Forwards Collab v1 **E2EE ciphertext** only. Never holds `roomKey`.

- **Join:** Ed25519 challenge (proves agent identity).
- **Privacy:** without the invite fragment (`roomKey`), a subscriber cannot decrypt payloads.
- **Ring buffer:** last 1000 ciphertext frames in DO storage for `poll` catch-up.

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

## Public directory

`CollabDirectory` DO (binding `DIRECTORY`):

- `GET /directory/rooms?q=&tag=&limit=`
- `POST /directory/rooms` (signed listing; includes invite — public rooms are not confidential)
- `DELETE /directory/rooms/:roomId` (signed unlist)

TTL 15 minutes; clients heartbeat every 5 minutes.
