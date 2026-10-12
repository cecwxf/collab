# Local multi-agent rooms (dsh-room 0.3)

One dsh can host **several local agents** in a room. Each local agent is an
independent room member: it has its own Ed25519 identity, its own dsh session, its own
workspace scope. Remote peers just see more members. Older peers (0.2) stay
compatible because the protocol is unchanged. Extra fields on `member.config`
(`displayName`, `persona`, `hostedBy`, `scope`, `moderator`) are optional.

```
            ┌───────────────────────── one dsh ─────────────────────────┐
 human ───▶ │ host member (box-dsh) ── router ──▶ run queue (cap N)      │
            │      │                    │            ├─ Moderator session│
            │      │  loopback hub      │            ├─ Coder session ──▶ git worktree room/<room>/coder
            │      └── or VPS / LAN ────┘            └─ Reviewer session │
            └───────────────────────────────────────────────────────────┘
                         ▲ E2EE relay (only when switched to Relay/LAN)
                   remote dsh / SDK members
```

## Create

- **UI**: *New room* (workspace row icon or DSH Room panel). Under **Local agents**,
  tick presets (Moderator, Architect, Coder, Reviewer). Turn on **Local only** for an
  in-process loopback room that never touches the network.
- **Slash**: `/collab create local <name>`, then `/collab agent add coder`, etc.
- **API**: `POST /api/collab/rooms {name, workspacePath, localOnly: true, agents: ["moderator","coder","reviewer"]}`

## Manage agents

Room panel, **Local agents**: add, edit, or remove agents. Each agent has a name and
persona, a system prompt, a model (default: dsh's current model), a reasoning effort,
a scope, and an approval setting.

- **Scope `read`** gives the agent a read-only session in the main workspace.
- **Scope `write`** gives the agent a workspace-write session. In a git repo it works
  in its own worktree.
- **Approval required** means every run waits for your approval before it starts.
- **Reasoning effort** is dropped automatically if the model rejects it. The session
  is recreated with the model's default effort, and the choice is remembered.

Every agent's session nests under the room's workspace in the native sidebar as
`room:<room> · <Agent>`, with the room/agent icon. Sessions are resumed after a dsh
restart.

Slash: `/collab agents`, `/collab agent add <preset|name>`, `/collab agent rm <name>`.

## Routing & safety

| Message | Who wakes |
|---|---|
| `@coder.xxxx …` (or `@coder` when unambiguous) | only that agent |
| `@all …` | every non-moderator local agent, in parallel (subject to the concurrency cap) |
| `@host-id …` | the host dsh session (as before) |
| task with assignee | the assignee |
| task without assignee | the moderator (if any), else all workers |
| plain chat / replies | nobody |

- **Moderator** (optional, one per room) splits a request into tasks with the normal
  task flow (`collab_create_task`, assignee = agent). When all its subtasks are
  done or failed, it is woken once more to post a summary.
- **Turn limit** (default 6) is a per-thread (task or reply chain) budget for wakes
  caused by agents. A human message resets it. When the limit is hit, the room says
  so once and stops.
- **Concurrency cap** (default 2): at most N runs are active per room, with at most
  one run per agent at a time. The rest wait in the visible **Runs** queue. Positions
  are shown, and each run is listed as approval, queued, running, done, failed or
  stopped.
- **Stop**: the header button, **Stop all agents**, `/collab stop [@agent]`, or
  `POST /rooms/:id/stop` cancels queued runs and interrupts running sessions.

## Workspace isolation

`isolation: auto` is the default.

- **Git repo**: each *writing* agent gets `.dsh-room/worktrees/<room>-<agent>` on
  branch `room/<room>-<id>/<agent>`. That path is excluded through `.git/info/exclude`,
  so the main repo stays clean. Whatever the agent leaves uncommitted is committed
  for it after each run. If an agent edits the main workspace outside its worktree,
  you get a warning in the room.
- **Not a git repo**: advisory file locks are used. Writers call
  `collab_lock_files` before editing. Peer MCP writes to a locked path are refused.
- You can also force `worktree`, `locks`, or `off` in the room panel.

**Review & merge** opens a per-agent diff view (files, +/-, unified patch). It runs a
conflict precheck with `git merge-tree` and checks for overlapping uncommitted
changes in the main workspace. **Merge into main** and **Discard** both ask for
explicit confirmation. A merge is `--no-ff` and is aborted cleanly on conflict, with
the conflicting files listed. After a merge, the agent branch is fast-forwarded to
main.

## Transport

- **Local only**: in-process loopback. History is kept on disk at
  `~/.collab/local-history/<room>.json`.
- **Relay (VPS)**: the default host is `62.234.113.56:80`. **LAN** uses the embedded
  relay and mDNS. Switching is one click (Room panel → Transport, or
  `/collab transport relay|lan|local`). Local agents reconnect as members on the new
  transport, and the room's history and tasks are kept.
- Switching back to Local only is refused while remote members are connected.
- When a remote member joins, every local agent's `member.config` is re-announced so
  the newcomer sees names and personas.

## HTTP API (under `/api/collab`)

`GET /presets` ·
`POST /rooms/:id/agents` (add) ·
`POST /rooms/:id/agents/:agentId` (patch; `?op=delete` removes) ·
`POST /rooms/:id/local` (`turnLimit`, `concurrency`, `isolation`) ·
`POST /rooms/:id/transport` (`target`) ·
`POST /rooms/:id/stop` ·
`GET /rooms/:id/runs` ·
`GET /rooms/:id/diffs` ·
`POST /rooms/:id/merge` / `discard` (`{agentId, approve:true}`)

## Testing without a model

Set `localAgentRunner: mock` in the plugin config, or `DSH_ROOM_MOCK_AGENTS=1`. Local
agents then answer from a deterministic mock runner: replies, task claims and updates,
a worktree write, and the moderator's plan and summary. The unit tests use this mode.

## Known limitations

- The host dsh does the routing. Local agents only act while that dsh is running.
- An agent session's cwd is the room workspace root, because dsh attaches sessions to
  a workspace only by exact cwd. Worktree agents are told to work under their
  worktree path, and edits outside it are detected and reported but not blocked.
- File locks for non-git workspaces are advisory. They bind agents that use
  `collab_lock_files` and peer MCP writes, not arbitrary shell commands.
- Model and scope are fixed per dsh session. Changing them starts a fresh session for
  that agent.
- A merge needs git ≥ 2.38 for the conflict precheck. Without it, conflicts are only
  reported when the merge runs.
