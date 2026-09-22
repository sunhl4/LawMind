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
  perFileAllowance?: number;
  files?: Array<{
    path: string;
    chars: number;
    truncated: boolean;
    elidedChars?: number;
    content: string;
  }>;
  skipped?: Array<{ path: string; reason: string }>;
  notRead?: string[];
  notReadCount?: number;
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

  it("elides the middle of long files (head+tail survive) and reports skipped binaries", async () => {
    const ws = tmp("lm-rfd-");
    fs.writeFileSync(
      path.join(ws, "long.txt"),
      `原告：某公司。案号（2026）冀0722民初1号。${"中".repeat(20_000)}具状人：某公司。`,
    );
    fs.writeFileSync(path.join(ws, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await readFolderDocumentsTool.execute(
      { path: ".", max_chars_per_file: 1_000 },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    const long = data.files?.find((f) => f.path === "long.txt");
    expect(long?.truncated).toBe(true);
    expect(long?.elidedChars).toBeGreaterThan(0);
    // 两端都保留：头部案号 + 尾部具状人。
    expect(long?.content).toContain("案号（2026）冀0722民初1号");
    expect(long?.content).toContain("具状人：某公司");
    expect(long?.content).toContain("中间省略");
    expect(data.skipped?.some((s) => s.path === "photo.png" && s.reason.includes("图片"))).toBe(
      true,
    );
  });

  it("passes short files through whole instead of truncating every file equally", async () => {
    const ws = tmp("lm-rfd-");
    // 材料夹的常见形态：一份长文书 + 若干短文书（送达回证、证据清单、身份证）。
    fs.writeFileSync(path.join(ws, "长文书.txt"), "长".repeat(30_000));
    fs.writeFileSync(path.join(ws, "送达回证.txt"), "受送达人已签收。");
    fs.writeFileSync(path.join(ws, "证据清单.txt"), "证据一：送货单五张。");
    const result = await readFolderDocumentsTool.execute({ path: "." }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    const short1 = data.files?.find((f) => f.path === "送达回证.txt");
    const short2 = data.files?.find((f) => f.path === "证据清单.txt");
    expect(short1?.truncated).toBe(false);
    expect(short2?.truncated).toBe(false);
    expect(short1?.content).toBe("受送达人已签收。");
    expect(short2?.content).toBe("证据一：送货单五张。");
  });

  it("lists files whose bodies were not read, so the model can triage without guessing", async () => {
    const ws = tmp("lm-rfd-");
    for (let i = 1; i <= 6; i += 1) {
      fs.writeFileSync(path.join(ws, `f${i}.txt`), "x".repeat(4_000));
    }
    const result = await readFolderDocumentsTool.execute(
      { path: ".", max_files: 2, max_chars_per_file: 4_000 },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    expect(data.notReadCount).toBeGreaterThan(0);
    expect(data.notRead?.some((p) => /^f\d+\.txt$/.test(p))).toBe(true);
    // 未读名单不含已读文件。
    const readPaths = new Set((data.files ?? []).map((f) => f.path));
    expect((data.notRead ?? []).every((p) => !readPaths.has(p))).toBe(true);
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
    expect(result.error).toMatch(/找不到/);
  });
});
