/**
 * workspace/lawmind/mcp-servers.json — MCP client servers (LawMind consumes them).
 * Secrets are referenced only; values live in the OS keychain / env.
 */

import fs from "node:fs";
import path from "node:path";

export type McpTransport = "stdio" | "http";

export type McpServerRecord = {
  id: string;
  label: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  allowWrites: boolean;
  /** Keychain / env reference, e.g. mcp:<id> */
  secretRef?: string;
};

const FILE = "mcp-servers.json";

export function mcpServersConfigPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", FILE);
}

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;

export function sanitizeMcpServerId(raw: string): string | undefined {
  const id = raw.trim();
  return ID_RE.test(id) ? id : undefined;
}

export function mcpSecretEnvName(serverId: string): string {
  return `LAWMIND_MCP_${serverId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_SECRET`;
}

const FORBIDDEN_STDIO_COMMANDS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

const FORBIDDEN_STDIO_ARGS = new Set([
  "-c",
  "/c",
  "-Command",
  "-command",
  "-e",
  "--eval",
  "--execute",
]);

export function mcpStdioCommandError(command: string, args?: string[]): string | undefined {
  const base = path.basename(command.trim()).toLowerCase();
  if (!base) {
    return "stdio 需要 command。";
  }
  if (FORBIDDEN_STDIO_COMMANDS.has(base)) {
    return "不允许用系统壳作为外部对接命令。";
  }
  if ((args ?? []).some((a) => FORBIDDEN_STDIO_ARGS.has(a))) {
    return "不允许在启动参数里直接执行代码片段。";
  }
  return undefined;
}

export function normalizeMcpHttpUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "http 地址无效。" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "http 对接只允许 http 或 https。" };
  }
  return { ok: true, url: parsed.href };
}

export function resolveMcpSecret(record: McpServerRecord): string | undefined {
  const fromEnv = process.env[mcpSecretEnvName(record.id)]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (record.secretRef?.startsWith("env:")) {
    const name = record.secretRef.slice(4).trim();
    return name ? process.env[name]?.trim() : undefined;
  }
  return undefined;
}

function asRecord(raw: unknown): McpServerRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? sanitizeMcpServerId(o.id) : undefined;
  if (!id) {
    return undefined;
  }
  const transport = o.transport === "http" ? "http" : o.transport === "stdio" ? "stdio" : undefined;
  if (!transport) {
    return undefined;
  }
  const rec: McpServerRecord = {
    id,
    label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : id,
    transport,
    enabled: o.enabled === true,
    allowWrites: o.allowWrites === true,
  };
  if (typeof o.command === "string" && o.command.trim()) {
    rec.command = o.command.trim();
  }
  if (Array.isArray(o.args)) {
    rec.args = o.args.map((a) => String(a));
  }
  if (typeof o.url === "string" && o.url.trim()) {
    rec.url = o.url.trim();
  }
  if (typeof o.secretRef === "string" && o.secretRef.trim()) {
    rec.secretRef = o.secretRef.trim();
  }
  return rec;
}

export function readMcpServersConfig(workspaceDir: string): McpServerRecord[] {
  const abs = mcpServersConfigPath(workspaceDir);
  try {
    if (!fs.existsSync(abs)) {
      return [];
    }
    const j = JSON.parse(fs.readFileSync(abs, "utf8")) as { servers?: unknown };
    if (!Array.isArray(j.servers)) {
      return [];
    }
    const out: McpServerRecord[] = [];
    const seen = new Set<string>();
    for (const row of j.servers) {
      const rec = asRecord(row);
      if (!rec || seen.has(rec.id)) {
        continue;
      }
      seen.add(rec.id);
      out.push(rec);
    }
    return out;
  } catch {
    return [];
  }
}

export function writeMcpServersConfig(
  workspaceDir: string,
  servers: McpServerRecord[],
): { ok: true } | { ok: false; error: string } {
  const parsed: McpServerRecord[] = [];
  const seen = new Set<string>();
  for (const row of servers) {
    const rec = asRecord(row);
    if (!rec) {
      return { ok: false, error: "服务器配置无效（id / transport）。" };
    }
    if (seen.has(rec.id)) {
      return { ok: false, error: `重复的服务器 id：${rec.id}` };
    }
    if (rec.transport === "stdio") {
      if (!rec.command) {
        return { ok: false, error: `${rec.id}：stdio 需要 command。` };
      }
      const cmdErr = mcpStdioCommandError(rec.command, rec.args);
      if (cmdErr) {
        return { ok: false, error: `${rec.id}：${cmdErr}` };
      }
    }
    if (rec.transport === "http") {
      if (!rec.url) {
        return { ok: false, error: `${rec.id}：http 需要 url。` };
      }
      const url = normalizeMcpHttpUrl(rec.url);
      if (!url.ok) {
        return { ok: false, error: `${rec.id}：${url.error}` };
      }
      rec.url = url.url;
    }
    seen.add(rec.id);
    parsed.push(rec);
  }
  const abs = mcpServersConfigPath(workspaceDir);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify({ servers: parsed }, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
