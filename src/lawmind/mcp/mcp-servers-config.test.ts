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
