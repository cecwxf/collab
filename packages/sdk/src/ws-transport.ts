import type { WireFrame } from "@collab/protocol";
import { encodeFrame, decodeFrame, splitNdjson } from "@collab/protocol";
import type { Transport, FrameHandler, CloseHandler } from "./transport.js";

/**
 * WebSocket transport using the global WebSocket (Node 22+ / browsers).
 * Talks NDJSON lines to the Cloudflare collab-relay Worker.
 */
export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private frameHandlers: FrameHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private buf = "";
  private _connected = false;

  constructor(readonly url: string) {}

  get connected() {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener("open", () => {
        this._connected = true;
        resolve();
      });
      ws.addEventListener("error", () => {
        reject(new Error(`WebSocket error connecting to ${this.url}`));
      });
      ws.addEventListener("message", (ev) => {
        const data = typeof ev.data === "string" ? ev.data : "";
        this.buf += data;
        const { lines, rest } = splitNdjson(this.buf);
        this.buf = rest;
        for (const line of lines) {
          try {
            const frame = decodeFrame(line);
            for (const h of this.frameHandlers) h(frame);
          } catch {
            // ignore malformed
          }
        }
      });
      ws.addEventListener("close", () => {
        this._connected = false;
        for (const h of this.closeHandlers) h("ws_closed");
      });
    });
  }

  send(frame: WireFrame): void {
    if (!this.ws || !this._connected) throw new Error("not connected");
    this.ws.send(encodeFrame(frame) + "\n");
  }

  onFrame(handler: FrameHandler): void {
    this.frameHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  close(reason = "closed"): void {
    this._connected = false;
    try {
      this.ws?.close(1000, reason);
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
