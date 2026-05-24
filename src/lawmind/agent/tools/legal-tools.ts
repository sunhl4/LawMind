/**
 * LawMind 法律工具集
 *
 * 每个工具是 agent 可调用的一个能力单元。
 * agent runtime 通过 ToolRegistry 按名称查找和调度。
 *
 * 工具分类：
 *   search   — 检索法规、案例、案件记忆
 *   analyze  — 合同分析、条款比对、引用校验
 *   draft    — 起草章节、整理结论
 *   matter   — 案件管理、添加笔记、标记风险
 *   review   — 请求律师审核、提交审批
 *   system   — 读取配置、查看状态
 */

import { readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { readAllAuditLogs } from "../../audit/index.js";
import {
  buildMatterIndex,
  listMatterIds,
  searchMatterIndex,
  summarizeMatterIndex,
} from "../../cases/index.js";
import { listDrafts } from "../../drafts/index.js";
import { caseFilePath, loadMemoryContext } from "../../memory/index.js";
import { writeCaseMemorySection, type CaseMemorySection } from "../../memory/write-gateway.js";
import type { IngestSourceType, IngestStage } from "../../platform/contracts.js";
import {
  ingestFailure,
  ingestSuccess,
  toolFailureFromIngest,
} from "../../platform/ingest-helpers.js";
import { listTaskRecords } from "../../tasks/index.js";
import type { AgentConfig, AgentTool } from "../types.js";
import {
  createDelegateTaskTool,
  createDelegateToRoleTool,
  createConsultAssistantTool,
  createNotifyAssistantTool,
  createRequestReviewTool,
  listDelegationsTool,
  getDelegationResultTool,
} from "./collaboration-tools.js";
import { engineTools } from "./engine-tools.js";
import { lawMindStatuteWebSearchTool } from "./lawmind-legal-web-search.js";
import { lawMindWebSearchTool } from "./lawmind-web-search.js";
import { ToolRegistry } from "./registry.js";

async function readSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootAbs = path.resolve(root);
  const candidateAbs = path.resolve(candidate);
  const rel = path.relative(rootAbs, candidateAbs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isPdfPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

function isDocxPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".docx";
}

function isXlsxPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".xlsx";
}

const OCR_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);

function isOcrImagePath(filePath: string): boolean {
  return OCR_IMAGE_EXT.has(path.extname(filePath).toLowerCase());
}

/** 在走 UTF-8 直读或误进二进制前给出明确说明（.docx/.xlsx/.pdf/图片仍走专用分支）。 */
function unsupportedOfficeIngestReason(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".doc" || ext === ".xls" || ext === ".ppt") {
    return "暂不支持从旧式 Office 二进制（.doc/.xls/.ppt）提取文本；请另存为 .docx/.xlsx/.pptx 后再读取。";
  }
  if (ext === ".pptx") {
    return "暂不支持从 PowerPoint（.pptx）抽取正文；请将内容导出为 .md/.txt，或转为 .docx 后使用本工具。";
  }
  return null;
}

function mimeFromImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".bmp") {
    return "image/bmp";
  }
  if (ext === ".tif" || ext === ".tiff") {
    return "image/tiff";
  }
  return "image/jpeg";
}

function asDataUrl(buffer: Buffer | Uint8Array, mime: string): string {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function shouldUseVisionFallback(): boolean {
  return (
    (process.env.LAWMIND_DOC_READ_MODE ?? "ocr_only").trim().toLowerCase() === "ocr_then_vision"
  );
}

function resolveVisionModelConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const baseUrl =
    process.env.LAWMIND_AGENT_BASE_URL?.trim() ||
    process.env.QWEN_BASE_URL?.trim() ||
    process.env.LAWMIND_QWEN_BASE_URL?.trim();
  const apiKey =
    process.env.LAWMIND_AGENT_API_KEY?.trim() ||
    process.env.QWEN_API_KEY?.trim() ||
    process.env.LAWMIND_QWEN_API_KEY?.trim();
  const model =
    process.env.LAWMIND_VISION_MODEL?.trim() ||
    process.env.LAWMIND_AGENT_MODEL?.trim() ||
    process.env.QWEN_MODEL?.trim() ||
    process.env.LAWMIND_QWEN_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) {
    return null;
  }
  return { baseUrl, apiKey, model };
}

function readChoiceText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (!Array.isArray(raw)) {
    return "";
  }
  const out: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const maybeText = (item as { text?: unknown }).text;
    if (typeof maybeText === "string") {
      out.push(maybeText);
    }
  }
  return out.join("\n");
}

async function readImageTextByVisionModel(
  image: Buffer | Uint8Array,
  mime: string,
): Promise<string> {
  const cfg = resolveVisionModelConfig();
  if (!cfg) {
    return "";
  }
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const payload = {
    model: cfg.model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a strict OCR assistant. Extract visible text only. Preserve line breaks. Do not add explanations.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all visible text from this image." },
          { type: "image_url", image_url: { url: asDataUrl(image, mime) } },
        ],
      },
    ],
  };
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (!response || !response.ok) {
    return "";
  }
  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  return normalizeExtractedText(readChoiceText(data?.choices?.[0]?.message?.content));
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTextFromDocxXml(xml: string): string {
  let body = xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "");
  body = decodeXmlEntities(body);
  return normalizeExtractedText(body);
}

