import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mcpStdioCommandError,
  normalizeMcpHttpUrl,
  writeMcpServersConfig,
} from "./mcp-servers-config.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("mcp-servers-config", () => {
  it("rejects system shells and eval flags", () => {
    expect(mcpStdioCommandError("bash", ["-c", "id"])).toMatch(/壳/);
    expect(mcpStdioCommandError("node", ["-e", "1"])).toMatch(/代码/);
    expect(mcpStdioCommandError("node", ["server.mjs"])).toBeUndefined();
  });

  it("allows only http(s) urls", () => {
    expect(normalizeMcpHttpUrl("file:///tmp/x").ok).toBe(false);
    expect(normalizeMcpHttpUrl("http://127.0.0.1:9/mcp").ok).toBe(true);
  });

  it("默认拒绝非本机 http 明文；https 与本机 http 不受影响", () => {
    // 远程 http：默认拒绝（Bearer secret 不走明文）。
    const remote = normalizeMcpHttpUrl("http://mcp.internal.example:8080/rpc");
    expect(remote.ok).toBe(false);
    if (!remote.ok) {
      expect(remote.error).toMatch(/明文|allowInsecureHttp/);
    }
    // https 不受影响。
    expect(normalizeMcpHttpUrl("https://mcp.internal.example:8443/rpc").ok).toBe(true);
    // 本机 http 保留（本机开发自托管）。
    expect(normalizeMcpHttpUrl("http://localhost:9/mcp").ok).toBe(true);
    expect(normalizeMcpHttpUrl("http://127.0.0.1:9/mcp").ok).toBe(true);
    expect(normalizeMcpHttpUrl("http://[::1]:9/mcp").ok).toBe(true);
  });

  it("allowInsecureHttp 显式例外放行远程 http", () => {
    expect(
      normalizeMcpHttpUrl("http://mcp.internal.example:8080/rpc", { allowInsecureHttp: true }).ok,
    ).toBe(true);
  });

  it("writeMcpServersConfig 拒绝远程 http，显式例外时落 warnings", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mcp-cfg-http-"));
    dirs.push(ws);
    const denied = writeMcpServersConfig(ws, [
      {
        id: "remote",
        label: "remote",
        transport: "http",
        url: "http://mcp.internal.example:8080/rpc",
        enabled: true,
        allowWrites: false,
      },
    ]);
    expect(denied.ok).toBe(false);

    const allowed = writeMcpServersConfig(ws, [
      {
        id: "remote",
        label: "remote",
        transport: "http",
        url: "http://mcp.internal.example:8080/rpc",
        enabled: true,
        allowWrites: false,
        allowInsecureHttp: true,
      },
    ]);
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.warnings?.join("\n")).toMatch(/明文/);
    }
  });

  it("refuses to persist a shell command", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mcp-cfg-"));
    dirs.push(ws);
    const written = writeMcpServersConfig(ws, [
      {
        id: "bad",
        label: "bad",
        transport: "stdio",
        command: "bash",
        args: ["-c", "id"],
        enabled: false,
        allowWrites: false,
      },
    ]);
    expect(written.ok).toBe(false);
  });
});
