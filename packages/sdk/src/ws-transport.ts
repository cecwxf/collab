import type { WireFrame } from "@collab/protocol";
import { encodeFrame, decodeFrame, splitNdjson } from "@collab/protocol";
import type { Transport, FrameHandler, CloseHandler } from "./transport.js";

/**
 * WebSocket transport using the global WebSocket (Node 22+ / browsers).
 * Talks NDJSON lines to the Collab relay (CF or LAN).
 * Reconnect-safe: each connect() replaces the prior socket once.
 */
export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private frameHandlers: FrameHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private buf = "";
  private _connected = false;
  private generation = 0;

  constructor(readonly url: string, private readonly Socket: typeof WebSocket = globalThis.WebSocket) {}

  get connected() {
    return this._connected;
  }

  async connect(timeoutMs = 8_000): Promise<void> {
    if (this._connected && this.ws?.readyState === this.Socket.OPEN) return;
    // Drop any half-open socket before opening a new one
    this.teardownSocket();
    const gen = ++this.generation;
    await new Promise<void>((resolve, reject) => {
      const ws = new this.Socket(this.url);
      this.ws = ws;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled || gen !== this.generation) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          try { ws.close(1000, "connect-failed"); } catch { /* */ }
          if (this.ws === ws) { this.ws = null; this._connected = false; }
          reject(err);
        } else {
          this._connected = true;
          resolve();
        }
      };
      const timer = setTimeout(() => finish(new Error(`WebSocket connect timeout (${timeoutMs}ms) to ${this.url}`)), timeoutMs);
      ws.addEventListener("open", () => {
        if (gen !== this.generation) {
          try { ws.close(1000, "stale"); } catch { /* */ }
          return;
        }
        finish();
      });
      ws.addEventListener("error", () => {
        if (gen !== this.generation) return;
        if (!this._connected) finish(new Error(`WebSocket error connecting to ${this.url}`));
      });
      ws.addEventListener("message", (ev) => {
        if (gen !== this.generation) return;
        const data = typeof ev.data === "string" ? ev.data : "";
        this.buf += data;
        const { lines, rest } = splitNdjson(this.buf);
        this.buf = rest;
        for (const line of lines) {
          try {
            const frame = decodeFrame(line);
            for (const h of this.frameHandlers) h(frame);
          } catch {
            /* ignore malformed */
          }
        }
      });
      ws.addEventListener("close", () => {
        if (gen !== this.generation) return;
        this._connected = false;
        this.ws = null;
        for (const h of this.closeHandlers) h("ws_closed");
      });
    });
  }

  private teardownSocket() {
    const ws = this.ws;
    this.ws = null;
    this._connected = false;
    this.buf = "";
    if (!ws) return;
    try {
      ws.close(1000, "reconnect");
    } catch {
      /* */
    }
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

  close(_reason = "closed"): void {
    this.generation++;
    this.teardownSocket();
  }
}
