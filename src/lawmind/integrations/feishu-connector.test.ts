import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFeishuDocuments } from "./feishu-connector.js";

describe("feishu-connector", () => {
  const prev = process.env.LAWMIND_FEISHU_FIXTURE;
  const dirs: string[] = [];

  afterEach(() => {
    process.env.LAWMIND_FEISHU_FIXTURE = prev;
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("returns fixture documents when LAWMIND_FEISHU_FIXTURE=1", () => {
    process.env.LAWMIND_FEISHU_FIXTURE = "1";
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-feishu-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "cases", "matter-1"), { recursive: true });
    const docs = listFeishuDocuments(ws, "matter-1", { enabled: true, clientId: "cli_demo" });
    expect(Array.isArray(docs)).toBe(true);
    if (Array.isArray(docs)) {
      expect(docs[0]?.source).toBe("feishu");
      expect(docs[0]?.webUrl).toContain("feishu");
    }
  });

  it("stays unconfigured without fixture or secret", () => {
    delete process.env.LAWMIND_FEISHU_FIXTURE;
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-feishu-"));
    dirs.push(ws);
    const docs = listFeishuDocuments(ws, "matter-1", { enabled: true });
    expect(Array.isArray(docs)).toBe(false);
    if (!Array.isArray(docs)) {
      expect(docs.error).toBe("connector_unconfigured");
      expect(docs.hint).toContain("不会写入");
    }
  });
});
