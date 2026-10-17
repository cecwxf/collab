# dsh room (@cecwxf/dsh-room)

DeepSeek Harness plugin **dsh room**, integrated beneath native workspaces, for Collab rooms: accountless, end-to-end encrypted, one-to-many agent collaboration over the default VPS Node relay (optional Cloudflare).


## Install in Web and Desktop

The same package supports **dsh web** and the official **DeepSeek Harness Desktop** (verified with both 0.2.0-rc.2 runtimes on macOS). Desktop uses the shared Web client, so `dsh.client.platform: web` is intentional; do not change it to `desktop`.

### Web

```sh
dsh plugin --profile web add @cecwxf/dsh-room@0.3.18
dsh web
```

Open the printed URL. Under your workspace, use **New room** or select an existing room. The workspace menu also offers **Join room by invite** and **Browse public rooms**.

### Desktop

Install `@cecwxf/dsh-room@0.3.18` through Desktop's plugin manager and restart the application. Web and Desktop have separate installation/activation graphs; installing into `web` does not install into `desktop`.

The npm-installed `dsh` command rejects `--profile desktop` with `profile "desktop" is managed exclusively by the Electron application`. For a command-line installation, launch Desktop once, fully quit it, and use **its bundled command**, not the npm CLI. For a macOS app in `/Applications`:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add @cecwxf/dsh-room@0.3.18
```

Reopen Desktop and select a room beneath its workspace, or use **New room** there. **Manage dsh Command…** in Desktop's application menu can register that bundled command on PATH.

Desktop owns its executable profile: the npm CLI cannot initialize or mutate that profile. See the [official Desktop installation rules](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime).

Version 0.3.9 fixes a client loader crash (`Cannot read properties of undefined (reading 'subscribe')`) by declaring the session service dependency and checking optional snapshot/subscription interfaces before use. Missing workspace state leaves native session rows visible.

After an upgrade, fully restart the relevant host. Web users may also need a hard refresh. `/api/collab/version` reports the loaded package version.

### Runtime data and concurrent use

Web retains its existing `~/.collab` data. Desktop defaults to `<DSH_HOME>/profiles/desktop/.collab` for identity, room state, agent identities and fallback workspace. This prevents two simultaneously running hosts from sharing one relay identity or overwriting the same room-state file. Explicit `identityPath`, `statePath`, and `workspacePath` always take precedence.

Earlier Desktop installs that used the legacy Web paths can retain their data by explicitly configuring those paths in the Desktop profile. Use distinct identity/state paths when running both hosts concurrently.

### Other package sources

```sh
dsh plugin --profile web add github:cecwxf/collab#master
dsh plugin --profile web add github:cecwxf/collab#path:packages/dsh-room
dsh plugin --profile web add /absolute/path/to/collab/packages/dsh-room
```

The same sources work with Desktop's bundled CLI and `--profile desktop`. Default relay: `ws://62.234.113.56:80`.

## What you get

- **DSH Room UI** in the Web and Desktop sidebar — create / join / search / chat / members / tasks.
- **`/collab` slash commands** in any interactive composer (Web / Desktop / TUI).
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

**Rooms live in your dsh workspaces** (0.2+): the native left-sidebar workspace list is untouched. Hover a workspace and click the room icon next to "New session", or open its "…" menu → **New room** (the menu also has **New session**). The wide Create room dialog opens with that workspace preset; the room's member config workspace, MCP sandbox and woken agent session all use that path, and the room's agent session nests under the workspace natively (marked with the room icon). The native sidebar groups rooms beneath their workspaces and local agent sessions beneath each room. The **DSH Room** panel shows the selected room; its Rooms switcher also offers Join by invite and Browse public rooms.

**Agent config** (per room, local): model, reasoning effort, workspace path, auto-allow flags, MCP on/off. Announced to peers without secrets.

**Approvals**: banner in Rooms when a peer MCP call needs write/shell/network permission.

**MCP tools**: `workspace_list`, `workspace_read`, `workspace_stat`, `workspace_search`, `workspace_write`, `workspace_mkdir`, `workspace_delete`, `workspace_exec`.

API: `GET/POST /api/collab/rooms/:id/config`, `POST /api/collab/rooms/:id/mcp`, `GET /api/collab/lan/browse`, `POST /api/collab/approvals/decide`.

### Remote workspace access (0.3.7, Web and Desktop)

Real model agents can call `collab_peers` to discover a hosting member with `mcpEnabled=true`, `collab_mcp_tools` to read the workspace tool schemas, then `collab_mcp_call` to execute a tool on that member. For example:

```json
{"roomId":"ROOM_ID","target":"HOST_MEMBER_AGENT_ID","tool":"workspace_read","args":{"path":"src/index.ts"}}
```

