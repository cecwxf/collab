# Local validation for DSH Room

Requirements: Node.js 22+, npm, Git. The real-host integration also requires `dsh` on PATH (validated on macOS with Node 25.6.1 and dsh 0.2.0-rc.2).

```sh
npm ci
npm run build
npm test
npm run smoke
npm run e2e:dsh:local
```

`npm test` exercises encryption and invites, mock transport, localhost WebSocket transport and automatic reconnect, directory signatures, Cloudflare pure helpers, and the plugin's routing, scheduler, approvals, HTTP ACLs, Git isolation, state and history persistence.

`npm run e2e:dsh:local` installs this checkout into a disposable `DSH_HOME`, starts the real dsh web host on an OS-assigned localhost port, and uses its authenticated HTTP API. It creates three deterministic mock agents in a temporary Git workspace and checks:

- Unauthenticated API access is rejected and room creation returns promptly.
- `@all` wakes workers; the moderator creates subtasks and summarizes completion.
- The coder writes in its worktree; a diff is available and merging requires explicit approval.
- MCP writes wait for approval, HTTP config updates persist peer grants, and read denials are enforced.
- Stop clears pending agent approvals.
- A real dsh process restart restores room membership and acknowledged message history.

The script stops its dsh process and removes the disposable profile/workspace in `finally`. Auth tokens and room keys are not printed. It does not call a model or use the public relay. Source-level session cancellation is also tested through a controlled dsh agent interface.

Cloudflare tests cover TypeScript compilation and pure helpers, not the deployed Durable Object runtime. Real provider calls, provider-specific reasoning fallback, and cross-machine networking require separate integration runs.

## Regression areas

New regression tests cover symlinked roots and missing-file ancestors on macOS, peer ACL enforcement, approval reentrancy and cancellation, scheduler cleanup occupancy, merge/discard during Stop, Stop during session creation, zero finished-run queries, atomic ordered state writes, metadata restoration before reconnect, durable acknowledged local messages, reconnect catch-up, and encrypted sender/frame consistency.

The plugin ships a committed `dist` bundle. Rebuild it after changing sources so installs from GitHub and local profiles use the fixes.
