/**
 * mDNS discovery for Collab LAN relays.
 * Service type: _collab._tcp.local
 * TXT: roomId (optional room filter), name, proto=collab.v1, path=/ws
 *
 * Advertise: every LAN relay process announces its listen port.
 * Browse: clients query _collab._tcp.local and collect host:port (+ optional roomId/name).
 */
import mdns from "multicast-dns";
import { networkInterfaces } from "node:os";

export const MDNS_SERVICE = "_collab._tcp.local";

export interface LanPeer {
  host: string;
  port: number;
  name?: string;
  roomId?: string;
  hostPort: string;
}

function localIPv4(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out.length ? out : ["127.0.0.1"];
}

export function advertiseLanRelay(opts: { port: number; name?: string; roomId?: string }): () => void {
  const dns = mdns();
  const host = `collab-${opts.port}.local`;
  const txt: Record<string, string> = { proto: "collab.v1", path: "/ws" };
  if (opts.name) txt.name = opts.name;
  if (opts.roomId) txt.roomId = opts.roomId;
  const txtBuf = Buffer.from(Object.entries(txt).map(([k, v]) => `${k}=${v}`).join("\n"));

  const respond = () => {
    const ips = localIPv4();
    dns.respond({
      answers: [
        { name: MDNS_SERVICE, type: "PTR", ttl: 120, data: `${host}.${MDNS_SERVICE}` },
        {
          name: `${host}.${MDNS_SERVICE}`,
          type: "SRV",
          ttl: 120,
          data: { priority: 0, weight: 0, port: opts.port, target: host },
        },
        { name: `${host}.${MDNS_SERVICE}`, type: "TXT", ttl: 120, data: txtBuf },
        ...ips.map((ip) => ({ name: host, type: "A" as const, ttl: 120, data: ip })),
      ],
    });
  };

  dns.on("query", (q) => {
    const hit = (q.questions ?? []).some(
      (x) => x.name === MDNS_SERVICE || x.name?.endsWith(MDNS_SERVICE) || x.name === host,
    );
    if (hit) respond();
  });
  respond();
  const beat = setInterval(respond, 30_000);
  (beat as { unref?: () => void }).unref?.();
  return () => {
    clearInterval(beat);
    dns.destroy();
  };
}

export function browseLanRelays(opts?: { timeoutMs?: number; roomId?: string }): Promise<LanPeer[]> {
  const timeoutMs = opts?.timeoutMs ?? 2500;
  const dns = mdns();
  const found = new Map<string, LanPeer>();

  dns.on("response", (res) => {
    const answers = [...(res.answers ?? []), ...(res.additionals ?? [])];
    const srv = answers.filter((a) => a.type === "SRV");
    const txts = answers.filter((a) => a.type === "TXT");
    const as = answers.filter((a) => a.type === "A");
    for (const s of srv) {
      const data = s.data as { port?: number; target?: string } | undefined;
      if (!data?.port) continue;
      const name = String(s.name || "");
      if (!name.includes("_collab._tcp")) continue;
      const target = String(data.target || "");
      const a = as.find((x) => x.name === target || String(x.name) === target);
      const host = a ? String(a.data) : target.replace(/\.local$/, "");
      let roomId: string | undefined;
      let display: string | undefined;
      for (const t of txts) {
        const raw = t.data;
        const str = Buffer.isBuffer(raw) ? raw.toString("utf8") : Array.isArray(raw) ? raw.map(String).join("\n") : String(raw ?? "");
        for (const line of str.split(/\n|,/)) {
          const [k, ...rest] = line.split("=");
          const v = rest.join("=");
          if (k === "roomId") roomId = v;
          if (k === "name") display = v;
        }
      }
      if (opts?.roomId && roomId && roomId !== opts.roomId) continue;
      const hostPort = `${host}:${data.port}`;
      found.set(hostPort, { host, port: data.port, hostPort, roomId, name: display });
    }
  });

  dns.query({ questions: [{ name: MDNS_SERVICE, type: "PTR" }] });

  return new Promise((resolve) => {
    setTimeout(() => {
      dns.destroy();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
