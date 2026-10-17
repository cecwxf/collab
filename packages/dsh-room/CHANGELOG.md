## 0.3.17

- Remove the standalone DSH Room sidebar entry and duplicate room-list dialog. Rooms live exclusively beneath their native workspace.
- Add Join room by invite and Browse public rooms to workspace menus, preselecting that workspace in each dialog.
- Preserve native workspace/session navigation, room edit/delete menus and collapsible member details in Web and Desktop.

## 0.3.16

- **Readable self bubbles**: Stop using `--dsw-alias-label-primary` as the outgoing message fill. That token is near-black text; `MarkdownText` also forces `label-primary` on descendants, so light UI showed solid black bars. Self bubbles now use `--dsw-specific-bubble` with `--rm-label` text (works in light and dark).

## 0.3.15

- npm `@cecwxf/dsh-room@0.3.15` ships the **0.3.14 workspace pin** work (`gitHead` `8391db1`). The light self-bubble CSS fix landed in git labeled 0.3.15 but was not published under that version — use **0.3.16** for the bubble fix.

## 0.3.14

- **Sidebar rooms under workspace**: Persist native `hostWorkspaceId` on create/join and match sidebar rows by that id (not only path), so created rooms stay under the correct workspace as session siblings.
- **Collapsed workspace**: Keep the room group visible while its room is selected (create/open no longer hides rooms under a collapsed header).
- **Path normalize**: Treat `/private/tmp` like `/tmp` (with existing `/private/var` ↔ `/var`).
- **Re-inject backup**: 1s poll alongside MutationObserver so React groupSection reconciles cannot leave rooms missing.

## 0.3.13

- **Workspace picker**: Create/Join select any native workspace (path-normalized match); welcome no longer hard-binds the first workspace.
- **Room persist in UI**: Create/Join upsert the room into the client list immediately so the chat does not flash EmptyMain before SSE.
- **Sidebar rooms**: Re-anchor the workspace room group as the first sibling under the workspace header after React reorders sessions (rooms stay first-level peers of sessions).
- **ensureWorkspace**: Match existing plugin workspaces with normalized paths (`/private/var` ↔ `/var`).

## 0.3.3

- **Create never blocks**: Local/relay create persists room + agents and returns immediately; host/agent joins run in the background. Create dialog can no longer stick on "Creating…".
- **`start()` no longer blocks the API**: rejoining saved rooms is backgrounded. A hung relay rejoin previously froze every `/api/collab` call — including Local-only create.
- Timeouts on history, announce, and connectAgents; stage logs on create.
- `GET /api/collab/version` and `state.version` so you can confirm the loaded plugin.
- Client create abort default 12s; Create dialog shows `dsh-room <version>`.
- Room view always lists configured local agents (even while joins are in flight).

## 0.3.2

- WsTransport connect timeout (8s); defer agent joins; UI AbortController + finally clear busy.

## 0.3.1

- Tabbed Create dialog; free-form Add agent.

## 0.3.0

- Local multi-agent rooms (loopback), orchestration, workspace isolation.
