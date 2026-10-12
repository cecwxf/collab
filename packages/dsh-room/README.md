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

## Local multi-agent rooms (0.3)

One dsh can host **several local agents** (Moderator, Architect, Coder, Reviewer, or custom ones) as independent room members. Each has its own identity, its own dsh session under the room's workspace, and its own read or write scope.

- **Create room** is a wide, tabbed dialog (Room / Agents / Limits) so transport, visibility, presets, custom agents, concurrency and turn limits are all reachable without clipping.
- **Local only** rooms use an in-process loopback (no network). One click switches to Relay (VPS) or LAN to invite remote hosts, and the local agents stay members.
- `@agent` wakes only that agent. `@all` wakes all local agents in parallel.
- After create, **Add agent** opens a free-form form (name, persona, system prompt, model, effort, scope, approval, moderator). Presets only fill the form.
- An optional **moderator** splits work into tasks and summarizes the results.
- A turn limit (default 6) applies per thread. A concurrency cap (default 2) comes with a visible run queue. **Stop** stops every local agent run.
- Writing agents get their own **git worktree** (`room/<room>/<agent>`). Non-git workspaces fall back to advisory file locks.
- **Review & merge** shows a per-agent diff, checks for conflicts, and asks you to confirm before it merges into or discards from the main workspace.

Slash commands: `/collab create local <name>`, `/collab agents`, `/collab agent add <preset|name>`, `/collab agent rm <name>`, `/collab stop [@agent]`, `/collab transport <local|relay|lan>`.

Full guide: [`docs/LOCAL_MULTI_AGENT.md`](../../docs/LOCAL_MULTI_AGENT.md).

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
    # localAgentRunner: mock   # deterministic local agents without a model (tests/demos); or env DSH_ROOM_MOCK_AGENTS=1
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

`collab_create_room`, `collab_join`, `collab_search_rooms`, `collab_rooms`, `collab_peers`, `collab_send`, `collab_broadcast_status`, `collab_create_task`, `collab_claim_task`, `collab_update_task`, `collab_history`, `collab_lock_files` (advisory locks for local writers in non-git workspaces).

Wake rules: `@mention` or `task.create` (when `autoReply` is `mention-or-task`). Replies (`replyTo`) do not wake by default (loop guard). Max 6 wakes/minute/room.

## Security

- Room payloads are AES-GCM E2EE; the relay stores/forwards ciphertext only.
- Private rooms are invite-only. **Public** rooms register the invite (incl. room key) in the directory — anyone can join and decrypt. Prefer private rooms for confidential work.
- Identity and state files are written mode `600` under a mode `700` directory.

## Dual transport / agent config / MCP

Display name: **dsh room** / **DSH Room**. Package id: `@cecwxf/dsh-room`.

Create room → defaults to **LAN / VPS** with `62.234.113.56:80` (public directory supported). Blank host embeds `collab-lan-relay` + mDNS. Cloudflare is an advanced option. See `docs/VPS_RELAY.md`.

**Rooms live in your dsh workspaces** (0.2+): the native left-sidebar workspace list is untouched. Hover a workspace and click the room icon next to "New session", or open its "…" menu → **New room** (the menu also has **New session**). The wide Create room dialog opens with that workspace preset; the room's member config workspace, MCP sandbox and woken agent session all use that path, and the room's agent session nests under the workspace natively (marked with the room icon). The **DSH Room** panel lists rooms grouped by workspace, with Join by invite and Browse public rooms.

**Agent config** (per room, local): model, reasoning effort, workspace path, auto-allow flags, MCP on/off. Announced to peers without secrets.

**Approvals**: banner in Rooms when a peer MCP call needs write/shell/network permission.

**MCP tools**: `workspace_list`, `workspace_read`, `workspace_stat`, `workspace_search`, `workspace_write`, `workspace_mkdir`, `workspace_delete`, `workspace_exec`.

API: `GET/POST /api/collab/rooms/:id/config`, `POST /api/collab/rooms/:id/mcp`, `GET /api/collab/lan/browse`, `POST /api/collab/approvals/decide`.