async function readDocxText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) {
    return "";
  }
  return extractTextFromDocxXml(docXml);
}

const MAX_XLSX_READ_BYTES = 20_000_000;
const MAX_XLSX_SHEETS = 32;
/** SheetJS：限制解析行数，降低恶意超大行宽表带来的内存风险 */
const MAX_XLSX_ROWS_PER_SHEET = 5000;

async function readXlsxPlainText(filePath: string): Promise<string> {
  const mod = (await import("xlsx")) as typeof import("xlsx");
  const buffer = await fs.readFile(filePath);
  const workbook = mod.read(buffer, {
    type: "buffer",
    dense: true,
    cellDates: true,
    cellNF: false,
    cellHTML: false,
    sheetRows: MAX_XLSX_ROWS_PER_SHEET,
  });
  const names = workbook.SheetNames.slice(0, MAX_XLSX_SHEETS);
  const parts: string[] = [];
  for (const sheetName of names) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      continue;
    }
    const csv = mod.utils.sheet_to_csv(worksheet, { FS: "\t", blankrows: false });
    if (csv.trim()) {
      parts.push(`### ${sheetName}\n${csv}`);
    }
  }
  return normalizeExtractedText(parts.join("\n\n"));
}

async function createOcrWorker() {
  const mod = await import("tesseract.js");
  const maybeFactory =
    (mod as { createWorker?: unknown }).createWorker ??
    (mod as { default?: { createWorker?: unknown } }).default?.createWorker ??
    (mod as { default?: unknown }).default;
  if (typeof maybeFactory !== "function") {
    throw new Error("OCR worker initialization failed");
  }
  const langs = (process.env.LAWMIND_OCR_LANGS?.trim() || "chi_sim+eng").split("+").filter(Boolean);
  return (
    maybeFactory as (langs?: string | string[]) => Promise<{
      recognize: (image: Buffer | Uint8Array) => Promise<{ data?: { text?: string } }>;
      terminate: () => Promise<unknown>;
    }>
  )(langs.length === 0 ? "eng" : langs);
}