The tool waits for the completed response and returns `{callId,target,ok,result}` or `{callId,target,ok:false,error}`. It does not return a pending receipt. The authenticated calling agent's identity is used for peer grants. A read-only agent cannot request remote writes or execution. A local worker does not export an independent MCP workspace; target its hosting member to access the room's configured workspace. Paths are relative to that target's workspace, including when the caller runs on another machine. The VPS relay forwards encrypted payloads and does not read files.

The default deadline is 130 seconds (optional `timeoutMs`, maximum 130000), allowing the target's 120-second approval wait. Abort, agent removal, room disconnect/leave, transport changes and plugin unload settle outstanding response waits. A matching callId alone is insufficient: results must come from the authenticated target member. Full result content is returned to the calling tool; room history displays a summary marker rather than copying entire files into every agent's transcript. As with other room payloads, members holding the room key can decrypt the result on the transport.

`POST /api/collab/rooms/:id/mcp` with `target` now returns the completed remote result using the same mechanism. Without `target`, it runs on the local workspace. This is the plugin's MCP-over-room bridge, exposed as dsh model tools, rather than a standalone stdio MCP server.

`scripts/dsh-mcp-test-host.mjs` boots a disposable real Web or official Desktop host (`DSH_PLUGIN_SOURCE`, `DSH_MCP_CONTROL`, `DEEPSEEK_API_KEY`; optionally `DSH_DESKTOP_APP`). `scripts/e2e-dsh-mcp-real.mjs` accepts `DSH_MCP_EXPORTER` and `DSH_MCP_CALLER` control files to test unpredictable remote file contents, all four read tools, agent-specific permission revocation, traversal and symlink denial. For SSH forwarding, `DSH_MCP_CALLER_BASE` changes the test controller's HTTP address and `DSH_MCP_CALLER_RELAY_HOST` rewrites the invite's forwarded relay host for the caller. No key is saved in either profile; control files contain authentication cookies and must be kept private and removed after testing. `scripts/verify-mcp-session.mjs SESSION_FILE EVIDENCE_JSON` (requires `zstd`) checks the persisted model tool events: successful results for all four read tools, exact fixture content, correct relative paths, three expected denials, and no native file/shell tool usage.

## Models and validation (0.3.4)

Model selectors load the active dsh provider catalog and show its versioned names (for example `DeepSeek-V41-Flash`), while passing the catalog's exact provider/model IDs to sessions. Agents inherit the room model; rooms inherit the dsh selection. Changing a model resets the affected idle sessions. Stop running agents before changing their model or scope. Missing real agent services now produce a failed run; mock execution requires explicit `localAgentRunner: mock`.

Short `collab://join/...` invitations use the host's configured `relayUrl`; invitations specifying a LAN or relay host use that explicit address.

From the repository, run `npm test`, `npm run smoke`, and `npm run e2e:dsh:local` for offline/mock regression coverage. `DEEPSEEK_API_KEY=... npm run e2e:dsh:real` exercises real dsh sessions: agent create/edit/remove, coding task claim/completion, worktree diff/merge, executable code, review, and moderator delegation/summary. It uses an isolated dsh home and workspace, and makes paid model requests. Optional `DSH_PLUGIN_SOURCE` selects a packed npm tarball; `DSH_REAL_RELAY=1` uses a relay, with `DSH_TEST_RELAY` overriding the default URL. Credentials are inherited only through the child process environment.

For two running isolated real dsh hosts, `DSH_MAC_CONTROL=/path/mac.json DSH_VPS_CONTROL=/path/vps.json node scripts/e2e-dsh-cross-real.mjs` verifies Mac → VPS → Mac model cooperation. Each control file contains the authenticated API `base` and `cookie`; the Mac file also contains `roomId` and `invite`. Keep these files private and remove them after testing.

In 0.3.5, the composer has separate model and reasoning-effort controls. Each menu updates only its own setting, and the other menus close when opened.


For an installed official Desktop app, run the same real-provider suite against its actual Electron shell and bundled host:

```sh
# DEEPSEEK_API_KEY must be present in the process environment.
DSH_DESKTOP_APP="/Applications/DeepSeek Harness.app" npm run e2e:dsh:real
```

On Windows, pass the installed `DeepSeek Harness.exe` path. The script initializes a disposable Desktop profile, quits before installing with its bundled CLI, restarts the actual app, and checks real sessions plus per-profile default storage. It does not alter the ordinary Desktop profile. Windows execution is supported by the harness path adapter but has not been run in this macOS validation.

## Native workspace navigation and previews (0.3.8)

The permanent Rooms navigation column is removed. Rooms are collapsible groups directly below the native workspace; click the room to see the shared conversation, or a local agent to open its actual dsh session. A room's host session, when present, also stays inside its group. Members, tasks, runs, permissions and merge controls are in a details panel that starts closed and can be toggled from the header. The native session catalog, search, flat view and original rows remain available; unloading the plugin restores their regular presentation. Workspace New room controls also work with Chinese dsh labels.

