import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { LanRoom } from "./room.js";
import { advertiseLanRelay } from "./mdns.js";

export interface LanRelayOptions {
  host?: string;
  port?: number;
  /** Advertise via mDNS (_collab._tcp). Default true. */
  mdns?: boolean;
  name?: string;
  /** Optional: pin advertisement to one roomId (usually the host leaves this unset). */
  roomId?: string;
}

export class LanRelayServer {
  private rooms = new Map<string, LanRoom>();
  private http?: HttpServer;
  private wss?: WebSocketServer;
  private stopMdns?: () => void;
  port = 0;

  constructor(private opts: LanRelayOptions = {}) {}

  room(roomId: string): LanRoom {
    let r = this.rooms.get(roomId);
    if (!r) {
      r = new LanRoom(roomId);
      this.rooms.set(roomId, r);
    }
    return r;
  }

  async listen(): Promise<{ host: string; port: number }> {
    const host = this.opts.host ?? "0.0.0.0";
    const port = this.opts.port ?? 7421;
    this.http = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "collab-lan-relay", rooms: this.rooms.size }));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Collab LAN Relay\nWS: /ws/:roomId\nHealth: /health\nmDNS: _collab._tcp.local\n");
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on("upgrade", (req, socket, head) => {
      const m = /^\/ws\/([^/?#]+)/.exec(req.url ?? "");
      if (!m) {
        socket.destroy();
        return;
      }
      const roomId = decodeURIComponent(m[1]!);
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.room(roomId).attach(ws);
      });
    });
    await new Promise<void>((resolve) => this.http!.listen(port, host, resolve));
    const addr = this.http.address();
    this.port = typeof addr === "object" && addr ? addr.port : port;
    if (this.opts.mdns !== false) {
      this.stopMdns = advertiseLanRelay({ port: this.port, name: this.opts.name, roomId: this.opts.roomId });
    }
    return { host, port: this.port };
  }

  async close() {
    this.stopMdns?.();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.http?.close(() => resolve()));
  }
}
