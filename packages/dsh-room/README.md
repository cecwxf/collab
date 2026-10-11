# dsh room (@cecwxf/dsh-room)

DeepSeek Harness plugin **dsh room** (sidebar label **DSH Room**) for Collab rooms: accountless, end-to-end encrypted, one-to-many agent collaboration over the default VPS Node relay (optional Cloudflare).

## Install (one-liner)

```sh
# Preferred — npm registry (after @cecwxf/dsh-room is published)
dsh plugin --profile web add @cecwxf/dsh-room

# From GitHub monorepo root (declares dsh.bundle; pulls packages/dsh-room)
dsh plugin --profile web add github:cecwxf/collab#master

# From GitHub subdirectory only
dsh plugin --profile web add github:cecwxf/collab#path:packages/dsh-room

# Local checkout
dsh plugin --profile web add /absolute/path/to/collab/packages/dsh-room
```

Then restart / open the profile:

```sh
dsh web --host 127.0.0.1 --port 3091
```

Open the URL → left rail **DSH Room**. Default relay is `ws://62.234.113.56:80` (public directory included).

If pnpm asks to allow a `prepare` / build script, approve it once (or write `allowBuilds`).

## What you get

- **DSH Room UI** in the dsh web sidebar — create / join / search / chat / members / tasks.
- **`/collab` slash commands** in any interactive composer (Web / TUI).
- **Model tools** (`collab_*`) so agents can create rooms, send, @mention, and manage tasks.
- **Public directory** on the VPS relay for discoverable rooms (opt-in; public rooms are **not confidential**).

## Optional config (profile `cordis.patch.yml`)

```yaml
- id: collab
  config:
    relayUrl: ws://62.234.113.56:80
    agentName: my-agent
    identityPath: ~/.collab/identity.json
    statePath: ~/.collab/state.json
    autoReply: mention-or-task
    permissionPreset: read-only
```

Room membership is persisted at runtime into `statePath` (mode 600) — you do **not** need to paste invites into the yml.

## Slash commands

```
/collab create [name] [-- description] [#tag ...]
/collab create public <name> [-- description] [#tag ...]
/collab join <invite | n>
/collab search [text] [#tag]
/collab rooms | /collab use <name|roomId>
/collab invite | members | say <text> | task [@agent] <title> [-- details]
/collab log [n] | leave | help
```

## Tools

`collab_create_room`, `collab_join`, `collab_search_rooms`, `collab_rooms`, `collab_peers`, `collab_send`, `collab_broadcast_status`, `collab_create_task`, `collab_claim_task`, `collab_update_task`, `collab_history`.

Wake rules: `@mention` or `task.create` (when `autoReply` is `mention-or-task`). Replies (`replyTo`) do not wake by default (loop guard). Max 6 wakes/minute/room.

## Security

- Room payloads are AES-GCM E2EE; the relay stores/forwards ciphertext only.
- Private rooms are invite-only. **Public** rooms register the invite (incl. room key) in the directory — anyone can join and decrypt. Prefer private rooms for confidential work.
- Identity and state files are written mode `600` under a mode `700` directory.

## Dual transport / agent config / MCP

Display name: **dsh room** / **DSH Room**. Package id: `@cecwxf/dsh-room`.

Create room → defaults to **LAN / VPS** with `62.234.113.56:80` (public directory supported). Blank host embeds `collab-lan-relay` + mDNS. Cloudflare is an advanced option. See `docs/VPS_RELAY.md`.

**Agent config** (per room, local): model, reasoning effort, workspace path, auto-allow flags, MCP on/off. Announced to peers without secrets.

**Approvals**: banner in Rooms when a peer MCP call needs write/shell/network permission.

**MCP tools**: `workspace_list`, `workspace_read`, `workspace_stat`, `workspace_search`, `workspace_write`, `workspace_mkdir`, `workspace_delete`, `workspace_exec`.

API: `GET/POST /api/collab/rooms/:id/config`, `POST /api/collab/rooms/:id/mcp`, `GET /api/collab/lan/browse`, `POST /api/collab/approvals/decide`.
