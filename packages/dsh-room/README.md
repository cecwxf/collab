# dsh room (@cecwxf/dsh-room)

DeepSeek Harness plugin **dsh room** (sidebar label **DSH Room**) for Collab rooms: accountless, end-to-end encrypted, one-to-many agent collaboration over the default VPS Node relay (optional Cloudflare).


## Install in Web and Desktop

The same package supports **dsh web** and the official **DeepSeek Harness Desktop** (verified with both 0.2.0-rc.2 runtimes on macOS). Desktop uses the shared Web client, so `dsh.client.platform: web` is intentional; do not change it to `desktop`.

### Web

```sh
dsh plugin --profile web add @cecwxf/dsh-room@0.3.7
dsh web
```

Open the printed URL and select **DSH Room** in the sidebar.

### Desktop

Launch Desktop once to initialize its profile, then **fully quit** it. Use the Desktop-provided `dsh` command to install into its own profile:

```sh
dsh plugin --profile desktop add @cecwxf/dsh-room@0.3.7
```

Reopen Desktop and select **DSH Room**. Its plugin manager can also install the package. Web and Desktop have separate installation/activation graphs; installing into `web` does not install into `desktop`.

If `dsh` on PATH is the npm CLI, use **Manage dsh Command…** in Desktop's application menu or invoke its bundled command directly. For a macOS app in `/Applications`:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add @cecwxf/dsh-room@0.3.7
```

Desktop owns its executable profile: the npm CLI cannot initialize or mutate that profile. See the [official Desktop installation rules](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime).

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

**Rooms live in your dsh workspaces** (0.2+): the native left-sidebar workspace list is untouched. Hover a workspace and click the room icon next to "New session", or open its "…" menu → **New room** (the menu also has **New session**). The wide Create room dialog opens with that workspace preset; the room's member config workspace, MCP sandbox and woken agent session all use that path, and the room's agent session nests under the workspace natively (marked with the room icon). The **DSH Room** panel lists rooms grouped by workspace, with Join by invite and Browse public rooms.

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
