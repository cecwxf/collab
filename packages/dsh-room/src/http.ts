/**
 * Host API for the Rooms UI (same pattern as DeepSeekBot's /api/botharness/*):
 * same-origin JSON routes + one SSE stream on dsh's web server, every request
 * admitted through dsh's own connection fence (trusted host + browser auth cookie).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CollabBridge } from "./plugin.js";

export const API = "/api/collab";
const MAX_BODY = 64 * 1024;

export interface WebServerLike {
  register(route: { kind: "exact" | "prefix"; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void;
}
export interface ConnectionLike {
  requestRejection(req: IncomingMessage): number | undefined;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "content-type must be application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "body must be a JSON object");
  return v as Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : undefined);

function peerGrants(value: unknown) {
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "peerGrants must contain objects");
    return v as Record<string, unknown>;
  };
  const grants = (v: unknown) => {
    const input = object(v), out: Record<string, string> = {};
    for (const cap of ["read", "write", "exec", "delete"]) {
      if (!(cap in input)) continue;
      const grant = input[cap];
      if (grant !== "auto" && grant !== "ask" && grant !== "deny") throw new HttpError(400, `invalid peer grant for ${cap}`);
      out[cap] = grant;
    }
    return out;
  };
  const input = object(value);
  return {
    default: "default" in input ? grants(input.default) : {},
    byAgent: "byAgent" in input ? Object.fromEntries(Object.entries(object(input.byAgent)).map(([id, v]) => [id, grants(v)])) : {},
  };
}

/** Pure router so tests can drive it without a dsh web server. */
export function createApiHandler(bridge: CollabBridge, connection: () => ConnectionLike | undefined) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const conn = connection();
    const rejection = conn ? conn.requestRejection(req) : 403;
    if (rejection !== undefined) {
      res.statusCode = rejection;
      res.end();
      return;
    }
    const url = new URL(String(req.url), "http://localhost");
    const path = url.pathname.slice(API.length) || "/";
    const method = req.method ?? "GET";
    try {
      await bridge.start();
      if (method === "GET" && path === "/stream") return stream(bridge, req, res);
      if (method === "GET" && path === "/state") return sendJson(res, 200, bridge.state());
      if (method === "GET" && path === "/version") return sendJson(res, 200, { name: "@cecwxf/dsh-room", version: (bridge.state() as { version?: string }).version ?? "unknown" });
      if (method === "GET" && path === "/directory") return sendJson(res, 200, { rooms: await bridge.search(str(url.searchParams.get("q")), str(url.searchParams.get("tag"))) });
      if (method === "POST" && path === "/rooms") {
        const b = await readJson(req);
        return sendJson(res, 200, await bridge.createRoom({ name: str(b.name), description: str(b.description), tags: strs(b.tags), public: b.public === true, mode: b.mode === "relay" ? "relay" : "lan", lanHostPort: typeof b.lanHostPort === "string" ? b.lanHostPort.trim() : undefined, workspaceId: str(b.workspaceId), workspacePath: str(b.workspacePath), workspaceName: str(b.workspaceName), localOnly: b.localOnly === true, agents: Array.isArray(b.agents) ? b.agents as never : undefined, turnLimit: typeof b.turnLimit === "number" ? b.turnLimit : undefined, concurrency: typeof b.concurrency === "number" ? b.concurrency : undefined, isolation: typeof b.isolation === "string" ? b.isolation as never : undefined }));
      }
      if (method === "GET" && path === "/presets") return sendJson(res, 200, { presets: bridge.presets() });
      if (method === "POST" && path === "/join") {
        const b = await readJson(req);
        const invite = str(b.invite);
        if (!invite || !/^collab:\/\/(join|lan|relay)\//.test(invite) || !/#\S+$/.test(invite)) throw new HttpError(400, "invite must be collab://join/…, collab://lan/…, or collab://relay/… with #key");
        return sendJson(res, 200, await bridge.joinInvite(invite, { name: str(b.name), description: str(b.description), tags: strs(b.tags), public: b.public === true, workspaceId: str(b.workspaceId), workspacePath: str(b.workspacePath), workspaceName: str(b.workspaceName) }));
      }
      const m = /^\/rooms\/([^/]+)\/(messages|invite|leave|delete|send|task|active)$/.exec(path);
      if (m) {
        const roomId = decodeURIComponent(m[1]!);
        const action = m[2]!;
        if (method === "GET" && action === "messages") return sendJson(res, 200, { roomId, messages: bridge.room(roomId).messages });
        if (method === "GET" && action === "invite") return sendJson(res, 200, { roomId, invite: bridge.room(roomId).meta.invite });
        if (method === "POST") {
          const b = await readJson(req);
          if (action === "leave" || action === "delete") return sendJson(res, 200, await bridge.leave(roomId));
          if (action === "active") return sendJson(res, 200, (bridge.setActive(roomId), { ok: true }));
          if (action === "send") {
            const t = str(b.text);
            if (!t) throw new HttpError(400, "text required");
            return sendJson(res, 200, await bridge.send(roomId, t, strs(b.mentions), str(b.replyTo)));
          }
          if (action === "task") {
            const title = str(b.title);
            if (!title) throw new HttpError(400, "title required");
            return sendJson(res, 200, await bridge.createTask(roomId, title, str(b.body), str(b.assignee)));
          }
        }
      }
            if (method === "GET" && path === "/workspaces") return sendJson(res, 200, { workspaces: bridge.listWorkspaces(), activeWorkspaceId: bridge.activeWorkspaceId });
      if (method === "POST" && path === "/workspaces") {
        const b = await readJson(req);
        return sendJson(res, 200, await bridge.ensureWorkspace({ name: str(b.name), path: str(b.path), id: str(b.id) }));
      }
      if (method === "POST" && path === "/workspaces/active") {
        const b = await readJson(req);
        const id = str(b.id);
        if (!id) throw new HttpError(400, "id required");
        return sendJson(res, 200, bridge.setActiveWorkspace(id));
      }
      const wsDel = /^\/workspaces\/([^/]+)$/.exec(path);
      if (wsDel && method === "POST" && url.searchParams.get("op") === "delete") {
        return sendJson(res, 200, await bridge.removeWorkspace(decodeURIComponent(wsDel[1]!)));
      }
      if (method === "GET" && path === "/lan/browse") return sendJson(res, 200, { peers: await bridge.browseLan(Number(url.searchParams.get("timeout") || 2500)) });
      if (method === "GET" && path === "/approvals") return sendJson(res, 200, { approvals: bridge.approvals.list() });
      if (method === "POST" && path === "/approvals/decide") {
        const b = await readJson(req);
        const id = str(b.requestId);
        const decision = b.decision === "allow" || b.decision === "deny" ? b.decision : null;
        if (!id || !decision) throw new HttpError(400, "requestId and decision=allow|deny required");
        return sendJson(res, 200, await bridge.decideApproval(id, decision));
      }
      // ── local multi-agent ──
      const agM = /^\/rooms\/([^/]+)\/agents(?:\/([^/]+))?$/.exec(path);
      if (agM && method === "POST") {
        const roomId = decodeURIComponent(agM[1]!);
        const b = await readJson(req);
        if (!agM[2]) return sendJson(res, 200, await bridge.addLocalAgent(roomId, b as Record<string, unknown> & { preset?: string }));
        const id = decodeURIComponent(agM[2]);
        if (url.searchParams.get("op") === "delete") return sendJson(res, 200, await bridge.removeLocalAgent(roomId, id));
        return sendJson(res, 200, await bridge.updateLocalAgent(roomId, id, b));
      }
      const lm = /^\/rooms\/([^/]+)\/(local|transport|reconnect|settings|stop|runs|diffs|merge|discard|session|preview|files)$/.exec(path);
      if (lm) {
        const roomId = decodeURIComponent(lm[1]!);
        const action = lm[2]!;
        if (method === "GET" && action === "runs") return sendJson(res, 200, { runs: bridge.scheduler.list(roomId) });
        if (method === "GET" && action === "diffs") return sendJson(res, 200, await bridge.agentDiffs(roomId));
        if (method === "POST") {
          const b = await readJson(req);
          if (action === "settings") {
            if (("name" in b && typeof b.name !== "string") || ("description" in b && typeof b.description !== "string") || ("tags" in b && (!Array.isArray(b.tags) || b.tags.some(t => typeof t !== "string")))) throw new HttpError(400, "invalid room settings");
            if (typeof b.name === "string" && (!b.name.trim() || b.name.trim().length > 60)) throw new HttpError(400, "room name must contain 1–60 characters");
            if (typeof b.description === "string" && b.description.trim().length > 280) throw new HttpError(400, "room description must be at most 280 characters");
            return sendJson(res, 200, await bridge.updateRoom(roomId, { name: typeof b.name === "string" ? b.name : undefined, description: typeof b.description === "string" ? b.description : undefined, tags: strs(b.tags) }));
          }
          if (action === "reconnect") return sendJson(res, 200, await bridge.reconnectRoom(roomId));
          if (action === "files") {
            if (!Array.isArray(b.paths) || b.paths.length > 50 || b.paths.some(p => typeof p !== "string" || p.length > 4096)) throw new HttpError(400, "up to 50 file paths required");
            return sendJson(res, 200, await bridge.inspectFiles(roomId, b.paths as string[], str(b.agentId)));
          }
          if (action === "session") {
            if (!str(b.agentId)) throw new HttpError(400, "agentId required");
            return sendJson(res, 200, await bridge.openAgentSession(roomId, str(b.agentId)!));
          }
          if (action === "preview") {
            if (!str(b.path)) throw new HttpError(400, "path required");
            return sendJson(res, 200, await bridge.previewFile(roomId, str(b.path)!, str(b.agentId)));
          }
          if (action === "local") {
            const patch: Record<string, unknown> = {};
            if (typeof b.turnLimit === "number") patch.turnLimit = b.turnLimit;
            if (typeof b.concurrency === "number") patch.concurrency = b.concurrency;
            if (typeof b.isolation === "string") patch.isolation = b.isolation;
            return sendJson(res, 200, await bridge.updateLocalSettings(roomId, patch));
          }
          if (action === "transport") {
            const target = b.target === "local" || b.target === "relay" || b.target === "lan" ? b.target : null;
            if (!target) throw new HttpError(400, "target must be local|relay|lan");
            return sendJson(res, 200, await bridge.setTransport(roomId, target, b.force === true));
          }
          if (action === "stop") return sendJson(res, 200, bridge.stopLocal(roomId, str(b.agentId)));
          const agentId = str(b.agentId);
          if (!agentId) throw new HttpError(400, "agentId required");
          // Merge/discard change the user's main workspace: the UI sends approve=true only from an explicit confirm.
          if (action === "merge") return sendJson(res, 200, await bridge.mergeAgent(roomId, agentId, b.approve === true));
          if (action === "discard") return sendJson(res, 200, await bridge.discardAgent(roomId, agentId, b.approve === true));
        }
      }
      const cfgM = /^\/rooms\/([^/]+)\/(config|mcp)$/.exec(path);
      if (cfgM) {
        const roomId = decodeURIComponent(cfgM[1]!);
        const action = cfgM[2]!;
        if (method === "GET" && action === "config") return sendJson(res, 200, bridge.getMemberConfig(roomId));
        if (method === "POST" && action === "config") {
          const b = await readJson(req);
          const patch: Record<string, unknown> = {};
          for (const k of ["model", "provider", "reasoningEffort", "workspacePath", "workspaceLabel", "mcpEnabled"] as const) {
            if (k in b) patch[k] = b[k];
          }
          if (b.permissions && typeof b.permissions === "object") patch.permissions = b.permissions;
          if ("peerGrants" in b) patch.peerGrants = peerGrants(b.peerGrants);
          return sendJson(res, 200, await bridge.updateMemberConfig(roomId, patch as any));
        }
        if (method === "GET" && action === "mcp") return sendJson(res, 200, { tools: (await import("./mcp-workspace.js")).MCP_TOOL_DEFS });
        if (method === "POST" && action === "mcp") {
          const b = await readJson(req);
          const tool = str(b.tool);
          if (!tool) throw new HttpError(400, "tool required");
          if (str(b.target)) {
            const controller = new AbortController();
            const close = () => { if (!res.writableEnded) controller.abort(); };
            res.on("close", close);
            try {
              return sendJson(res, 200, await bridge.mcpCallPeer(roomId, str(b.target)!, tool, (b.args as Record<string, unknown>) || {}, { signal: controller.signal, timeoutMs: b.timeoutMs as number | undefined }));
            } finally { res.off("close", close); }
          }
          return sendJson(res, 200, { ok: true, result: await bridge.callLocalMcp(roomId, tool, (b.args as Record<string, unknown>) || {}) });
        }
      }
      throw new HttpError(404, `no route ${method} ${API}${path}`);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : /not in room|not in a collab room|no local agent|file not found/.test((e as Error).message) ? 404 : /needs explicit approval|peer grant deny|^denied:|path escapes room workspace/.test((e as Error).message) ? 403 : 500;
      if (!res.headersSent) sendJson(res, status, { error: (e as Error).message });
    }
  };
}

function stream(bridge: CollabBridge, req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  write("rooms", bridge.state());
  let pending: ReturnType<typeof setTimeout> | null = null;
  const off = bridge.subscribe((e) => {
    if (e.type === "message") write("message", { roomId: e.roomId, message: e.message });
    if (!pending)
      pending = setTimeout(() => {
        pending = null;
        write("rooms", bridge.state());
      }, 150);
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  const close = () => {
    off();
    clearInterval(ping);
    if (pending) clearTimeout(pending);
  };
  req.on("close", close);
  res.on("close", close);
}

export function registerRoutes(bridge: CollabBridge, webServer: WebServerLike, connection: () => ConnectionLike | undefined): () => void {
  return webServer.register({ kind: "prefix", path: API, handler: createApiHandler(bridge, connection) });
}