Room chat and task results use dsh's native Markdown renderer for headings, tables, code, math and file links. Local output links open dsh's native preview in the owning session. For a writing agent, the file is resolved in its worktree first, then in the shared workspace: an unmerged HTML report, Markdown document or image can be viewed before deciding whether to merge. Review & merge file chips are preview buttons too. Clicking a preview switches to the author's native conversation and opens the existing right-side preview; click the room in the workspace tree to return to the shared conversation. File inspection neither starts a model turn nor creates a branch; only verified local files become inline-code file links. Remote member files require a local copy before using the local native preview.

The host APIs `POST /api/collab/rooms/:id/session`, `/preview`, and `/files` reuse the dsh connection fence. File resolution checks real paths against the room workspace and its owned agent worktree, rejecting outside links. Session navigation cancels stale preview responses. Reasoning labels display the effective inherited effort separately from the model name.

Validation: `DSH_PREVIEW_HOST=/private/control.json DSH_PREVIEW_CONTROL=/private/ui-control.json DSH_PREVIEW_EVIDENCE=/path/evidence.json node scripts/e2e-dsh-preview-real.mjs` asks a real DeepSeek agent to produce HTML, Markdown and SVG in an unmerged worktree and verifies native-session/file resolution and boundary rejection. The disposable host utility described above provides the private control file. UI interaction was verified in Safari Web and the official macOS Desktop 0.2.0-rc.2, including actual HTML/Markdown/image previews. Workspace groups use owned DOM decorations because that dsh version has no workspace-child extension seat; dsh upgrades should rerun the sidebar integration tests. Preview navigation itself uses the public `uiWorkspace` and `sidebarRight` services.

## Connection recovery (0.3.10)

Offline rooms allow draft editing and show the connection error plus **Retry connection**; Send and Enter submissions wait until the room is online. Drafts survive reconnects. Local agent cards distinguish connecting/online/offline and show their join error; **Retry offline agents** retries failed member connections.

A pending host client stays owned after the first join fails, so reconnect and plugin disposal can manage it. Every host reconnect also joins agents added while offline. Selecting the current transport retries its connection instead of returning a no-op. These changes share the Web/Desktop client and backend.

The Node host uses the package's `ws` implementation for relay sockets, avoiding incompatibilities between Node's built-in WebSocket and dsh's process-wide HTTP dispatcher. The SDK still defaults to the browser/global WebSocket, and accepts an explicit constructor for Node hosts. Model HTTP requests retain dsh's existing network configuration.

`DSH_RECOVERY_HOSTS=/private/web-control.json,/private/desktop-control.json DSH_RECOVERY_EVIDENCE=/path/evidence.json node scripts/e2e-dsh-recovery-real.mjs` verifies an initial refused relay connection, agents added offline, automatic recovery, real Author/Reviewer model turns, native file preview, and VPS host/agent membership plus chat in both hosts.

Room headers provide **Edit room settings** for name, description and tags. Changes persist without replacing the room, agents or workspace; names are local labels, and owned public rooms also refresh their directory listing. The native workspace toolbar has a **New room** shortcut, and every expanded workspace has a visible **New room** row preselecting that workspace. Original native controls and rows remain owned by dsh and are restored on plugin unload.

Room rows provide an **⋯** menu with **Edit room** and **Delete room**. Deletion requires its confirmation dialog and removes the room from this host, stops its local tasks, disconnects hosted members and releases background session handles. Native conversation history and workspace/worktree files are retained, and remote hosts keep their membership. An owned public listing is unlisted as part of removal.

Version 0.3.11 also settles cancelled WebSocket connect promises and drains the old host join before changing transports, so an in-flight relay connection cannot block a switch to Local only.

Version 0.3.14 fixes native hostWorkspaceId pinning so created rooms stay under the correct workspace row (path-normalized fallback remains). 0.3.13 fixed workspace binding (any native workspace, path-normalized), keeps newly created rooms visible in the UI before SSE catch-up, and re-anchors sidebar rooms as first-level peers of sessions under each workspace. It also keeps configured local agents connected while idle, retries failed initial member joins automatically with bounded exponential backoff, and shows connecting during socket recovery. Rejoined members reannounce their configuration and clear stale errors. SDK reconnects continue until disposal rather than giving up after 51 failures. Removing a member, deleting its room, or switching transports cancels the owned retry timers. Model sessions stay deferred until a task wakes the agent; idle connectivity does not consume model turns.

## Workspace-only navigation (0.3.17)

Rooms are opened directly beneath their native workspace. The standalone **DSH Room** sidebar entry and duplicate room-list dialog have been removed. Use a workspace’s **New room** shortcut or its **…** menu to create a room, join by invite, or browse public rooms; all three actions preserve the selected workspace. Room row menus retain edit/delete, and members/settings remain collapsible inside the room. The same navigation is used in Web and Desktop.

Version 0.3.18 removes the persistent New room text row. Use the room icon in the workspace header or toolbar; its tooltip and accessible label identify the action.
