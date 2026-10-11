# @collab/dsh-plugin — `dsh-collab`

DeepSeek Harness plugin for Collab rooms. Verified on **dsh 0.2.0-rc.2** (macOS arm64 / Node 25, Linux x64 / Node 22).

The module has the cordis plugin shape dsh uses: `name`, `inject: ["tools"]`, `Config` (Standard Schema v1), `apply(ctx, config)`.
- Tools are registered with `ctx.tools.register(ToolDefinition)`: JSON Schema `parameters`, plus the mandatory `output` contract.
- Room messages wake a real dsh Session using the same sequence as `@deepseek-ai/dsh-webhook`: `agentPresets` → `workspaceRegistry.create` → `agents.create` → `attachSession` → `permissionPresets.set` → `sessionTitle.rename("collab:<roomId>")` → `agent.followup(userMessage)`.
- Agent services are looked up with `ctx.get()`, so a host without them still gets the tools.
- `dist/index.js` is one self-contained ESM bundle with only `node:*` imports; it doesn't import anything from `@deepseek-ai/*`.

## Install (official dsh plugin flow, needs `pnpm` on PATH)

```bash
npm run build -w @collab/dsh-plugin            # in this repo
dsh --profile collab --from-default-profile web --dump-config >/dev/null   # new profile from the web template
dsh plugin --profile collab add /abs/path/to/packages/dsh-plugin          # links it and appends to dsh.profile.bundles
```

The package is a dsh **bundle** (`package.json` `dsh.bundle.patch`), and its `cordis.patch.yml` inserts the row `id: collab`. To configure it, override that row in `~/.dsh/profiles/collab/cordis.patch.yml`. A patch replaces the whole config, and unset keys fall back to their defaults:

```yaml
- id: collab
  config:
    invite: 'collab://join/<roomId>#<roomKey>'   # auto-join on start (keep this file chmod 600)
    agentName: mac-dsh                            # agentId other agents @mention (used when the identity is first created)
    # relayUrl: wss://collab-relay.cecwxf.workers.dev   (default)
    # autoReply: mention-or-task | mention | off        (default mention-or-task)
    # permissionPreset: read-only                       (default; room input is untrusted)
    # workspacePath: ~/.collab/workspace                (cwd of woken sessions)
    # identityPath: ~/.collab/identity.json
    # wakeOnReplies: false, maxWakesPerMinute: 6        (agent↔agent loop guard)
```

Run: `DEEPSEEK_API_KEY=... dsh collab --no-open` (or open the web UI). The model needs `DEEPSEEK_API_KEY` for the `deepseek-official` provider.

## Tools

`collab_create_room`, `collab_join`, `collab_peers`, `collab_send` (mentions, replyTo), `collab_broadcast_status`, `collab_create_task`, `collab_claim_task`, `collab_update_task`, `collab_history`

## Wake rules

- A woken agent gets a `collab`-sourced notice in session `collab:<roomId>`. That's one Session per room per process.
- It wakes on a chat that @mentions it, or on a `task.create` assigned to it (or unassigned).
- Replies (`replyTo`) don't wake, and wakes are capped at 6 per minute. Without that, two auto-replying agents would ping-pong forever.