async function readImageTextByOcr(filePath: string): Promise<string> {
  const image = await fs.readFile(filePath);
  const worker = await createOcrWorker();
  try {
    const result = await worker.recognize(image);
    return normalizeExtractedText(result.data?.text ?? "");
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

async function readImageTextHybrid(
  filePath: string,
): Promise<{ text: string; sourceType: "image_ocr" | "image_vision" } | null> {
  const ocrText = await readImageTextByOcr(filePath);
  if (ocrText) {
    return { text: ocrText, sourceType: "image_ocr" };
  }
  if (!shouldUseVisionFallback()) {
    return null;
  }
  const image = await fs.readFile(filePath);
  const visionText = await readImageTextByVisionModel(image, mimeFromImagePath(filePath));
  if (!visionText) {
    return null;
  }
  return { text: visionText, sourceType: "image_vision" };
}

async function readPdfText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const mod = await import("pdf-parse");
  const parser = new mod.PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return normalizeExtractedText(parsed.text ?? "");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function readPdfTextByOcr(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const mod = await import("pdf-parse");
  const parser = new mod.PDFParse({ data: buffer });
  const worker = await createOcrWorker();
  try {
    const screenshot = await parser.getScreenshot({
      first: MAX_PDF_OCR_PAGES,
      scale: 2,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const chunks: string[] = [];
    for (const page of screenshot.pages ?? []) {
      const image = Buffer.from(page.data ?? []);
      if (image.length === 0) {
        continue;
      }
      const result = await worker.recognize(image);
      const text = normalizeExtractedText(result.data?.text ?? "");
      if (text) {
        chunks.push(text);
      }
    }
    return normalizeExtractedText(chunks.join("\n\n"));
  } finally {
    await worker.terminate().catch(() => undefined);
    await parser.destroy().catch(() => undefined);
  }
}

async function readPdfTextByVision(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const mod = await import("pdf-parse");
  const parser = new mod.PDFParse({ data: buffer });
  try {
    const screenshot = await parser.getScreenshot({
      first: MAX_PDF_OCR_PAGES,
      scale: 2,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const chunks: string[] = [];
    for (const page of screenshot.pages ?? []) {
      const image = Buffer.from(page.data ?? []);
      if (image.length === 0) {
        continue;
      }
      const text = await readImageTextByVisionModel(image, "image/png");
      if (text) {
        chunks.push(text);
      }
    }
    return normalizeExtractedText(chunks.join("\n\n"));
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function normalizeRelPath(p: string): string {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

const PROJECT_TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".vue",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".xml",
]);

const MAX_PROJECT_TEXT_FILES = 72;
const MAX_PROJECT_FILE_SCAN_BYTES = 200_000;
const MAX_PROJECT_READ_BYTES = 1_000_000;
const MAX_PROJECT_PDF_READ_BYTES = 20_000_000;
const MAX_WORKSPACE_PDF_READ_BYTES = 20_000_000;
const MAX_DOCX_READ_BYTES = 20_000_000;
const MAX_IMAGE_OCR_READ_BYTES = 20_000_000;
const MAX_PDF_OCR_PAGES = 5;

/** Bounded scan of user project dir (desktop "project" root). */
function listProjectTextFiles(projectRoot: string): string[] {
  const rootAbs = path.resolve(projectRoot);
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_PROJECT_TEXT_FILES || depth > 8) {
      return;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_PROJECT_TEXT_FILES) {
        return;
      }
      const name = e.name;
      if (
        name === "node_modules" ||
        name === ".git" ||
        name === "dist" ||
        name === "build" ||
        name === ".next" ||
        name === "coverage"
      ) {
        continue;
      }
      const full = path.join(dir, name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else {
        const ext = path.extname(name).toLowerCase();
        if (PROJECT_TEXT_EXT.has(ext)) {
          out.push(full);
        }
      }
    }
  };
  walk(rootAbs, 0);
  return out;
}

async function searchProjectTextFiles(
  projectRoot: string,
  query: string,
): Promise<Array<{ source: string; snippet: string }>> {
  const q = query.toLowerCase();
  const results: Array<{ source: string; snippet: string }> = [];
  const rootAbs = path.resolve(projectRoot);
  const files = listProjectTextFiles(rootAbs);
  for (const file of files) {
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(file);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_PROJECT_FILE_SCAN_BYTES) {
      continue;
    }
    const content = await readSafe(file);
    const rel = path.relative(rootAbs, file).replace(/\\/g, "/");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes(q)) {
        results.push({ source: `project:${rel}`, snippet: line.trim().slice(0, 220) });
        if (results.length >= 45) {
          return results;
        }
      }
    }
  }
  return results;
}

// ─────────────────────────────────────────────
// Search Tools
// ─────────────────────────────────────────────

const searchMatter: AgentTool = {
  definition: {
    name: "search_matter",
    description: "在当前案件的所有记录中搜索关键词，包括争点、风险、任务、草稿、审计事件。",
    category: "search",
    parameters: {
      query: { type: "string", description: "搜索关键词", required: true },
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID，请先关联案件或传入 matter_id。" };
    }
    const index = await buildMatterIndex(ctx.workspaceDir, matterId);
    const hits = searchMatterIndex(index, params.query as string);
    return {
      ok: true,
      data: { matterId, query: params.query, hits: hits.slice(0, 20), total: hits.length },
    };
  },
};

const searchWorkspace: AgentTool = {
  definition: {
    name: "search_workspace",
    description:
      "搜索 LawMind 工作区记忆（MEMORY.md、LAWYER_PROFILE.md、案件档案等）。若用户关联了桌面「项目目录」，会**额外**扫描该项目内有限数量的**纯文本类**文件（如 .md/.txt/.ts；有界检索）；不包含 PDF/Word/图片，读此类文件请用 read_project_file。",
    category: "search",
    parameters: {
      query: { type: "string", description: "搜索关键词", required: true },
    },
  },
  async execute(params, ctx) {
    const memory = await loadMemoryContext(ctx.workspaceDir, { matterId: ctx.matterId });
    const query = (params.query as string).toLowerCase();
    const results: Array<{ source: string; snippet: string }> = [];

    for (const [source, content] of Object.entries({
      "MEMORY.md": memory.general,
      "LAWYER_PROFILE.md": memory.profile,
      "CASE.md": memory.caseMemory,
      "today-log": memory.todayLog,
    })) {
      if (!content) {
        continue;
      }
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.toLowerCase().includes(query)) {
          results.push({ source, snippet: line.trim().slice(0, 200) });
        }
      }
    }

    let projectHits: Array<{ source: string; snippet: string }> = [];
    if (ctx.projectDir?.trim()) {
      try {
        projectHits = await searchProjectTextFiles(ctx.projectDir.trim(), params.query as string);
      } catch {
        projectHits = [];
      }
    }

    const merged = [...results, ...projectHits].slice(0, 60);

    return {
      ok: true,
      data: {
        query: params.query,
        results: merged,
        total: merged.length,
        projectScanned: Boolean(ctx.projectDir?.trim()),
      },
    };
  },
};

