import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadOrCreateIdentity,
  type AutoReplyMode,
  type CollabPayload,
  newMessageId,
} from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";
import type {
  PluginContext,
  ToolDef,
  SessionFactory,
  DshCollabConfig,
} from "./adapter.js";

export interface PluginOptions {
  config: DshCollabConfig;
  /** Optional: bind rooms to harness sessions */
  sessions?: SessionFactory;
}

/**
 * Cordis-style apply function.
 *
 * Load in DeepSeek Harness (example cordis.patch.yml):
 *
 *   - id: dsh-collab
 *     path: /absolute/path/to/packages/dsh-plugin/dist/index.js
 *     config:
 *       relayUrl: wss://collab-relay.example.com
 *       autoReply: mention-or-task
 *
 * Or programmatically:
 *   import { applyDshCollab } from "@collab/dsh-plugin";
 *   applyDshCollab(ctx, { config: { relayUrl: "..." } });
 */
export function applyDshCollab(ctx: PluginContext, opts: PluginOptions): DshCollabService {
  const svc = new DshCollabService(ctx, opts);
  ctx.effect(() => () => {
    void svc.dispose();
  });
  for (const tool of svc.tools()) {
    if (ctx.registerTool) ctx.registerTool(tool);
  }
  ctx.logger?.info?.("[dsh-collab] loaded", opts.config.relayUrl);
  return svc;
}

/** Default export shape familiar to Cordis plugins */
export default {
  name: "dsh-collab",
  apply(ctx: PluginContext) {
    const raw = (ctx.config?.["dsh-collab"] ?? ctx.config ?? {}) as DshCollabConfig;
    if (!raw.relayUrl) {
      ctx.logger?.warn?.("[dsh-collab] relayUrl missing — plugin idle");
      return;
    }
    applyDshCollab(ctx, { config: raw });
  },
};

export class DshCollabService {
  private client: CollabClient | null = null;
  private inviteUri: string | null = null;
  private disposed = false;

  constructor(
    private ctx: PluginContext,
    private opts: PluginOptions,
  ) {}

