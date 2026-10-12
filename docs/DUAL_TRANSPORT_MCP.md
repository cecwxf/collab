# Dual transport, member config, approvals, MCP

## Dual transport

| Mode | Invite | Wire |
|------|--------|------|
| **LAN / VPS** (default) | `collab://lan/<host>:<port>/<roomId>#<key>` | `ws://host:port/ws/<roomId>` (default VPS `62.234.113.56:80`) |
| **Cloudflare** (advanced) | `collab://join/<roomId>#<key>` or `collab://relay/<host>/join/<roomId>#<key>` | `wss://…/ws/<roomId>` (Cloudflare DO) |

Create-room UI defaults to **LAN / VPS** with host `62.234.113.56:80`. Blank host embeds `@collab/lan-relay` (port 7421, fallback ephemeral) + mDNS / Tailscale. Public directory search works on the VPS (and CF if you still use that relay).

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

Since 0.3.7, Web/Desktop model agents use `collab_peers` (discover an exporting host), `collab_mcp_tools` (schemas), and `collab_mcp_call` (target, tool, args). Calls authenticate as the invoking agent and await the actual structured result; concurrent results are correlated by callId and authenticated target identity. Target workspace paths are relative to the hosting member's configured root. Relay servers remain opaque forwarders. Local worker members advertise MCP disabled; choose their hosting member instead.

| Tool | Approval |
|------|----------|
| `workspace_list` | peer read grant; ask if not autoRead |
| `workspace_read` | peer read grant; ask if not autoRead |
| `workspace_stat` | peer read grant; ask if not autoRead |
| `workspace_search` | peer read grant; ask if not autoRead |
| `workspace_write` | unless `autoWrite` |
| `workspace_mkdir` | unless `autoWrite` |
| `workspace_delete` | unless `autoWrite` |
| `workspace_exec` | unless `autoShell` |

All paths sandboxed to the member's `workspacePath` (symlink escape rejected).

Peer `deny` grants override auto flags. Defaults allow reads automatically and ask for writes, deletion and execution. `workspace_read` returns UTF-8 text up to 256 KiB. Tool and HTTP remote calls return `{callId,target,ok,result}` or `{callId,target,ok:false,error}`; the default response deadline is 130 seconds, including approval time. Lifecycle changes and cancellation release local response waits; receiver deadlines and disconnects cancel pending approval waits. Result contents remain encrypted room payloads visible to room-key holders, but history keeps only a summary marker.

## CF redeploy

Not required: control-plane protocol unchanged; new payload kinds are E2EE (relay opaque).
