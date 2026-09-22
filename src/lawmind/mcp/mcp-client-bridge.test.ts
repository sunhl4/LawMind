import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../agent/tools/registry.js";
import {
  attachEnabledMcpServers,
  isMcpWriteLikeTool,
  shouldExposeMcpTool,
} from "./mcp-client-bridge.js";
import { buildMcpChildEnv, connectMcpStdio } from "./mcp-jsonrpc-client.js";
import { writeMcpServersConfig } from "./mcp-servers-config.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mcp-"));
  dirs.push(dir);
  return dir;
}

function writeMockServer(dir: string): string {
  const file = path.join(dir, "mock-mcp.mjs");
  fs.writeFileSync(
    file,
    `
import readline from "node:readline";
const tools = [
  { name: "echo_note", description: "read a note", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "delete_file", description: "delete something", inputSchema: { type: "object", properties: {} } },
  { name: "write_document", description: "must not override", inputSchema: { type: "object", properties: {} } },
];
const rl = readline.createInterface({ input: process.stdin, terminal: false });
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
rl.on("line", (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  const id = req.id ?? null;
  if (req.method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "0" } } });
    return;
  }
  if (req.method === "notifications/initialized") return;
  if (req.method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }
  if (req.method === "tools/call") {
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(req.params?.arguments?.text ?? "ok") }] } });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "no" } });
});
`,
    "utf8",
  );
  return file;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("mcp client bridge", () => {
  it("registers read tools and hides write tools when allowWrites is false", async () => {
    const ws = tmpWs();
    const mock = writeMockServer(ws);
    writeMcpServersConfig(ws, [
      {
        id: "mock",
        label: "Mock",
        transport: "stdio",
        command: process.execPath,
        args: [mock],
        enabled: true,
        allowWrites: false,
      },
    ]);
    const registry = new ToolRegistry();
    const attached = await attachEnabledMcpServers({ registry, workspaceDir: ws });
    expect(attached.attached).toContain("mcp__mock__echo_note");
    expect(attached.attached.some((n) => n.includes("delete"))).toBe(false);
    expect(registry.get("mcp__mock__echo_note")).toBeDefined();
    const session = await connectMcpStdio({ command: process.execPath, args: [mock] });
    try {
      const listed = await session.listTools();
      expect(listed.map((t) => t.name)).toContain("echo_note");
      const called = await session.callTool("echo_note", { text: "hello" });
      expect(called.content?.[0]?.text).toBe("hello");
    } finally {
      await session.close();
      await Promise.all(attached.sessions.map((s) => s.close().catch(() => undefined)));
    }
  });

  it("rejects reserved remote names", () => {
    expect(
      shouldExposeMcpTool(
        { id: "x", label: "x", transport: "stdio", enabled: true, allowWrites: true },
        "write_document",
      ),
    ).toBe(false);
    expect(isMcpWriteLikeTool("delete_file")).toBe(true);
    expect(isMcpWriteLikeTool("send_email")).toBe(true);
    expect(
      shouldExposeMcpTool(
        { id: "x", label: "x", transport: "stdio", enabled: true, allowWrites: true },
        "run_analysis",
      ),
    ).toBe(false);
  });

  it("does not copy model secrets into the MCP child env", () => {
    const prev = process.env.LAWMIND_AGENT_API_KEY;
    process.env.LAWMIND_AGENT_API_KEY = "should-not-leak";
    try {
      const env = buildMcpChildEnv({ LAWMIND_MCP_SECRET: "only-this" });
      expect(env.LAWMIND_AGENT_API_KEY).toBeUndefined();
      expect(env.LAWMIND_MCP_SECRET).toBe("only-this");
      expect(env.PATH).toBeTruthy();
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_AGENT_API_KEY;
      } else {
        process.env.LAWMIND_AGENT_API_KEY = prev;
      }
    }
  });
});
