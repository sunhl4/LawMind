/**
 * Minimal MCP JSON-RPC client (newline stdio + HTTP JSON).
 * Speaks the same initialize / tools/list / tools/call as scripts/lawmind/mcp-readonly-server.ts.
 */

import readline from "node:readline";
import { createOutboundProxy } from "../platform/outbound-proxy.js";
import { buildMinimalChildEnv, safeCommand } from "../platform/safe-command.js";
import { normalizeMcpHttpUrl } from "./mcp-servers-config.js";

/** MCP child must not inherit model keys or workspace secrets. */
export function buildMcpChildEnv(extra?: NodeJS.ProcessEnv): Record<string, string> {
  return buildMinimalChildEnv(extra);
}

export type McpListedTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
  [key: string]: unknown;
};

export type McpSession = {
  listTools: () => Promise<McpListedTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpCallResult>;
  close: () => Promise<void>;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

function nextId(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export async function connectMcpStdio(opts: {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<McpSession> {
  // 统一命令网关：校验命令、参数、环境，禁用 shell，并记录 safe_command 审计。
  const handle = safeCommand({
    command: opts.command,
    args: opts.args,
    env: buildMcpChildEnv(opts.env),
    stdio: ["pipe", "pipe", "pipe"],
    timeoutMs: 0,
  });
  const child = handle.child;
  child.stderr?.resume();
  if (!child.stdout || !child.stdin) {
    handle.kill();
    throw new Error("stdio MCP 进程没有管道");
  }
  const pending = new Map<number, Pending>();
  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  rl.on("line", (line) => {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (msg.id == null) {
      return;
    }
    const wait = pending.get(Number(msg.id));
    if (!wait) {
      return;
    }
    pending.delete(Number(msg.id));
    if (msg.error) {
      wait.reject(new Error(msg.error.message ?? "MCP error"));
      return;
    }
    wait.resolve(msg.result);
  });
  const send = (method: string, params?: Record<string, unknown>, withId = true) => {
    const id = withId ? nextId() : undefined;
    const body = {
      jsonrpc: "2.0",
      method,
      ...(id != null ? { id } : {}),
      ...(params ? { params } : {}),
    };
    return new Promise<unknown>((resolve, reject) => {
      if (id != null) {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`MCP ${method} 超时`));
          }
        }, opts.timeoutMs ?? 12_000);
      }
      child.stdin?.write(`${JSON.stringify(body)}\n`);
      if (id == null) {
        resolve(undefined);
      }
    });
  };
  try {
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "lawmind", version: "0.2.0" },
    });
    await send("notifications/initialized", undefined, false);
  } catch (err) {
    rl.close();
    handle.kill();
    throw err;
  }

  return {
    async listTools() {
      const result = (await send("tools/list", {})) as { tools?: McpListedTool[] };
      return Array.isArray(result?.tools) ? result.tools : [];
    },
    async callTool(name, args) {
      return (await send("tools/call", { name, arguments: args })) as McpCallResult;
    },
    async close() {
      rl.close();
      handle.kill();
    },
  };
}

export async function connectMcpHttp(opts: {
  url: string;
  secret?: string;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
}): Promise<McpSession> {
  const url = normalizeMcpHttpUrl(opts.url, { allowInsecureHttp: opts.allowInsecureHttp === true });
  if (!url.ok) {
    throw new Error(url.error);
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.secret) {
    headers.authorization = `Bearer ${opts.secret}`;
  }
  // 统一出口代理：将 MCP HTTP 流量纳入审计与 SSRF 策略。
  const proxy = createOutboundProxy({
    allowInsecure: opts.allowInsecureHttp === true,
    requestTag: "mcp-http",
  });
  const rpc = async (method: string, params?: Record<string, unknown>) => {
    const id = nextId();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 12_000);
    try {
      const res = await proxy.fetch(url.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: ac.signal,
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) {
        throw new Error(json.error.message ?? "MCP HTTP error");
      }
      return json.result;
    } finally {
      clearTimeout(timer);
    }
  };
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "lawmind", version: "0.2.0" },
  });
  return {
    async listTools() {
      const result = (await rpc("tools/list", {})) as { tools?: McpListedTool[] };
      return Array.isArray(result?.tools) ? result.tools : [];
    },
    async callTool(name, args) {
      return (await rpc("tools/call", { name, arguments: args })) as McpCallResult;
    },
    async close() {
      /* http is stateless */
    },
  };
}

async function wrapSdkClient(client: {
  listTools: () => Promise<{ tools: McpListedTool[] }>;
  callTool: (args: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
}): Promise<McpSession> {
  return {
    async listTools() {
      const result = await client.listTools();
      return Array.isArray(result.tools) ? result.tools : [];
    },
    async callTool(name, args) {
      return (await client.callTool({ name, arguments: args })) as McpCallResult;
    },
    async close() {
      await client.close();
    },
  };
}

/** Official MCP framing (Content-Length). Used when newline JSON-RPC does not answer. */
export async function connectMcpStdioSdk(opts: {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<McpSession> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args ?? [],
    env: buildMcpChildEnv(opts.env),
  });
  const client = new Client({ name: "lawmind", version: "0.2.0" });
  await client.connect(transport);
  return wrapSdkClient(client);
}

export async function connectMcpHttpSdk(opts: {
  url: string;
  secret?: string;
  allowInsecureHttp?: boolean;
}): Promise<McpSession> {
  const url = normalizeMcpHttpUrl(opts.url, { allowInsecureHttp: opts.allowInsecureHttp === true });
  if (!url.ok) {
    throw new Error(url.error);
  }
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const headers: Record<string, string> = {};
  if (opts.secret) {
    headers.authorization = `Bearer ${opts.secret}`;
  }
  const proxy = createOutboundProxy({
    allowInsecure: opts.allowInsecureHttp === true,
    requestTag: "mcp-http-sdk",
  });
  const transport = new StreamableHTTPClientTransport(new URL(url.url), {
    requestInit: { headers },
    fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      proxy.fetch(input, init)) as typeof fetch,
  });
  const client = new Client({ name: "lawmind", version: "0.2.0" });
  await client.connect(transport);
  return wrapSdkClient(client);
}
