# Cloudflare cost drivers (Collab relay)

## What bills

| Driver | When it happens | Expected |
|--------|-----------------|----------|
| **Room DO duration / requests** | Join, fwd, poll, peer left/joined, **mismatched pings** | Idle open sockets **hibernate**; auto-pong does **not** wake |
| **Room DO WebSocket** | Connected members | Billed while sockets exist; hibernation keeps CPU near zero between messages |
| **Directory DO** | Search (GET) + public-room publish heartbeat (POST) | Heartbeat every **5 min** per owned public room (`DIRECTORY_HEARTBEAT_MS`); TTL 15 min |
| **Worker requests** | `/ws/:roomId` upgrades, `/directory/*`, `/health` | Proportional to connects + directory traffic |

## What we deliberately avoid

- **No Durable Object `setAlarm` / server timers** in room or directory DOs — nothing wakes empty rooms on a schedule.
- **No server-driven ping** — clients ping only.
- **Client ping = 45s**, frame exactly `{"v":1,"type":"ctrl","method":"ping"}\n` so `setWebSocketAutoResponse` answers without waking the isolate.
- **Do not** add `roomId` / `agentId` to ping (that used to miss auto-response → **wake every 15s per client**).
- Reconnect uses exponential backoff + jitter (cap 30s) to limit storms.

## Safe ops checklist

1. After changing ping shape, keep `HIBERNATION_PING_LINE` / CF `WebSocketRequestResponsePair` byte-identical.
2. Prefer fewer public rooms (each owner heartbeat hits Directory DO).
3. Watch CF analytics for unexpected Room DO request spikes → usually reconnect storm or ping mismatch.

## Local-only (not CF)

- dsh-room `presenceTimer` (5s) and SSE keepalives are on the agent host, not Workers.
