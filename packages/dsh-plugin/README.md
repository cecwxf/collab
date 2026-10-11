# @collab/dsh-plugin (`dsh-collab`)

Cordis-style plugin for DeepSeek Harness. Registers collab tools and binds sessions as `collab:<roomId>`.

## Load

DeepSeek Harness does not need to be installed to **build** this package. To load it inside `dsh`:

1. Build: `npm run build -w @collab/dsh-plugin`
2. Point your profile `cordis.patch.yml` at `dist/index.js` (absolute path).
3. Config:

```yaml
dsh-collab:
  relayUrl: wss://collab-relay.cecwxf.workers.dev   # default, may be omitted
  autoReply: mention-or-task
  identityPath: ~/.collab/identity.json
```

4. Restart `dsh` / desktop profile that uses the official web UI.

## Tools

`collab_create_room`, `collab_join`, `collab_peers`, `collab_send`, `collab_broadcast_status`, `collab_create_task`, `collab_claim_task`, `collab_update_task`, `collab_history`

## Adapter

If Cordis service names differ, wrap host ctx:

```ts
import { applyDshCollab } from "@collab/dsh-plugin";
applyDshCollab({
  effect: (fn) => host.effect(fn),
  registerTool: (t) => host.tools.register(t),
  logger: console,
  config: { relayUrl: "wss://..." },
}, { config: { relayUrl: "wss://..." }, sessions: mySessionFactory });
```