const readProjectFile: AgentTool = {
  definition: {
    name: "read_project_file",
    description:
      "读取律师在桌面端关联的「项目目录」下的文本文件、PDF、.docx、.xlsx（表格转 TSV 纯文本，有界）、常见图片（OCR，可选视觉兜底）（相对路径）。不支持旧式 .doc/.xls/.ppt 与 .pptx。用于合同、证据清单、说明等本地材料；未关联项目时不可用。",
    category: "search",
    parameters: {
      relative_path: {
        type: "string",
        description: '相对项目根的路径，如 "合同/补充协议.md" 或 "notes.txt"',
        required: true,
      },
    },
  },
  async execute(params, ctx) {
    const root = ctx.projectDir?.trim();
    if (!root) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_INVALID_PATH",
          "path_validation",
          "未关联项目目录：请在 LawMind 桌面端选择项目文件夹后再试。",
        ),
      );
    }
    const rel = normalizeRelPath(params.relative_path as string);
    const toProjectSuccess = (
      sourceType: IngestSourceType,
      content: string,
      bytes: number,
      stage: IngestStage,
    ) => {
      const sliced = content.slice(0, 500_000);
      const result = ingestSuccess(sourceType, sliced, content.length > 500_000, bytes, stage);
      return {
        ok: true as const,
        data: {
          path: rel,
          content: result.content,
          size: result.bytes,
          truncated: result.truncated,
          sourceType: result.sourceType,
          ingestStage: result.stage,
        },
      };
    };
    if (!rel || rel.includes("..")) {
      return toolFailureFromIngest(
        ingestFailure("INGEST_INVALID_PATH", "path_validation", "非法路径"),
      );
    }
    const full = path.resolve(root, rel);
    if (!isPathInsideRoot(root, full)) {
      return toolFailureFromIngest(
        ingestFailure("INGEST_INVALID_PATH", "path_validation", "路径越界"),
      );
    }
    const st = await fs.stat(full).catch(() => null);
    if (!st?.isFile()) {
      return toolFailureFromIngest(
        ingestFailure("INGEST_NOT_FOUND", "file_stat", "文件不存在或不是普通文件"),
      );
    }
    const projectOfficeBlock = unsupportedOfficeIngestReason(full);
    if (projectOfficeBlock) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_UNSUPPORTED_FORMAT",
          "office_extract",
          projectOfficeBlock,
          "可改为 .docx/.xlsx 或纯文本后重试。",
        ),
      );
    }
    if (isDocxPath(full)) {
      if (st.size > MAX_DOCX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `DOCX 文件过大（>${MAX_DOCX_READ_BYTES} bytes）`,
          ),
        );
      }
      const text = await readDocxText(full);
      if (!text) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "DOCX 无可提取文本",
            "请确认该文档不是纯图片或受保护文档。",
          ),
        );
      }
      return toProjectSuccess("docx", text, st.size, "office_extract");
    }
    if (isXlsxPath(full)) {
      if (st.size > MAX_XLSX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `XLSX 文件过大（>${MAX_XLSX_READ_BYTES} bytes）`,
          ),
        );
      }
      let text: string;
      try {
        text = await readXlsxPlainText(full);
      } catch (err) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_PARSE_FAILED",
            "office_extract",
            `XLSX 解析失败: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      if (!text) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "XLSX 无可提取文本（工作表可能为空）",
          ),
        );
      }
      return toProjectSuccess("xlsx", text, st.size, "office_extract");
    }
    if (isOcrImagePath(full)) {
      if (st.size > MAX_IMAGE_OCR_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "image_ocr",
            `图片文件过大（>${MAX_IMAGE_OCR_READ_BYTES} bytes）`,
          ),
        );
      }
      const imageResult = await readImageTextHybrid(full);
      if (!imageResult) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "image_vision",
            "图片 OCR 未识别到文本（视觉兜底后仍为空）",
          ),
        );
      }
      return toProjectSuccess(
        imageResult.sourceType,
        imageResult.text,
        st.size,
        imageResult.sourceType === "image_ocr" ? "image_ocr" : "image_vision",
      );
    }
    if (isPdfPath(full)) {
      if (st.size > MAX_PROJECT_PDF_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "pdf_text",
            `PDF 文件过大（>${MAX_PROJECT_PDF_READ_BYTES} bytes）`,
          ),
        );
      }
      const text = await readPdfText(full);
      if (text) {
        return toProjectSuccess("pdf", text, st.size, "pdf_text");
      }
      const ocrText = await readPdfTextByOcr(full);
      if (ocrText) {
        return toProjectSuccess("pdf_ocr", ocrText, st.size, "pdf_ocr");
      }
      if (shouldUseVisionFallback()) {
        const visionText = await readPdfTextByVision(full);
        if (visionText) {
          return toProjectSuccess("pdf_vision", visionText, st.size, "pdf_vision");
        }
      }
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_EMPTY_CONTENT",
          "pdf_vision",
          "PDF 无可提取文本（OCR/视觉兜底后仍为空）",
        ),
      );
    }
    if (st.size > MAX_PROJECT_READ_BYTES) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_FILE_TOO_LARGE",
          "text_read",
          `文件过大（>${MAX_PROJECT_READ_BYTES} bytes）`,
        ),
      );
    }
    const buf = await fs.readFile(full);
    for (let i = 0; i < Math.min(buf.length, 4096); i++) {
      if (buf[i] === 0) {
        return toolFailureFromIngest(
          ingestFailure("INGEST_BINARY_UNSUPPORTED", "text_read", "二进制文件不支持"),
        );
      }
    }
    const text = buf.toString("utf8");
    return toProjectSuccess("text", text, st.size, "text_read");
  },
};

const STATUTE_LINE =
  /《[^》]+》|法典|法律适用|第\s*[零一二三四五六七八九十百千0-9]+条|法规|条例|司法解释|刑法|民法|行政诉讼法|公司法|劳动合同法/i;

const searchStatute: AgentTool = {
  definition: {
    name: "search_statute",
    description:
      "在工作区记忆与案件摘要中检索与法律法规、条文编号相关的内容（启发式：法条、法规名称等）。不替代正式法规库。",
    category: "search",
    parameters: {
      query: { type: "string", description: "关键词（如法律名称、条款主题）", required: true },
      matter_id: { type: "string", description: "可选：限定某案件的 CASE 与索引" },
    },
  },
  async execute(params, ctx) {
    const query = ((params.query as string) ?? "").trim().toLowerCase();
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const matterId = (params.matter_id as string | undefined) || ctx.matterId;
    const results: Array<{ source: string; snippet: string }> = [];

    const pushIfStatute = (source: string, line: string) => {
      const t = line.trim();
      if (!t) {
        return;
      }
      const hitQuery = t.toLowerCase().includes(query);
      const hitStatute = STATUTE_LINE.test(t);
      if (!hitQuery && !hitStatute) {
        return;
      }
      results.push({ source, snippet: t.slice(0, 240) });
    };

    if (matterId) {
      const index = await buildMatterIndex(ctx.workspaceDir, matterId);
      for (const line of index.caseMemory.split("\n")) {
        pushIfStatute(`CASE:${matterId}`, line);
      }
      for (const arr of [
        index.coreIssues,
        index.taskGoals,
        index.riskNotes,
        index.progressEntries,
      ] as const) {
        for (const entry of arr) {
          for (const line of entry.split("\n")) {
            pushIfStatute(`index:${matterId}`, line);
          }
        }
      }
    } else {
      const memory = await loadMemoryContext(ctx.workspaceDir, { matterId: ctx.matterId });
      for (const [source, content] of Object.entries({
        "MEMORY.md": memory.general,
        "LAWYER_PROFILE.md": memory.profile,
        "today-log": memory.todayLog,
      })) {
        if (!content) {
          continue;
        }
        for (const line of content.split("\n")) {
          pushIfStatute(source, line);
        }
      }
    }

    return {
      ok: true,
      data: {
        query: params.query,
        matterId: matterId ?? null,
        hits: results.slice(0, 25),
        total: results.length,
        note: "结果为工作区启发式检索，引用前请核对官方法规文本。",
      },
    };
  },
};

const CASE_LINE =
  /案号|判决书|裁定书|人民法院|高院|中院|最高人民法院|仲裁委|\(\s*20\d{2}\s*\)|民终|民初|刑终|执异|行诉/i;

const searchCaseLaw: AgentTool = {
  definition: {
    name: "search_case_law",
    description:
      "在工作区案件摘要与记忆中检索裁判文书、案号、法院名称等案例线索（启发式）。不替代裁判文书网等专业库。",
    category: "search",
    parameters: {
      query: {
        type: "string",
        description: "关键词（案号片段、对方名称、法院名等）",
        required: true,
      },
      matter_id: { type: "string", description: "可选：限定案件" },
    },
  },
  async execute(params, ctx) {
    const query = ((params.query as string) ?? "").trim().toLowerCase();
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const matterId = (params.matter_id as string | undefined) || ctx.matterId;
    const results: Array<{ source: string; snippet: string }> = [];

    const pushIfCase = (source: string, line: string) => {
      const t = line.trim();
      if (!t) {
        return;
      }
      const hitQuery = t.toLowerCase().includes(query);
      const hitCase = CASE_LINE.test(t);
      if (!hitQuery && !hitCase) {
        return;
      }
      results.push({ source, snippet: t.slice(0, 240) });
    };

    if (matterId) {
      const index = await buildMatterIndex(ctx.workspaceDir, matterId);
      for (const line of index.caseMemory.split("\n")) {
        pushIfCase(`CASE:${matterId}`, line);
      }
      for (const draft of index.drafts) {
        const blob = `${draft.title}\n${draft.sections.map((s) => s.body).join("\n")}`;
        for (const line of blob.split("\n")) {
          pushIfCase(`draft:${draft.taskId}`, line);
        }
      }
    } else {
      const ids = await listMatterIds(ctx.workspaceDir);
      for (const mid of ids.slice(0, 20)) {
        const index = await buildMatterIndex(ctx.workspaceDir, mid);
        for (const line of index.caseMemory.split("\n")) {
          pushIfCase(`CASE:${mid}`, line);
        }
      }
    }

    return {
      ok: true,
      data: {
        query: params.query,
        matterId: matterId ?? null,
        hits: results.slice(0, 25),
        total: results.length,
        note: "结果为工作区线索汇总，正式引用请核实原始裁判文书。",
      },
    };
  },
};

const checkConflictOfInterest: AgentTool = {
  definition: {
    name: "check_conflict_of_interest",
    description:
      "根据当事人/实体名称在工作区已有案件中做字符串命中筛查，提示可能的多案并存或利益冲突风险（需律师最终判断）。",
    category: "matter",
    parameters: {
      parties: {
        type: "string",
        description: "待核查的当事人或实体名称，逗号/顿号分隔",
        required: true,
      },
    },
  },
  async execute(params, ctx) {
    const raw = (params.parties as string) ?? "";
    const parties = raw
      .split(/[,，、;；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (parties.length === 0) {
      return { ok: false, error: "请提供至少 2 个字符以上的当事人名称。" };
    }

    const ids = await listMatterIds(ctx.workspaceDir);
    const partyToMatters = new Map<string, string[]>();

    for (const party of parties) {
      const hits: string[] = [];
      const pl = party.toLowerCase();
      for (const matterId of ids) {
        const index = await buildMatterIndex(ctx.workspaceDir, matterId);
        const blob = [
          index.caseMemory,
          ...index.coreIssues,
          ...index.taskGoals,
          ...index.riskNotes,
          ...index.progressEntries,
        ]
          .join("\n")
          .toLowerCase();
        if (blob.includes(pl)) {
          hits.push(matterId);
        }
      }
      const memory = await loadMemoryContext(ctx.workspaceDir, {});
      const memBlob = [memory.general, memory.profile].join("\n").toLowerCase();
      if (memBlob.includes(pl)) {
        hits.push("(workspace-memory)");
      }
      if (hits.length > 0) {
        partyToMatters.set(party, [...new Set(hits)]);
      }
    }

    const flags: string[] = [];
    for (const [party, matters] of partyToMatters) {
      if (matters.length > 1) {
        flags.push(
          `「${party}」在多个来源中出现：${matters.join("、")} — 请核对是否构成利益冲突。`,
        );
      }
    }

    return {
      ok: true,
      data: {
        parties,
        matches: Object.fromEntries(partyToMatters),
        conflictFlags: flags,
        matterScanned: ids.length,
        note:
          flags.length === 0
            ? "未发现明显的跨案件同名命中，但仍需结合所知客户关系人工确认。"
            : "发现跨来源命中，建议按事务所利益冲突规程复核。",
      },
    };
  },
};

// ─────────────────────────────────────────────
// Matter Management Tools
// ─────────────────────────────────────────────

const getMatterSummary: AgentTool = {
  definition: {
    name: "get_matter_summary",
    description: "获取案件摘要，包括核心争点、风险、进展、产物、任务状态。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID。" };
    }
    const index = await buildMatterIndex(ctx.workspaceDir, matterId);
    const summary = summarizeMatterIndex(index);
    return {
      ok: true,
      data: {
        matterId,
        summary,
        coreIssues: index.coreIssues,
        riskNotes: index.riskNotes,
        artifacts: index.artifacts,
        openTasks: index.openTasks.length,
        renderedTasks: index.renderedTasks.length,
      },
    };
  },
};

const listMatters: AgentTool = {
  definition: {
    name: "list_matters",
    description: "列出所有案件 ID。",
    category: "matter",
    parameters: {},
  },
  async execute(_params, ctx) {
    const ids = await listMatterIds(ctx.workspaceDir);
    return { ok: true, data: { matters: ids } };
  },
};

const readCaseFile: AgentTool = {
  definition: {
    name: "read_case_file",
    description: "读取案件的 CASE.md 完整内容。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID。" };
    }
    const filePath = caseFilePath(ctx.workspaceDir, matterId);
    const content = await readSafe(filePath);
    if (!content) {
      return { ok: false, error: `案件 ${matterId} 的 CASE.md 不存在或为空。` };
    }
    return { ok: true, data: { matterId, content } };
  },
};

const addCaseNote: AgentTool = {
  definition: {
    name: "add_case_note",
    description: "向案件的指定章节添加一条记录（争点/风险/进展/产物/任务目标）。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
      section: {
        type: "string",
        description: "目标章节",
        required: true,
        enum: ["core_issue", "risk", "progress", "artifact", "task_goal"],
      },
      content: { type: "string", description: "要添加的内容", required: true },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return { ok: false, error: "未指定案件 ID。" };
    }
    const section = params.section as CaseMemorySection;
    const content = params.content as string;
    if (!["core_issue", "risk", "progress", "artifact", "task_goal"].includes(section)) {
      return { ok: false, error: `未知章节：${section}` };
    }
    await writeCaseMemorySection({
      workspaceDir: ctx.workspaceDir,
      matterId,
      section,
      content,
      trackAdoption: true,
      origin: "agent",
    });
    return { ok: true, data: { matterId, section, content } };
  },
};

// ─────────────────────────────────────────────
// Analyze Tools
// ─────────────────────────────────────────────

const analyzeDocument: AgentTool = {
  definition: {
    name: "analyze_document",
    description:
      "读取工作区内的指定文件（路径相对工作区根），返回内容供后续分析。支持 Markdown/txt、PDF（文本层→OCR→可选视觉）、.docx、.xlsx（表格转 TSV，有界）、常见图片 OCR；不支持 .doc/.xls/.ppt 与 .pptx。",
    category: "analyze",
    parameters: {
      file_path: { type: "string", description: "相对于工作区的文件路径", required: true },
    },
  },
  async execute(params, ctx) {
    const filePath = path.resolve(ctx.workspaceDir, params.file_path as string);
    const toAnalyzeSuccess = (
      sourceType: IngestSourceType,
      content: string,
      bytes: number,
      stage: IngestStage,
    ) => {
      const sliced = content.slice(0, 8000);
      const result = ingestSuccess(sourceType, sliced, content.length > 8000, bytes, stage);
      return {
        ok: true as const,
        data: {
          filePath: params.file_path,
          content: result.content,
          truncated: result.truncated,
          sourceType: result.sourceType,
          ingestStage: result.stage,
        },
      };
    };
    if (!isPathInsideRoot(ctx.workspaceDir, filePath)) {
      return toolFailureFromIngest(
        ingestFailure("INGEST_INVALID_PATH", "path_validation", "不允许读取工作区外的文件。"),
      );
    }
    const st = await fs.stat(filePath).catch(() => null);
    if (!st?.isFile()) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_NOT_FOUND",
          "file_stat",
          `文件不存在或为空：${String(params.file_path)}`,
        ),
      );
    }
    const officeBlock = unsupportedOfficeIngestReason(filePath);
    if (officeBlock) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_UNSUPPORTED_FORMAT",
          "office_extract",
          officeBlock,
          "可改为 .docx/.xlsx 或纯文本后重试。",
        ),
      );
    }
    if (isDocxPath(filePath)) {
      if (st.size > MAX_DOCX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `DOCX 文件过大（>${MAX_DOCX_READ_BYTES} bytes）`,
          ),
        );
      }
      const content = await readDocxText(filePath);
      if (!content) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "DOCX 无可提取文本",
            "请确认该文档不是纯图片或受保护文档。",
          ),
        );
      }
      return toAnalyzeSuccess("docx", content, st.size, "office_extract");
    }
    if (isXlsxPath(filePath)) {
      if (st.size > MAX_XLSX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `XLSX 文件过大（>${MAX_XLSX_READ_BYTES} bytes）`,
          ),
        );
      }
      let xlsxText: string;
      try {
        xlsxText = await readXlsxPlainText(filePath);
      } catch (err) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_PARSE_FAILED",
            "office_extract",
            `XLSX 解析失败: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      if (!xlsxText) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "XLSX 无可提取文本（工作表可能为空）",
          ),
        );
      }
      return toAnalyzeSuccess("xlsx", xlsxText, st.size, "office_extract");
    }
    if (isOcrImagePath(filePath)) {
      if (st.size > MAX_IMAGE_OCR_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "image_ocr",
            `图片文件过大（>${MAX_IMAGE_OCR_READ_BYTES} bytes）`,
          ),
        );
      }
      const imageResult = await readImageTextHybrid(filePath);
      if (!imageResult) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "image_vision",
            "图片 OCR 未识别到文本（视觉兜底后仍为空）",
          ),
        );
      }
      return toAnalyzeSuccess(
        imageResult.sourceType,
        imageResult.text,
        st.size,
        imageResult.sourceType === "image_ocr" ? "image_ocr" : "image_vision",
      );
    }
    if (isPdfPath(filePath)) {
      if (st.size > MAX_WORKSPACE_PDF_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "pdf_text",
            `PDF 文件过大（>${MAX_WORKSPACE_PDF_READ_BYTES} bytes）`,
          ),
        );
      }
      const content = await readPdfText(filePath);
      if (content) {
        return toAnalyzeSuccess("pdf", content, st.size, "pdf_text");
      }
      const ocrText = await readPdfTextByOcr(filePath);
      if (ocrText) {
        return toAnalyzeSuccess("pdf_ocr", ocrText, st.size, "pdf_ocr");
      }
      if (shouldUseVisionFallback()) {
        const visionText = await readPdfTextByVision(filePath);
        if (visionText) {
          return toAnalyzeSuccess("pdf_vision", visionText, st.size, "pdf_vision");
        }
      }
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_EMPTY_CONTENT",
          "pdf_vision",
          "PDF 无可提取文本（OCR/视觉兜底后仍为空）",
        ),
      );
    }
    const content = await readSafe(filePath);
    if (!content) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_EMPTY_CONTENT",
          "text_read",
          `文件不存在或为空：${String(params.file_path)}`,
        ),
      );
    }
    return toAnalyzeSuccess("text", content, st.size, "text_read");
  },
};

