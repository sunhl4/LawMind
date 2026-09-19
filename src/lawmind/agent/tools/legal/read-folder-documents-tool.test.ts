import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { readFolderDocumentsTool } from "./read-folder-documents-tool.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspaceDir: string, extra?: Partial<AgentContext>): AgentContext {
  return {
    workspaceDir,
    sessionId: "sess-read-folder",
    actorId: "lawyer",
    ...extra,
  };
}

async function writeMinimalDocx(abs: string, paragraphs: string[]): Promise<void> {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  );
  fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
}

type ToolData = {
  totalFiles?: number;
  readCount?: number;
  hasMore?: boolean;
  nextOffset?: number;
  files?: Array<{ path: string; chars: number; truncated: boolean; content: string }>;
  skipped?: Array<{ path: string; reason: string }>;
};

describe("read_folder_documents", () => {
  it("reads every readable file body under a workspace folder in one call", async () => {
    const ws = tmp("lm-rfd-");
    fs.mkdirSync(path.join(ws, "案件", "证据"), { recursive: true });
    fs.writeFileSync(path.join(ws, "案件", "委托合同.txt"), "委托人：张三。对方：李四。");
    fs.writeFileSync(path.join(ws, "案件", "证据", "收据.md"), "# 收据\n金额 5000 元");
    await writeMinimalDocx(path.join(ws, "案件", "起诉状.docx"), [
      "原告：张三",
      "被告：李四",
      "案由：买卖合同纠纷",
    ]);
    const result = await readFolderDocumentsTool.execute({ path: "案件" }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    expect(data.totalFiles).toBe(3);
    expect(data.readCount).toBe(3);
    const byPath = new Map(data.files?.map((f) => [f.path, f.content]));
    expect(byPath.get("案件/委托合同.txt")).toContain("张三");
    expect(byPath.get("案件/证据/收据.md")).toContain("5000");
    expect(byPath.get("案件/起诉状.docx")).toContain("买卖合同纠纷");
    expect(data.hasMore).toBe(false);
  });

  it("truncates long files and reports skipped binaries with reasons", async () => {
    const ws = tmp("lm-rfd-");
    fs.writeFileSync(path.join(ws, "long.txt"), "x".repeat(20_000));
    fs.writeFileSync(path.join(ws, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await readFolderDocumentsTool.execute(
      { path: ".", max_chars_per_file: 1_000 },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    const long = data.files?.find((f) => f.path === "long.txt");
    expect(long?.truncated).toBe(true);
    expect(long?.chars).toBe(1_000);
    expect(data.skipped?.some((s) => s.path === "photo.png" && s.reason.includes("图片"))).toBe(
      true,
    );
  });

  it("pages with offset when the folder has more files than max_files", async () => {
    const ws = tmp("lm-rfd-");
    for (let i = 1; i <= 5; i += 1) {
      fs.writeFileSync(path.join(ws, `f${i}.txt`), `content-${i}`);
    }
    const first = await readFolderDocumentsTool.execute({ path: ".", max_files: 2 }, ctx(ws));
    const firstData = first.data as ToolData;
    expect(firstData.readCount).toBe(2);
    expect(firstData.hasMore).toBe(true);
    expect(firstData.nextOffset).toBe(2);
    const second = await readFolderDocumentsTool.execute(
      { path: ".", max_files: 2, offset: firstData.nextOffset },
      ctx(ws),
    );
    const secondData = second.data as ToolData;
    expect(secondData.readCount).toBe(2);
    const seen = [
      ...(firstData.files ?? []).map((f) => f.path),
      ...(secondData.files ?? []).map((f) => f.path),
    ];
    expect(new Set(seen).size).toBe(4);
  });

  it("fails cleanly when the directory does not exist", async () => {
    const ws = tmp("lm-rfd-");
    const result = await readFolderDocumentsTool.execute({ path: "不存在" }, ctx(ws));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("找不到目录");
  });
});
