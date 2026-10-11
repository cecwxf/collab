// src/mcp-workspace.ts
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
var MCP_TOOL_DEFS = [
  { name: "workspace_list", description: "List files/dirs under a relative path in the member workspace.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path (default .)" } } } },
  { name: "workspace_read", description: "Read a UTF-8 text file (max 256 KiB).", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "workspace_stat", description: "Stat a path (size, mtime, type).", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "workspace_search", description: "Search file contents for a substring (simple, max 50 hits).", inputSchema: { type: "object", properties: { query: { type: "string" }, path: { type: "string" } }, required: ["query"] } },
  { name: "workspace_write", description: "Write/overwrite a UTF-8 file (requires approval unless autoWrite).", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "workspace_mkdir", description: "Create a directory (requires approval unless autoWrite).", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "workspace_delete", description: "Delete a file or empty dir (requires approval unless autoWrite).", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "workspace_exec", description: "Run a shell command with cwd=workspace (requires approval unless autoShell). No network unless autoNetwork.", inputSchema: { type: "object", properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["command"] } }
];
function actionFor(tool) {
  if (tool === "workspace_write" || tool === "workspace_mkdir") return "fs.write";
  if (tool === "workspace_delete") return "fs.delete";
  if (tool === "workspace_exec") return "shell.exec";
  return null;
}
var WorkspaceMcp = class {
  constructor(cfg, approvals, roomId) {
    this.cfg = cfg;
    this.approvals = approvals;
    this.roomId = roomId;
  }
  updateConfig(cfg) {
    this.cfg = cfg;
  }
  tools() {
    return MCP_TOOL_DEFS;
  }
  async resolveSafe(rel) {
    const root = resolve(this.cfg.workspacePath);
    const target = resolve(root, rel || ".");
    const relToRoot = relative(root, target);
    if (relToRoot.startsWith("..") || relToRoot.includes(`..${sep}`)) throw new Error("path escapes workspace");
    try {
      const { realpath } = await import("node:fs/promises");
      const real = await realpath(target).catch(() => target);
      const realRoot = await realpath(root).catch(() => root);
      if (!real.startsWith(realRoot + sep) && real !== realRoot) throw new Error("path escapes workspace (symlink)");
    } catch (e) {
      if (e.message.includes("escapes")) throw e;
    }
    return target;
  }
  async maybeApprove(tool, summary, detail, from) {
    const action = actionFor(tool);
    if (!action) return;
    const p = this.cfg.permissions;
    if (action === "fs.write" || action === "fs.delete") {
      if (p.autoWrite) return;
    } else if (action === "shell.exec") {
      if (p.autoShell) return;
    } else if (action === "network.fetch") {
      if (p.autoNetwork) return;
    }
    const decision = await this.approvals.request({
      roomId: this.roomId,
      action,
      summary,
      detail,
      from,
      timeoutMs: 12e4
    });
    if (decision !== "allow") throw new Error(`denied: ${action} (${summary})`);
  }
  async call(tool, args, from) {
    if (!this.cfg.mcpEnabled) throw new Error("MCP disabled for this member");
    await mkdir(this.cfg.workspacePath, { recursive: true });
    switch (tool) {
      case "workspace_list": {
        const dir = await this.resolveSafe(String(args.path ?? "."));
        const entries = await readdir(dir, { withFileTypes: true });
        return {
          path: relative(this.cfg.workspacePath, dir) || ".",
          entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }))
        };
      }
      case "workspace_read": {
        if (!this.cfg.permissions.autoRead) await this.maybeApprove("workspace_read", `read ${args.path}`, "", from);
        const file = await this.resolveSafe(String(args.path ?? ""));
        const buf = await readFile(file);
        if (buf.length > 256 * 1024) throw new Error("file too large (>256KiB)");
        return { path: String(args.path), content: buf.toString("utf8") };
      }
      case "workspace_stat": {
        const file = await this.resolveSafe(String(args.path ?? ""));
        const st = await stat(file);
        return { path: String(args.path), size: st.size, mtimeMs: st.mtimeMs, isDirectory: st.isDirectory(), isFile: st.isFile() };
      }
      case "workspace_search": {
        const q = String(args.query ?? "");
        if (!q) throw new Error("query required");
        const start = await this.resolveSafe(String(args.path ?? "."));
        const hits = [];
        const walk = async (dir) => {
          if (hits.length >= 50) return;
          const entries = await readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            if (hits.length >= 50) return;
            const p = join(dir, e.name);
            if (e.isDirectory()) {
              if (e.name === "node_modules" || e.name === ".git") continue;
              await walk(p);
            } else if (e.isFile()) {
              try {
                const st = await stat(p);
                if (st.size > 128 * 1024) continue;
                const text = await readFile(p, "utf8");
                const lines = text.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(q)) {
                    hits.push({ path: relative(this.cfg.workspacePath, p), line: i + 1, text: lines[i].slice(0, 200) });
                    if (hits.length >= 50) return;
                  }
                }
              } catch {
              }
            }
          }
        };
        await walk(start);
        return { query: q, hits };
      }
      case "workspace_write": {
        await this.maybeApprove("workspace_write", `write ${args.path}`, String(args.content ?? "").slice(0, 200), from);
        const file = await this.resolveSafe(String(args.path ?? ""));
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, String(args.content ?? ""), "utf8");
        return { ok: true, path: String(args.path) };
      }
      case "workspace_mkdir": {
        await this.maybeApprove("workspace_mkdir", `mkdir ${args.path}`, "", from);
        const dir = await this.resolveSafe(String(args.path ?? ""));
        await mkdir(dir, { recursive: true });
        return { ok: true, path: String(args.path) };
      }
      case "workspace_delete": {
        await this.maybeApprove("workspace_delete", `delete ${args.path}`, "", from);
        const file = await this.resolveSafe(String(args.path ?? ""));
        await rm(file, { recursive: false, force: false });
        return { ok: true, path: String(args.path) };
      }
      case "workspace_exec": {
        const command = String(args.command ?? "");
        if (!command) throw new Error("command required");
        const argv = Array.isArray(args.args) ? args.args.map(String) : [];
        await this.maybeApprove("workspace_exec", `exec ${command} ${argv.join(" ")}`.trim(), "", from);
        if (!this.cfg.permissions.autoNetwork) {
        }
        return await runCmd(command, argv, this.cfg.workspacePath);
      }
      default:
        throw new Error(`unknown MCP tool: ${tool}`);
    }
  }
};
function runCmd(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, env: { ...process.env, PATH: process.env.PATH } });
    let stdout = "";
    let stderr = "";
    const cap = 64 * 1024;
    child.stdout?.on("data", (d) => {
      if (stdout.length < cap) stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length < cap) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("exec timeout (30s)"));
    }, 3e4);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}
export {
  MCP_TOOL_DEFS,
  WorkspaceMcp
};
