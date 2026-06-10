/** Docx/xlsx/pdf/ocr parsing and path-safe project file helpers. */
import { readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
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

export function shouldUseVisionFallback(): boolean {
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

export const MAX_XLSX_READ_BYTES = 20_000_000;
const MAX_XLSX_SHEETS = 32;
const MAX_XLSX_ROWS_PER_SHEET = 5000;

async function readXlsxPlainText(filePath: string): Promise<string> {
  const ExcelJS = await import("exceljs");
  const buffer = await fs.readFile(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = workbook.worksheets.slice(0, MAX_XLSX_SHEETS);
  const parts: string[] = [];
  for (const worksheet of sheets) {
    const rows: string[] = [];
    let rowCount = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (rowCount >= MAX_XLSX_ROWS_PER_SHEET) {
        return;
      }
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(String(cell.text ?? ""));
      });
      if (cells.some((c) => c.trim())) {
        rows.push(cells.join("\t"));
      }
      rowCount++;
    });
    const body = rows.join("\n");
    if (body.trim()) {
      parts.push(`### ${worksheet.name}\n${body}`);
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

export async function readPdfTextByOcr(filePath: string): Promise<string> {
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

export async function readPdfTextByVision(filePath: string): Promise<string> {
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

export {
  readSafe,
  isPathInsideRoot,
  isPdfPath,
  isDocxPath,
  isXlsxPath,
  isOcrImagePath,
  unsupportedOfficeIngestReason,
  normalizeRelPath,
  readDocxText,
  readXlsxPlainText,
  readPdfText,
  readImageTextHybrid,
  searchProjectTextFiles,
  MAX_PROJECT_READ_BYTES,
  MAX_PROJECT_PDF_READ_BYTES,
  MAX_WORKSPACE_PDF_READ_BYTES,
  MAX_DOCX_READ_BYTES,
  MAX_IMAGE_OCR_READ_BYTES,
};
