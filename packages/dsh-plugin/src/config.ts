import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { DEFAULT_RELAY_URL } from "@collab/protocol";
import type { DshCollabConfig } from "./adapter.js";

const AUTO = new Set(["off", "mention", "mention-or-task"]);

function expand(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function normalizeConfig(raw: unknown): DshCollabConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim() : undefined);
  const autoReply = (str("autoReply") ?? "mention-or-task") as DshCollabConfig["autoReply"];
  if (!AUTO.has(autoReply)) throw new Error(`dsh-collab: autoReply must be off|mention|mention-or-task, got ${autoReply}`);
  const relayUrl = str("relayUrl") ?? DEFAULT_RELAY_URL;
  if (!/^wss?:\/\//.test(relayUrl)) throw new Error(`dsh-collab: relayUrl must be ws:// or wss://, got ${relayUrl}`);
  const workspacePath = expand(str("workspacePath") ?? "~/.collab/workspace");
  if (!isAbsolute(workspacePath)) throw new Error("dsh-collab: workspacePath must be absolute");
  return {
    relayUrl,
    invite: str("invite"),
    identityPath: expand(str("identityPath") ?? "~/.collab/identity.json"),
    agentName: str("agentName"),
    autoReply,
    workspacePath,
    agentPreset: str("agentPreset"),
    permissionPreset: str("permissionPreset") ?? "read-only",
    wakeOnReplies: r.wakeOnReplies === true,
    maxWakesPerMinute: typeof r.maxWakesPerMinute === "number" && r.maxWakesPerMinute > 0 ? Math.floor(r.maxWakesPerMinute) : 6,
  };
}

/**
 * Cordis accepts any Standard Schema v1 validator as `Config`
 * (cordis resolveConfig → Config["~standard"].validate). Hand-rolled so no schemastery import is needed.
 */
export const Config = {
  "~standard": {
    version: 1 as const,
    vendor: "dsh-collab",
    validate(value: unknown) {
      try {
        return { value: normalizeConfig(value) };
      } catch (e) {
        return { issues: [{ message: (e as Error).message }] };
      }
    },
  },
};
