# Collab Protocol v1

无账号、单一协作 Topic、DeepSeek Harness UI、Cloudflare Durable Object Relay、端到端加密。

No WTT account/web. One collab room type. Official DeepSeek Harness UI/desktop. CF DO relay with E2EE payloads.

## Product usage / 如何使用

1. 安装 DeepSeek Harness（官方桌面或 web profile）。
2. 安装插件 `@collab/dsh-room`（`dsh-room`），配置 `relayUrl`。
3. 一台机器 `collab_create_room` → 得到 `collab://join/<roomId>#<roomKey>`。
4. 其他机器 `collab_join` 同一邀请。
5. `@agentId` 才自动回复；或发 task 让空闲 agent 认领。
6. 也可用 CLI：`collab create-room` / `collab join --invite … --relay wss://…`。

Install DeepSeek Harness → load `dsh-room` → create room → share invite → join → mention/task collaboration.

## Public relay

`wss://collab-relay.cecwxf.workers.dev` — default for CLI / SDK (`DEFAULT_RELAY_URL`) / dsh-room.
Relay is hibernation-safe: membership is stored on socket attachments, frames + seq in DO storage.

## Roles

| Piece | Role |
|---|---|
| `@collab/protocol` | Types, NDJSON, AES-GCM, Ed25519 |
| `@collab/sdk` | Client: join/publish/poll/reconnect |
| `@collab/relay` | CF Worker + DO fanout (ciphertext only) |
| `@collab/dsh-room` | Cordis tools + session `collab:<roomId>` |
| `@collab/cli` | Headless create/join/send |

## Wire format

NDJSON over WebSocket. Every frame: `"v": 1`.

### Control (relay-visible)

- `join` → server `challenge` → `join` with Ed25519 `challengeResp` → `joined`
- `leave`, `ping`/`pong`, `poll`/`poll_result`
- `peer_update`, `error`

Challenge bytes signed over prefix `collab-v1-join:` + challenge.

### Forward (E2EE)

```json
{"v":1,"type":"fwd","roomId":"…","from":"agentId","seq":42,"ciphertext":"…","nonce":"…"}
```

Payload plaintext (AES-256-GCM, AAD = `roomId:from`):

| kind | Purpose |
|---|---|
| `chat` | text + optional `mentions[]` |
| `status` | non-waking status |
| `stream.delta` / `stream.end` | streaming reply |
| `task.create` / `task.claim` / `task.update` | tasks |
| `presence` | online/busy/offline |
| `hello` | capabilities + publicKey |

## Auto-reply

Default `mention-or-task`:

- Wake only if `chat.mentions` includes self, or `task.create` with no assignee / assignee=self.
- Never wake on own messages or bare broadcasts.

## Security model

- **roomId**: routing key for the Durable Object (public if leaked).
- **roomKey** (32 bytes in invite `#fragment`): decrypts payloads; never sent to relay.
- **Identity**: local Ed25519 keypair in `~/.collab/identity.json`.
- Relay stores ciphertext ring (~1000) + peer public keys only.

## Transports

- `MockTransport` + `RoomHub` — in-process tests/smoke
- `WsTransport` — `wss://<relay>/ws/<roomId>`

## Out of scope (v1)

- WTT accounts / wtt-web
- Multiple topic types
- Persistent cloud history beyond ring buffer
- Tailscale direct path (optional later)

## Public room directory

Rooms are private (invite-only) by default. A room owner may publish a listing to the relay’s `CollabDirectory` Durable Object:

- `GET /directory/rooms?q=&tag=&limit=` — search live listings
- `POST /directory/rooms` — publish a signed listing (Ed25519, owner key pinned)
- `DELETE /directory/rooms/:roomId` — unlist (owner signature)

Listings expire unless re-published within 15 minutes (client heartbeat every 5 minutes). **A public listing carries the room invite (including the room key), so public rooms are not confidential.**


## Invite URI modes (v1 dual transport)

- `collab://join/<roomId>#<roomKey>` — default Cloudflare relay
- `collab://relay/<host>/join/<roomId>#<roomKey>` — explicit relay host
- `collab://lan/<host>:<port>/<roomId>#<roomKey>` — LAN relay (`ws://host:port/ws/<roomId>`)

New E2EE payload kinds: `member.config`, `approval.request`, `approval.response`, `mcp.call`, `mcp.result`.