// ─────────────────────────────────────────────
// Draft Tools
// ─────────────────────────────────────────────

const writeDocument: AgentTool = {
  definition: {
    name: "write_document",
    description:
      "将内容写入工作区的指定文件。用于保存分析结果、草稿等。参数须含 file_path（也可用 path）与 content；若会话已关联草稿且只传 content，默认写入 drafts/<taskId>.json。",
    category: "draft",
    parameters: {
      file_path: { type: "string", description: "相对于工作区的文件路径", required: true },
      content: { type: "string", description: "要写入的内容", required: true },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const filePath = path.resolve(ctx.workspaceDir, params.file_path as string);
    if (!filePath.startsWith(ctx.workspaceDir)) {
      return { ok: false, error: "不允许写入工作区外的文件。" };
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.content as string, "utf8");
    return {
      ok: true,
      data: { filePath: params.file_path, bytes: (params.content as string).length },
    };
  },
};

// ─────────────────────────────────────────────
// System / Status Tools
// ─────────────────────────────────────────────

const listTasks: AgentTool = {
  definition: {
    name: "list_tasks",
    description: "列出工作区中的所有任务记录，支持按案件和状态筛选。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "按案件 ID 筛选" },
      status: {
        type: "string",
        description: "按状态筛选",
        enum: [
          "created",
          "confirmed",
          "researching",
          "researched",
          "drafted",
          "reviewed",
          "rejected",
          "rendered",
        ],
      },
    },
  },
  async execute(params, ctx) {
    let tasks = listTaskRecords(ctx.workspaceDir);
    if (params.matter_id) {
      tasks = tasks.filter((task) => task.matterId === params.matter_id);
    }
    if (params.status) {
      tasks = tasks.filter((task) => task.status === params.status);
    }
    return {
      ok: true,
      data: {
        tasks: tasks.slice(0, 50).map((task) => ({
          taskId: task.taskId,
          kind: task.kind,
          status: task.status,
          summary: task.summary,
          matterId: task.matterId,
          updatedAt: task.updatedAt,
        })),
        total: tasks.length,
      },
    };
  },
};

