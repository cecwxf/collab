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
