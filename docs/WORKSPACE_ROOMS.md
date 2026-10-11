# Workspace-first rooms

1. **Bind a workspace** — absolute local path (project folder). Sidebar shows it under DSH Room.
2. **Create / join rooms** inside that workspace. Room MCP sandbox and agent cwd default to the workspace path (`member.config`).
3. **Peers** join the room and bind *their* checkout of the same project (same logical workspace, local path may differ).
4. Rooms are collaboration channels (chat, tasks, @mentions) over Relay or LAN; E2EE unchanged.

Presence: peers stay listed as online for ~45s across reconnect/hibernation blips; room connection state is reflected in the header.

## Room composer (native-aligned)

Bottom bar mirrors DeepSeek Harness chat controls: **model + reasoning**, **auto-permissions**, and **Peer MCP** limits (per-peer read/write/exec/delete on this workspace). Send sits on the trailing edge like stock dsh.
