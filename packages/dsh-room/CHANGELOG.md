## 0.3.23

- Render per-agent execution cards inside Room chat: thinking/responding state, native tool names and completion/failure status, and streamed ordinary assistant answers.
- Keep completed cards in conversation history and restore them after restart, including signed Relay history. Normal answers no longer require collab_send; explicit messages and hand-offs still use it.
- Observe native tools/execute and tools/result without changing execution or approval behavior. Never broadcast raw reasoning, tool arguments/results, prompts or raw errors. Bound answer/tool history and coalesce live updates.
- Validate with 103 plugin tests, 13 protocol tests, 9 SDK tests, and real Mac Desktop 0.2.0-rc.2 agents using DeepSeek-V41-Flash: upgrade retains the Room/four agents, two agents read a fixture and answer without collab_send, and restart retains their answers/tool records. Windows was not directly exercised.

## 0.3.22

- Publish newly added agents as connecting before their asynchronous join, eliminating the initial offline snapshot.
- Preserve connecting in the execution strip and use the same connection state for member and local-agent indicators.
- Add a regression test covering every emitted snapshot during a delayed join, then the transition to online/idle.

## 0.3.21

- Show persistent per-agent execution state in chat, including queued/running and thinking/streaming/tool phases from dsh events.
- Schedule host wakes alongside worker runs, retain per-agent exclusion through cancellation, and refresh the queue immediately when limits change.
- Broadcast sender-bound execution metadata (never reasoning text); merge remote runs and legacy stream activity into SSE with expiry and replay ordering.
- Default concurrency, turn limit, and per-minute host wake limit to 0 (unlimited). Migrate legacy room defaults 2/6 once in state v4; preserve explicit positive caps thereafter.
- Route human messages without mentions to all workers, exclude moderators from implicit broadcasts, and keep unmentioned model replies non-waking.
- Include the pending workspace/sidebar and readable bubble fixes below.

## 0.3.20

- Simplify room connection choices to Local and Relay, with Local selected by default.
- Hide relay deployment names, IPs and ports from room setup; Relay uses host configuration. Existing invites and legacy LAN rooms remain compatible.

## 0.3.19

- Restore a visible workspace directory entry above the Room composer, with native workspace/session navigation and the original Add workspace directory flow.
- Align the message rail and composer width, padding and theme colors; preserve the full native composer in ordinary sessions.

## 0.3.18

- Remove the persistent New room text row beneath workspaces; creation stays available through compact header/toolbar icons and the workspace menu.

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