  tools(): ToolDef[] {
    return [
      {
        name: "collab_create_room",
        description: "Create a new collab room and return an invite URI (share with other agents).",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => this.createRoom(),
      },
      {
        name: "collab_join",
        description: "Join a collab room via invite URI (collab://join/<roomId>#<roomKey>).",
        parameters: {
          type: "object",
          properties: {
            invite: { type: "string", description: "Invite URI" },
          },
          required: ["invite"],
        },
        execute: async (args) => this.join(String(args.invite)),
      },
      {
        name: "collab_peers",
        description: "List peers currently in the joined room.",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => this.peers(),
      },
      {
        name: "collab_send",
        description:
          "Send a chat message. Use mentions to @ a specific agentId so only they auto-reply.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
            mentions: {
              type: "array",
              items: { type: "string" },
              description: "agentIds to mention",
            },
          },
          required: ["text"],
        },
        execute: async (args) =>
          this.send(String(args.text), args.mentions as string[] | undefined),
      },
      {
        name: "collab_broadcast_status",
        description: "Broadcast a status line that does not trigger auto-reply.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        execute: async (args) => this.broadcastStatus(String(args.text)),
      },
      {
        name: "collab_create_task",
        description: "Create a task in the room (may wake idle agents with mention-or-task).",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            assignee: { type: "string" },
          },
          required: ["title"],
        },
        execute: async (args) =>
          this.createTask(String(args.title), {
            body: args.body ? String(args.body) : undefined,
            assignee: args.assignee ? String(args.assignee) : undefined,
          }),
      },
      {
        name: "collab_claim_task",
        description: "Claim a task by taskId.",
        parameters: {
          type: "object",
          properties: { taskId: { type: "string" } },
          required: ["taskId"],
        },
        execute: async (args) => this.claimTask(String(args.taskId)),
      },
      {
        name: "collab_update_task",
        description: "Update task status: open|claimed|done|failed|cancelled.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            status: { type: "string" },
            note: { type: "string" },
          },
          required: ["taskId", "status"],
        },
        execute: async (args) =>
          this.updateTask(
            String(args.taskId),
            String(args.status) as "open" | "claimed" | "done" | "failed" | "cancelled",
            args.note ? String(args.note) : undefined,
          ),
      },
      {
        name: "collab_history",
        description: "Fetch decrypted history from the relay ring buffer since a seq.",
        parameters: {
          type: "object",
          properties: { sinceSeq: { type: "number" } },
          required: [],
        },
        execute: async (args) =>
          this.history(typeof args.sinceSeq === "number" ? args.sinceSeq : 0),
      },
    ];
  }

  createRoom(): { roomId: string; roomKey: string; uri: string } {
    const room = CollabClient.createRoom();
    this.inviteUri = room.uri;
    return { roomId: room.roomId, roomKey: room.roomKeyB64, uri: room.uri };
  }

  async join(invite: string): Promise<{ agentId: string; peers: string[]; seq: number }> {
    if (this.client) await this.client.dispose();
    const parsed = CollabClient.parseInvite(invite);
    const identityPath =
      this.opts.config.identityPath ?? join(homedir(), ".collab", "identity.json");
    const identity = await loadOrCreateIdentity(identityPath);
    const base = this.opts.config.relayUrl.replace(/\/$/, "");
    const url = `${base}/ws/${encodeURIComponent(parsed.roomId)}`;
    const autoReply = (this.opts.config.autoReply ?? "mention-or-task") as AutoReplyMode;

    this.client = new CollabClient({
      identity,
      roomId: parsed.roomId,
      roomKey: parsed.roomKeyB64,
      transport: new WsTransport(url),
      autoReply,
      reconnect: true,
    });
    this.inviteUri = invite;

    this.client.onPayload((payload, meta) => {
      void this.onPayload(payload, meta);
    });

    await this.client.join();
    this.bindSession(parsed.roomId);

    return {
      agentId: identity.agentId,
      peers: this.client.getPeers().map((p) => p.agentId),
      seq: this.client.getSeq(),
    };
  }

  peers(): { agentIds: string[] } {
    this.requireClient();
    return { agentIds: this.client!.getPeers().map((p) => p.agentId) };
  }

  async send(text: string, mentions?: string[]) {
    this.requireClient();
    return this.client!.sendChat(text, mentions);
  }

  async broadcastStatus(text: string) {
    this.requireClient();
    return this.client!.sendStatus(text);
  }

  async createTask(title: string, opts?: { body?: string; assignee?: string }) {
    this.requireClient();
    return this.client!.createTask(title, opts);
  }

  async claimTask(taskId: string) {
    this.requireClient();
    return this.client!.claimTask(taskId);
  }

  async updateTask(
    taskId: string,
    status: "open" | "claimed" | "done" | "failed" | "cancelled",
    note?: string,
  ) {
    this.requireClient();
    return this.client!.updateTask(taskId, status, note);
  }

  async history(sinceSeq = 0) {
    this.requireClient();
    return this.client!.history(sinceSeq);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.client) {
      await this.client.dispose();
      this.client = null;
    }
  }

  private requireClient(): void {
    if (!this.client?.isJoined()) throw new Error("not joined — call collab_join first");
  }

  private bindSession(roomId: string): void {
    const sessions = this.opts.sessions;
    if (!sessions) return;
    const sid = `collab:${roomId}`;
    sessions.getOrCreate(sid);
    this.ctx.logger?.info?.("[dsh-collab] session bound", sid);
  }

  private async onPayload(
    payload: CollabPayload,
    meta: { seq: number; from: string },
  ): Promise<void> {
    if (!this.client || this.disposed) return;
    const wake = this.client.shouldWake(payload);
    this.ctx.logger?.info?.("[dsh-collab] payload", payload.kind, meta.from, "wake=", wake);

    const roomId = this.client.roomId;
    const sessions = this.opts.sessions;
    if (sessions) {
      const session = sessions.getOrCreate(`collab:${roomId}`);
      const text =
        payload.kind === "chat"
          ? payload.text
          : payload.kind === "task.create"
            ? `TASK ${payload.taskId}: ${payload.title}\n${payload.body ?? ""}`
            : `[${payload.kind}]`;
      await session.notify?.(text, { payload, meta, wake });
    }

    // If no session factory, still stream a stub ack when woken (headless demo)
    if (wake && !sessions) {
      const streamId = newMessageId();
      await this.client.streamReply(streamId, [
        `(auto) acknowledged ${payload.kind} from ${meta.from}`,
      ], payload.messageId);
    }
  }
}
