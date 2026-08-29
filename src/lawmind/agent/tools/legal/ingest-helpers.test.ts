import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PAGE_DEFAULT_CHARS,
  DOCUMENT_PAGE_MAX_CHARS,
  isDocxPath,
  isOcrImagePath,
  isPdfPath,
  isPathInsideRoot,
  isXlsxPath,
  normalizeRelPath,
  readSafe,
  searchProjectTextFiles,
  shouldUseVisionFallback,
  sliceDocumentPage,
} from "./ingest-helpers.js";

describe("isPathInsideRoot", () => {
  it("rejects paths that escape the workspace root", () => {
    const root = "/tmp/lawmind-workspace";
    expect(isPathInsideRoot(root, "/tmp/lawmind-workspace/notes.txt")).toBe(true);
    expect(isPathInsideRoot(root, "/tmp/other/notes.txt")).toBe(false);
    expect(isPathInsideRoot(root, "/tmp/lawmind-workspace/../secret.txt")).toBe(false);
    expect(isPathInsideRoot(root, "/tmp/lawmind-workspace-evil/notes.txt")).toBe(false);
  });
});

describe("path type helpers", () => {
  it("detects pdf/docx/xlsx/image extensions", () => {
    expect(isPdfPath("/a/b.pdf")).toBe(true);
    expect(isDocxPath("/a/b.docx")).toBe(true);
    expect(isXlsxPath("/a/b.xlsx")).toBe(true);
    expect(isOcrImagePath("/a/b.png")).toBe(true);
    expect(isOcrImagePath("/a/b.txt")).toBe(false);
  });
});

describe("normalizeRelPath", () => {
  it("strips slashes and backslashes", () => {
    expect(normalizeRelPath("\\docs\\a.md")).toBe("docs/a.md");
    expect(normalizeRelPath("/docs/a.md/")).toBe("docs/a.md");
  });
});

describe("sliceDocumentPage", () => {
  it("paginates with defaults and hasMore", () => {
    const text = "a".repeat(100);
    const page = sliceDocumentPage(text, 0, undefined);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(DOCUMENT_PAGE_DEFAULT_CHARS);
    expect(page.content.length).toBe(100);
    expect(page.hasMore).toBe(false);

    const big = "x".repeat(DOCUMENT_PAGE_MAX_CHARS + 50);
    const mid = sliceDocumentPage(big, 10, 20);
    expect(mid.content).toHaveLength(20);
    expect(mid.hasMore).toBe(true);
    expect(mid.nextOffset).toBe(30);
  });

  it("clamps invalid offset/limit", () => {
    const text = "hello";
    expect(sliceDocumentPage(text, -5, -1).limit).toBe(DOCUMENT_PAGE_DEFAULT_CHARS);
    expect(sliceDocumentPage(text, 999, 2).offset).toBe(5);
  });
});

describe("readSafe", () => {
  it("returns empty string for missing file", async () => {
    await expect(readSafe("/tmp/does-not-exist-lawmind-ingest.txt")).resolves.toBe("");
  });

  it("reads utf8 text", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-ingest-"));
    const file = path.join(dir, "note.txt");
    await fs.writeFile(file, "租赁押金", "utf8");
    await expect(readSafe(file)).resolves.toBe("租赁押金");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("searchProjectTextFiles", () => {
  it("finds query in project markdown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-search-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "memo.md"), "# 押金退还\n争点说明\n", "utf8");
    const hits = await searchProjectTextFiles(root, "押金");
    expect(hits.some((h) => h.snippet.includes("押金"))).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("shouldUseVisionFallback", () => {
  it("reads LAWMIND_DOC_READ_MODE", () => {
    const prev = process.env.LAWMIND_DOC_READ_MODE;
    process.env.LAWMIND_DOC_READ_MODE = "ocr_then_vision";
    expect(shouldUseVisionFallback()).toBe(true);
    process.env.LAWMIND_DOC_READ_MODE = "ocr_only";
    expect(shouldUseVisionFallback()).toBe(false);
    if (prev === undefined) {
      delete process.env.LAWMIND_DOC_READ_MODE;
    } else {
      process.env.LAWMIND_DOC_READ_MODE = prev;
    }
  });
});
