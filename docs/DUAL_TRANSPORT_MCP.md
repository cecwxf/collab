# Dual transport, member config, approvals, MCP

## Dual transport

| Mode | Invite | Wire |
|------|--------|------|
| **Relay** (default) | `collab://join/<roomId>#<key>` or `collab://relay/<host>/join/<roomId>#<key>` | `wss://…/ws/<roomId>` (Cloudflare DO) |
| **LAN** | `collab://lan/<host>:<port>/<roomId>#<key>` | `ws://host:port/ws/<roomId>` |

Create-room UI picks **Relay** or **LAN**. LAN starts an embedded `@collab/lan-relay` (port 7421, fallback ephemeral) and prefers a Tailscale `100.x` address when present.

### mDNS

LAN relay advertises `_collab._tcp.local` (TXT: `proto=collab.v1`, optional `name` / `roomId`).

- Host: `collab-lan-relay` or dsh plugin `ensureLanRelay()`
- Browse: `collab-lan-relay --browse` or `GET /api/collab/lan/browse`
- Manual / Tailscale: put `host:port` in the invite or the create dialog

Protocol on the wire is identical to CF (NDJSON ctrl + E2EE fwd). Room key never goes to any relay.

## Per-member agent config

Stored per room in `state.json` (`memberConfig`). Announced as E2EE `member.config` (model, provider, reasoningEffort, workspaceLabel, permissions, mcpTools). **Never includes API keys.**

UI: Rooms → About → **Agent config**. Approvals for writes/shell/network appear as a banner when peers (or local MCP) request them.

Defaults: `autoRead=true`, `autoWrite=false`, `autoShell=false`, `autoNetwork=false`.

## Built-in workspace MCP

Same-room members only (admission = invite/room key). Tools over the encrypted room channel (`mcp.call` / `mcp.result`) and locally via `POST /api/collab/rooms/:id/mcp`.

| Tool | Approval |
|------|----------|
| `workspace_list` | — |
| `workspace_read` | if `!autoRead` |
| `workspace_stat` | — |
| `workspace_search` | — |
| `workspace_write` | unless `autoWrite` |
| `workspace_mkdir` | unless `autoWrite` |
| `workspace_delete` | unless `autoWrite` |
| `workspace_exec` | unless `autoShell` |

All paths sandboxed to the member's `workspacePath` (symlink escape rejected).

## CF redeploy

Not required: control-plane protocol unchanged; new payload kinds are E2EE (relay opaque).
