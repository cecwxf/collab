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
      if (method === "GET" && path === "/directory") return sendJson(res, 200, { rooms: await bridge.search(str(url.searchParams.get("q")), str(url.searchParams.get("tag"))) });
      if (method === "POST" && path === "/rooms") {
        const b = await readJson(req);
        return sendJson(res, 200, await bridge.createRoom({ name: str(b.name), description: str(b.description), tags: strs(b.tags), public: b.public === true, mode: b.mode === "lan" ? "lan" : "relay", lanHostPort: str(b.lanHostPort) }));
      }
      if (method === "POST" && path === "/join") {
        const b = await readJson(req);
        const invite = str(b.invite);
        if (!invite || !/^collab:\/\/(join|lan|relay)\//.test(invite) || !/#\S+$/.test(invite)) throw new HttpError(400, "invite must be collab://join/…, collab://lan/…, or collab://relay/… with #key");
        return sendJson(res, 200, await bridge.joinInvite(invite, { name: str(b.name), description: str(b.description), tags: strs(b.tags), public: b.public === true }));
      }
      const m = /^\/rooms\/([^/]+)\/(messages|invite|leave|send|task|active)$/.exec(path);
      if (m) {
        const roomId = decodeURIComponent(m[1]!);
        const action = m[2]!;
        if (method === "GET" && action === "messages") return sendJson(res, 200, { roomId, messages: bridge.room(roomId).messages });
        if (method === "GET" && action === "invite") return sendJson(res, 200, { roomId, invite: bridge.room(roomId).meta.invite });
        if (method === "POST") {
          const b = await readJson(req);
          if (action === "leave") return sendJson(res, 200, await bridge.leave(roomId));
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
      if (method === "GET" && path === "/lan/browse") return sendJson(res, 200, { peers: await bridge.browseLan(Number(url.searchParams.get("timeout") || 2500)) });
      if (method === "GET" && path === "/approvals") return sendJson(res, 200, { approvals: bridge.approvals.list() });
      if (method === "POST" && path === "/approvals/decide") {
        const b = await readJson(req);
        const id = str(b.requestId);
        const decision = b.decision === "allow" || b.decision === "deny" ? b.decision : null;
        if (!id || !decision) throw new HttpError(400, "requestId and decision=allow|deny required");
        return sendJson(res, 200, await bridge.decideApproval(id, decision));
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
          return sendJson(res, 200, await bridge.updateMemberConfig(roomId, patch as any));
        }
        if (method === "GET" && action === "mcp") return sendJson(res, 200, { tools: (await import("./mcp-workspace.js")).MCP_TOOL_DEFS });
        if (method === "POST" && action === "mcp") {
          const b = await readJson(req);
          const tool = str(b.tool);
          if (!tool) throw new HttpError(400, "tool required");
          if (str(b.target)) {
            return sendJson(res, 200, await bridge.mcpCallPeer(roomId, str(b.target)!, tool, (b.args as Record<string, unknown>) || {}));
          }
          return sendJson(res, 200, { ok: true, result: await bridge.callLocalMcp(roomId, tool, (b.args as Record<string, unknown>) || {}) });
        }
      }
      throw new HttpError(404, `no route ${method} ${API}${path}`);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : /not in room|not in a collab room/.test((e as Error).message) ? 404 : 500;
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
