import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { IcloudDatalessError } from "../../../runtime/icloud-materialize.js";
import {
  DOCUMENT_PAGE_DEFAULT_CHARS,
  DOCUMENT_PAGE_MAX_CHARS,
  isDocxPath,
  isOcrImagePath,
  isPdfPath,
  isPathInsideRoot,
  isXlsxPath,
  normalizeRelPath,
  readDocxText,
  readSafe,
  searchProjectTextFiles,
  shouldUseVisionFallback,
  resolveOcrBudgetMs,
  sliceDocumentPage,
  visionFallbackUnavailableReason,
  visionUsageContextFromAgentCtx,
  withPdfReadFallbacks,
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

describe("visionUsageContextFromAgentCtx", () => {
  it("returns undefined without a workspace so we never write a bogus row", () => {
    expect(visionUsageContextFromAgentCtx({})).toBeUndefined();
    expect(visionUsageContextFromAgentCtx({ workspaceDir: "   " })).toBeUndefined();
  });

  it("carries session/turn/matter through and drops empty values", () => {
    expect(
      visionUsageContextFromAgentCtx({
        workspaceDir: "/ws",
        sessionId: "s1",
        turnId: "t1",
        matterId: "",
      }),
    ).toEqual({ workspaceDir: "/ws", sessionId: "s1", turnId: "t1" });
  });
});

describe("shouldUseVisionFallback", () => {
  it("defaults on when vision endpoint is configured; ocr_only turns it off", () => {
    const prevMode = process.env.LAWMIND_DOC_READ_MODE;
    const prevBase = process.env.LAWMIND_AGENT_BASE_URL;
    const prevKey = process.env.LAWMIND_AGENT_API_KEY;
    const prevModel = process.env.LAWMIND_AGENT_MODEL;
    delete process.env.LAWMIND_DOC_READ_MODE;
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.invalid/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "vision-test";
    expect(shouldUseVisionFallback()).toBe(true);
    process.env.LAWMIND_DOC_READ_MODE = "ocr_only";
    expect(shouldUseVisionFallback()).toBe(false);
    process.env.LAWMIND_DOC_READ_MODE = "ocr_then_vision";
    expect(shouldUseVisionFallback()).toBe(true);
    if (prevMode === undefined) {
      delete process.env.LAWMIND_DOC_READ_MODE;
    } else {
      process.env.LAWMIND_DOC_READ_MODE = prevMode;
    }
    if (prevBase === undefined) {
      delete process.env.LAWMIND_AGENT_BASE_URL;
    } else {
      process.env.LAWMIND_AGENT_BASE_URL = prevBase;
    }
    if (prevKey === undefined) {
      delete process.env.LAWMIND_AGENT_API_KEY;
    } else {
      process.env.LAWMIND_AGENT_API_KEY = prevKey;
    }
    if (prevModel === undefined) {
      delete process.env.LAWMIND_AGENT_MODEL;
    } else {
      process.env.LAWMIND_AGENT_MODEL = prevModel;
    }
  });
});

describe("resolveOcrBudgetMs", () => {
  it("defaults to 90s and honors a positive override", () => {
    expect(resolveOcrBudgetMs({})).toBe(90_000);
    expect(resolveOcrBudgetMs({ LAWMIND_OCR_BUDGET_MS: "15000" })).toBe(15_000);
    expect(resolveOcrBudgetMs({ LAWMIND_OCR_BUDGET_MS: "0" })).toBe(90_000);
    expect(resolveOcrBudgetMs({ LAWMIND_OCR_BUDGET_MS: "nope" })).toBe(90_000);
  });
});

describe("visionFallbackUnavailableReason", () => {
  it("names the missing config instead of a generic failure", () => {
    const prev = {
      mode: process.env.LAWMIND_DOC_READ_MODE,
      base: process.env.LAWMIND_AGENT_BASE_URL,
      key: process.env.LAWMIND_AGENT_API_KEY,
      model: process.env.LAWMIND_AGENT_MODEL,
    };
    delete process.env.LAWMIND_DOC_READ_MODE;
    delete process.env.LAWMIND_AGENT_BASE_URL;
    delete process.env.LAWMIND_AGENT_API_KEY;
    delete process.env.LAWMIND_AGENT_MODEL;
    try {
      expect(visionFallbackUnavailableReason()).toContain("LAWMIND_AGENT_BASE_URL");
      process.env.LAWMIND_AGENT_BASE_URL = "https://example.invalid/v1";
      expect(visionFallbackUnavailableReason()).toContain("LAWMIND_AGENT_API_KEY");
      process.env.LAWMIND_AGENT_API_KEY = "sk-test";
      expect(visionFallbackUnavailableReason()).toContain("LAWMIND_VISION_MODEL");
      process.env.LAWMIND_DOC_READ_MODE = "ocr_only";
      expect(visionFallbackUnavailableReason()).toContain("ocr_only");
    } finally {
      for (const [key, value] of [
        ["LAWMIND_DOC_READ_MODE", prev.mode],
        ["LAWMIND_AGENT_BASE_URL", prev.base],
        ["LAWMIND_AGENT_API_KEY", prev.key],
        ["LAWMIND_AGENT_MODEL", prev.model],
      ] as const) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

describe("withPdfReadFallbacks", () => {
  it("stops at the text layer when it has content", async () => {
    const result = await withPdfReadFallbacks({
      readText: async () => "合同正文",
      readOcr: async () => {
        throw new Error("不应该走到 OCR");
      },
    });
    expect(result).toEqual({ ok: true, text: "合同正文", sourceType: "pdf_text" });
  });

  it("falls back to OCR when the PDF has no text layer", async () => {
    const result = await withPdfReadFallbacks({
      readText: async () => "",
      readOcr: async () => "扫描件正文",
    });
    expect(result).toEqual({ ok: true, text: "扫描件正文", sourceType: "pdf_ocr" });
  });

  it("still reaches the vision model when OCR throws", async () => {
    const result = await withPdfReadFallbacks({
      readText: async () => "",
      readOcr: async () => {
        throw new Error("OCR 语言包（chi_sim）不可用：fetch failed");
      },
      readVision: async () => "视觉识别正文",
    });
    expect(result).toEqual({ ok: true, text: "视觉识别正文", sourceType: "pdf_vision" });
  });

  it("carries partial OCR output through instead of discarding it", async () => {
    const partial = "前两页正文\n\n【未读完】扫描件只识别了前 2 页，共 20 页。";
    const result = await withPdfReadFallbacks({
      readText: async () => "",
      readOcr: async () => partial,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.text).toContain("【未读完】");
  });

  it("reports each stage's real failure instead of claiming no OCR", async () => {
    const result = await withPdfReadFallbacks({
      readText: async () => "",
      readOcr: async () => {
        throw new Error("OCR 语言包（chi_sim）不可用：fetch failed");
      },
      readVision: async () => {
        throw new Error("HTTP 400: image_url unsupported");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("没有文字层");
      expect(result.reason).toContain("本地 OCR 不可用：OCR 语言包");
      expect(result.reason).toContain("视觉兜底失败：HTTP 400");
      expect(result.hint).toContain("LAWMIND_VISION_MODEL");
    }
  });

  it("explains why the vision stage was skipped", async () => {
    const result = await withPdfReadFallbacks({
      readText: async () => {
        throw new Error("DOMMatrix is not defined");
      },
      readOcr: async () => "",
      visionUnavailableReason: "未配置视觉模型（LAWMIND_VISION_MODEL）",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("文字层解析失败：DOMMatrix is not defined");
      expect(result.reason).toContain("未配置视觉模型（LAWMIND_VISION_MODEL）");
      // 视觉不可用时，审计阶段不能记成 pdf_vision。
      expect(result.stage).toBe("pdf_ocr");
    }
  });

  it("does not swallow iCloud materialization prompts", async () => {
    const err = new IcloudDatalessError(["/tmp/未下载的合同.pdf"]);
    await expect(
      withPdfReadFallbacks({
        readText: async () => {
          throw err;
        },
        readOcr: async () => {
          throw new Error("不应该走到 OCR");
        },
      }),
    ).rejects.toBe(err);
  });
});

describe("readDocxText", () => {
  it("keeps the page-field result and drops the field instruction", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-docx-field-"));
    const abs = path.join(dir, "page.docx");
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>` +
        `<w:r><w:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </w:instrText></w:r>` +
        `<w:r><w:t>72</w:t></w:r>` +
        `<w:r><w:t>付款基数</w:t></w:r>` +
        `</w:p></w:body></w:document>`,
    );
    await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const text = await readDocxText(abs);
    expect(text).toContain("72");
    expect(text).toContain("付款基数");
    expect(text).not.toContain("MERGEFORMAT");
    expect(text).not.toContain("PAGE");
  });
});