const listAllDrafts: AgentTool = {
  definition: {
    name: "list_drafts",
    description: "列出工作区中的所有草稿，支持按案件筛选。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "按案件 ID 筛选" },
    },
  },
  async execute(params, ctx) {
    let drafts = listDrafts(ctx.workspaceDir);
    if (params.matter_id) {
      drafts = drafts.filter((draft) => draft.matterId === params.matter_id);
    }
    return {
      ok: true,
      data: {
        drafts: drafts.slice(0, 30).map((draft) => ({
          taskId: draft.taskId,
          title: draft.title,
          templateId: draft.templateId,
          reviewStatus: draft.reviewStatus,
          matterId: draft.matterId,
          createdAt: draft.createdAt,
        })),
        total: drafts.length,
      },
    };
  },
};

const getAuditTrail: AgentTool = {
  definition: {
    name: "get_audit_trail",
    description: "读取审计日志，支持按案件或任务筛选。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "按案件筛选（需先获取该案件的任务列表）" },
      task_id: { type: "string", description: "按任务 ID 筛选" },
    },
  },
  async execute(params, ctx) {
    const auditDir = path.join(ctx.workspaceDir, "audit");
    let events = await readAllAuditLogs(auditDir);
    if (params.task_id) {
      events = events.filter((event) => event.taskId === params.task_id);
    } else if (params.matter_id) {
      const taskIds = new Set(
        listTaskRecords(ctx.workspaceDir)
          .filter((task) => task.matterId === params.matter_id)
          .map((task) => task.taskId),
      );
      events = events.filter((event) => taskIds.has(event.taskId));
    }
    return {
      ok: true,
      data: {
        events: events.slice(-50).map((event) => ({
          kind: event.kind,
          actor: event.actor,
          detail: event.detail,
          timestamp: event.timestamp,
          taskId: event.taskId,
        })),
        total: events.length,
      },
    };
  },
};

