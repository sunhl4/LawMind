import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { analyzeDocument } from "./file-tools.js";
import { sliceDocumentPage } from "./ingest-helpers.js";

describe("sliceDocumentPage", () => {
  it("returns full text when under default page size", () => {
    const page = sliceDocumentPage("hello world", 0, undefined);
    expect(page.content).toBe("hello world");
    expect(page.hasMore).toBe(false);
    expect(page.totalChars).toBe(11);
    expect(page.nextOffset).toBe(11);
  });

  it("paginates with offset/limit and reports nextOffset", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const page1 = sliceDocumentPage(text, 0, 10);
    expect(page1.content).toBe("abcdefghij");
    expect(page1.hasMore).toBe(true);
    expect(page1.nextOffset).toBe(10);
    const page2 = sliceDocumentPage(text, page1.nextOffset, 10);
    expect(page2.content).toBe("klmnopqrst");
    expect(page2.hasMore).toBe(true);
  });
});

describe("analyze_document pagination", () => {
  it("exposes hasMore/nextOffset for long workspace files", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-analyze-page-"));
    const rel = "long-contract.txt";
    const body = "甲".repeat(12_000);
    await fs.writeFile(path.join(ws, rel), body, "utf8");
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "lawyer",
    };
    const first = await analyzeDocument.execute({ file_path: rel, limit: 4000 }, ctx);
    expect(first.ok).toBe(true);
    const d1 = first.data as {
      hasMore?: boolean;
      nextOffset?: number;
      totalChars?: number;
      content?: string;
    };
    expect(d1.totalChars).toBe(12_000);
    expect(d1.hasMore).toBe(true);
    expect(d1.nextOffset).toBe(4000);
    expect(d1.content).toContain("甲");

    const second = await analyzeDocument.execute(
      { file_path: rel, offset: d1.nextOffset, limit: 4000 },
      ctx,
    );
    expect(second.ok).toBe(true);
    const d2 = second.data as { offset?: number; hasMore?: boolean };
    expect(d2.offset).toBe(4000);
    expect(d2.hasMore).toBe(true);
  });

  it("finds a project file that is not in the workspace", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-analyze-ws-"));
    const project = await fs.mkdtemp(path.join(os.tmpdir(), "lm-analyze-proj-"));
    const leaf = "泰国医疗人工智能战略合作框架协议.txt";
    await fs.writeFile(path.join(project, leaf), "甲方权利义务\n", "utf8");
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "lawyer",
      projectDir: project,
    };
    const result = await analyzeDocument.execute({ file_path: leaf }, ctx);
    expect(result.ok).toBe(true);
    const data = result.data as { filePath?: string; fileRoot?: string; content?: string };
    expect(data.fileRoot).toBe("project");
    expect(data.filePath).toBe(leaf);
    expect(data.content).toContain("甲方");
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });
});
