declare module "multicast-dns" {
  import { EventEmitter } from "node:events";
  interface Answer { name: string; type: string; ttl?: number; data?: unknown; class?: string; flush?: boolean }
  interface Query { questions?: { name: string; type: string }[] }
  interface Mdns extends EventEmitter {
    query(q: Query | string | string[]): void;
    respond(r: { answers?: Answer[]; additionals?: Answer[] }): void;
    destroy(): void;
    on(ev: "response", cb: (res: { answers?: Answer[]; additionals?: Answer[] }) => void): this;
    on(ev: "query", cb: (q: Query) => void): this;
  }
  export default function mdns(opts?: object): Mdns;
}