// ─────────────────────────────────────────────
// Registry Builder
// ─────────────────────────────────────────────

export function createLegalToolRegistry(opts?: {
  allowWebSearch?: boolean;
  enableCollaboration?: boolean;
  baseConfig?: AgentConfig;
  collaborationDepth?: number;
}): ToolRegistry {
  const registry = new ToolRegistry();
  const tools: AgentTool[] = [
    // 信息检索
    searchMatter,
    searchWorkspace,
    readProjectFile,
    searchStatute,
    searchCaseLaw,
    // 案件管理
    getMatterSummary,
    listMatters,
    checkConflictOfInterest,
    readCaseFile,
    addCaseNote,
    // 文件操作
    analyzeDocument,
    writeDocument,
    // 状态查看
    listTasks,
    listAllDrafts,
    getAuditTrail,
  ];

  if (opts?.allowWebSearch) {
    tools.push(lawMindWebSearchTool, lawMindStatuteWebSearchTool);
  }

  if (opts?.enableCollaboration && opts.baseConfig) {
    tools.push(
      createDelegateTaskTool({
        baseConfig: opts.baseConfig,
        currentDepth: opts.collaborationDepth ?? 0,
      }),
      createDelegateToRoleTool({
        baseConfig: opts.baseConfig,
        currentDepth: opts.collaborationDepth ?? 0,
      }),
      createConsultAssistantTool({ baseConfig: opts.baseConfig }),
      createNotifyAssistantTool({ baseConfig: opts.baseConfig }),
      createRequestReviewTool({ baseConfig: opts.baseConfig }),
      listDelegationsTool,
      getDelegationResultTool,
    );
  }

  tools.push(...engineTools);

  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}
