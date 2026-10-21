/** Docx/xlsx/pdf/ocr parsing and path-safe project file helpers. */
import { readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { createModelUsageRecorder, type ModelBillingScope } from "../../../models/model-usage.js";
import { createOutboundProxy } from "../../../platform/outbound-proxy.js";
import {
  ensureLocalFile,
  IcloudDatalessError,
  IcloudLawyerPrompt,
} from "../../../runtime/icloud-materialize.js";
import { isPathInsideRoot } from "../../../runtime/workspace-path.js";
import { resolveDocumentPageChars } from "../../document-read-budget.js";
import {
  ensureOcrLangData,
  OcrLangDataError,
  resolveOcrLangs,
  type OcrLangData,
} from "./ocr-langdata.js";
import { loadXlsxAsTsv } from "./xlsx-workbook.js";

const visionProxy = createOutboundProxy({ requestTag: "vision-ocr" });

/**
 * 视觉 OCR 的记账上下文。图片 token 单价高，漏记等于成本永远少算。
 * 不传则只影响账本，不影响识别行为。
 */
export type VisionOcrUsageContext = {
  workspaceDir: string;
  sessionId?: string;
  turnId?: string;
  matterId?: string;
  billingScope?: ModelBillingScope;
};

/** 上游 `usage` 形状（与 `usageFromProvider` 的入参一致）。 */
export type VisionUsagePayload = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
};

/** 从工具上下文取视觉 OCR 的记账上下文；没有工作区就不记，不写假 0。 */
export function visionUsageContextFromAgentCtx(ctx: {
  workspaceDir?: string;
  sessionId?: string;
  turnId?: string;
  matterId?: string;
  billingScope?: ModelBillingScope;
}): VisionOcrUsageContext | undefined {
  const workspaceDir = ctx.workspaceDir?.trim();
  if (!workspaceDir) {
    return undefined;
  }
  return {
    workspaceDir,
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
    ...(ctx.matterId ? { matterId: ctx.matterId } : {}),
    ...(ctx.billingScope ? { billingScope: ctx.billingScope } : {}),
  };
}

export { MAX_XLSX_READ_BYTES } from "./xlsx-workbook.js";
async function readSafe(filePath: string): Promise<string> {
  try {
    await ensureLocalFile(filePath);
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err instanceof IcloudDatalessError || err instanceof IcloudLawyerPrompt) {
      throw err;
    }
    return "";
  }
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

/** 在走 UTF-8 直读或误进二进制前给出明确说明（.docx/.xlsx/.pdf/图片/.doc 仍走专用分支）。 */
function unsupportedOfficeIngestReason(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  // .doc：先由 WPS 加载项另存为 .docx，再读那份 .docx。
  if (ext === ".xls" || ext === ".ppt") {
    return "暂不支持从旧式 Office 二进制（.xls/.ppt）提取文本；请另存为 .xlsx/.pptx 后再读取。";
  }
  if (ext === ".wps" || ext === ".rtf" || ext === ".odt") {
    return "暂不支持直接读取该文字格式；请另存为 .doc/.docx 后重试。";
  }
  if (ext === ".pptx") {
    return "暂不支持从 PowerPoint（.pptx）抽取正文；请将内容导出为 .md/.txt，或转为 .docx 后使用本工具。";
  }
  return null;
}

function isConvertibleWordPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".wps" || ext === ".rtf" || ext === ".odt";
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
  return visionFallbackIssue() === null;
}

/**
 * 视觉兜底为什么不可用（给律师/模型看的原话）。
 * OCR 失败时调用方把这句话写进 tool 结果，避免模型自行编成「本机没有 OCR 能力」。
 */
export function visionFallbackUnavailableReason(): string {
  return visionFallbackIssue() ?? "视觉兜底不可用";
}

function visionFallbackIssue(): string | null {
  const mode = (process.env.LAWMIND_DOC_READ_MODE ?? "").trim().toLowerCase();
  if (mode === "ocr_only") {
    return "文档读取模式为 ocr_only，已关闭视觉兜底";
  }
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
  if (!baseUrl) {
    return "未配置模型服务地址（LAWMIND_AGENT_BASE_URL）；视觉兜底未启用";
  }
  if (!apiKey) {
    return "未配置模型密钥（LAWMIND_AGENT_API_KEY）；视觉兜底未启用";
  }
  if (!model) {
    return "未配置视觉模型（LAWMIND_VISION_MODEL 或 LAWMIND_AGENT_MODEL）；视觉兜底未启用";
  }
  return null;
}

function resolveVisionModelConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  if (visionFallbackIssue() !== null) {
    return null;
  }
  return {
    baseUrl:
      process.env.LAWMIND_AGENT_BASE_URL?.trim() ||
      process.env.QWEN_BASE_URL?.trim() ||
      process.env.LAWMIND_QWEN_BASE_URL?.trim() ||
      "",
    apiKey:
      process.env.LAWMIND_AGENT_API_KEY?.trim() ||
      process.env.QWEN_API_KEY?.trim() ||
      process.env.LAWMIND_QWEN_API_KEY?.trim() ||
      "",
    model:
      process.env.LAWMIND_VISION_MODEL?.trim() ||
      process.env.LAWMIND_AGENT_MODEL?.trim() ||
      process.env.QWEN_MODEL?.trim() ||
      process.env.LAWMIND_QWEN_MODEL?.trim() ||
      "",
  };
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
  signal?: AbortSignal,
  usageCtx?: VisionOcrUsageContext,
): Promise<string> {
  const cfg = resolveVisionModelConfig();
  if (!cfg) {
    return "";
  }
  const recordAttempt = usageCtx
    ? createModelUsageRecorder(usageCtx.workspaceDir, {
        sessionId: usageCtx.sessionId,
        turnId: usageCtx.turnId,
        matterId: usageCtx.matterId,
        model: cfg.model,
        provider: "openai-compatible",
        purpose: "ocr",
        billingScope: usageCtx.billingScope,
      })
    : undefined;
  const startedAt = Date.now();
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
  const response = await visionProxy
    .fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    })
    .catch(() => null);
  if (!response || !response.ok) {
    // 失败的视觉请求也可能已计费；记一条失败账，别让成本凭空消失。
    recordAttempt?.({
      attempt: 1,
      latencyMs: Date.now() - startedAt,
      failed: true,
      errorKind: response ? `http_${response.status}` : "transport",
    });
    return "";
  }
  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: VisionUsagePayload;
  } | null;
  recordAttempt?.({
    attempt: 1,
    latencyMs: Date.now() - startedAt,
    failed: false,
    usage: data?.usage,
  });
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

function stripWordFieldInstructions(xml: string): string {
  return xml
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:delInstrText\b[^>]*>[\s\S]*?<\/w:delInstrText>/g, "");
}

function extractTextFromDocxXml(xml: string): string {
  let body = stripWordFieldInstructions(xml)
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "");
  body = decodeXmlEntities(body);
  return normalizeExtractedText(body);
}

async function readDocxText(filePath: string): Promise<string> {
  await ensureLocalFile(filePath);
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) {
    return "";
  }
  return extractTextFromDocxXml(docXml);
}

async function readXlsxPlainText(filePath: string): Promise<string> {
  return normalizeExtractedText(await loadXlsxAsTsv(filePath));
}

/** OCR 引擎/语言包不可用。消息可以直接回给律师，不要吞成裸 `fetch failed`。 */
export class OcrUnavailableError extends Error {
  readonly name = "OcrUnavailableError";
}

type OcrWorker = {
  recognize: (image: Buffer | Uint8Array) => Promise<{ data?: { text?: string } }>;
  terminate: () => Promise<unknown>;
};

/**
 * OCR / 视觉兜底时间预算（`LAWMIND_OCR_BUDGET_MS`）。
 * 默认 90s：PDF 的「文字层 → 本地 OCR → 视觉」共用这一份，留在 180s 的工具墙钟以内。
 */
const DEFAULT_OCR_BUDGET_MS = 90_000;

export function resolveOcrBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LAWMIND_OCR_BUDGET_MS?.trim();
  if (!raw) {
    return DEFAULT_OCR_BUDGET_MS;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_OCR_BUDGET_MS;
}

class OcrDeadlineError extends Error {
  readonly name = "OcrDeadlineError";
}

/** 到点就拒绝；调用方据此保留已识别页、或转视觉兜底。 */
function raceWithDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return Promise.reject(new OcrDeadlineError("OCR 超出本轮时间预算"));
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrDeadlineError("OCR 超出本轮时间预算")), remaining);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function createOcrWorker(deadline?: number): Promise<OcrWorker> {
  const mod = await import("tesseract.js").catch((err: unknown) => {
    throw new OcrUnavailableError(`OCR 引擎不可用：${errorMessage(err)}`);
  });
  const maybeFactory =
    (mod as { createWorker?: unknown }).createWorker ??
    (mod as { default?: { createWorker?: unknown } }).default?.createWorker ??
    (mod as { default?: unknown }).default;
  if (typeof maybeFactory !== "function") {
    throw new OcrUnavailableError("OCR 引擎不可用：tesseract.js 未正确加载");
  }
  const langs = resolveOcrLangs();
  let langData: OcrLangData;
  try {
    langData = await ensureOcrLangData(langs, { deadline });
  } catch (err) {
    if (err instanceof OcrLangDataError) {
      throw new OcrUnavailableError(err.message);
    }
    throw new OcrUnavailableError(`OCR 语言包不可用：${errorMessage(err)}`);
  }
  try {
    return await (
      maybeFactory as (
        langs?: string | string[],
        oem?: number,
        options?: Record<string, unknown>,
      ) => Promise<OcrWorker>
    )(langs, undefined, {
      // 显式指定数据目录：不写进程 CWD，也不再由 tesseract 自己联网下载。
      langPath: langData.dir,
      cachePath: langData.dir,
      cacheMethod: "none",
      gzip: langData.gzip,
    });
  } catch (err) {
    throw new OcrUnavailableError(`OCR 引擎启动失败：${errorMessage(err)}`);
  }
}

async function readImageTextByOcr(filePath: string): Promise<string> {
  await ensureLocalFile(filePath);
  const image = await fs.readFile(filePath);
  const deadline = Date.now() + resolveOcrBudgetMs();
  const worker = await createOcrWorker(deadline);
  try {
    const result = await raceWithDeadline(worker.recognize(image), deadline);
    return normalizeExtractedText(result.data?.text ?? "");
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

async function readImageTextHybrid(
  filePath: string,
  usageCtx?: VisionOcrUsageContext,
): Promise<{ text: string; sourceType: "image_ocr" | "image_vision" } | null> {
  let ocrError: unknown;
  try {
    const ocrText = await readImageTextByOcr(filePath);
    if (ocrText) {
      return { text: ocrText, sourceType: "image_ocr" };
    }
  } catch (err) {
    if (err instanceof IcloudDatalessError || err instanceof IcloudLawyerPrompt) {
      throw err;
    }
    // OCR 坏了不等于没有识别能力：视觉兜底仍值得一试。
    ocrError = err;
  }
  const visionConfigured = shouldUseVisionFallback();
  if (visionConfigured) {
    await ensureLocalFile(filePath);
    const image = await fs.readFile(filePath);
    const visionText = await readImageTextByVisionModel(
      image,
      mimeFromImagePath(filePath),
      undefined,
      usageCtx,
    );
    if (visionText) {
      return { text: visionText, sourceType: "image_vision" };
    }
    if (!ocrError) {
      return null;
    }
  }
  if (ocrError) {
    const reason = errorMessage(ocrError);
    throw new OcrUnavailableError(
      visionConfigured
        ? `本地 OCR 不可用（${reason}）；视觉兜底也未识别出文字`
        : `本地 OCR 不可用：${reason}`,
    );
  }
  return null;
}

async function readPdfText(filePath: string): Promise<string> {
  await ensureLocalFile(filePath);
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

export async function readPdfTextByOcr(
  filePath: string,
  _usageCtx?: VisionOcrUsageContext,
  /** 与文字层/视觉兜底共享的总预算；缺省时按 `LAWMIND_OCR_BUDGET_MS` 现算。 */
  deadlineOverride?: number,
): Promise<string> {
  const deadline = deadlineOverride ?? Date.now() + resolveOcrBudgetMs();
  await ensureLocalFile(filePath);
  const buffer = await fs.readFile(filePath);
  const mod = await import("pdf-parse");
  const parser = new mod.PDFParse({ data: buffer });
  let worker: OcrWorker | undefined;
  try {
    const screenshot = await parser.getScreenshot({
      first: MAX_PDF_OCR_PAGES,
      scale: 2,
      imageBuffer: true,
      imageDataUrl: false,
    });
    // 先切图再建 worker：坏的 PDF 不该触发语言包下载。
    worker = await createOcrWorker(deadline);
    const chunks: string[] = [];
    let recognized = 0;
    for (const page of screenshot.pages ?? []) {
      if (Date.now() >= deadline) {
        break;
      }
      const image = Buffer.from(page.data ?? []);
      if (image.length === 0) {
        continue;
      }
      let result: Awaited<ReturnType<OcrWorker["recognize"]>>;
      try {
        result = await raceWithDeadline(worker.recognize(image), deadline);
      } catch (err) {
        // 预算用完就收下已识别的页，别把整份结果丢掉。
        if (err instanceof OcrDeadlineError) {
          break;
        }
        throw err;
      }
      recognized += 1;
      const text = normalizeExtractedText(result.data?.text ?? "");
      if (text) {
        chunks.push(text);
      }
    }
    const body = normalizeExtractedText(chunks.join("\n\n"));
    // 没有正文时不要只回一条【未读完】：调用方会把它当成读到了内容。
    const note = body ? ocrUnreadNote(recognized, screenshot.total) : "";
    return `${body}${note}`;
  } finally {
    await worker?.terminate().catch(() => undefined);
    await parser.destroy().catch(() => undefined);
  }
}

export async function readPdfTextByVision(
  filePath: string,
  usageCtx?: VisionOcrUsageContext,
  /** 与本地 OCR 共享的总预算；缺省时按 `LAWMIND_OCR_BUDGET_MS` 现算。 */
  deadlineOverride?: number,
): Promise<string> {
  const deadline = deadlineOverride ?? Date.now() + resolveOcrBudgetMs();
  await ensureLocalFile(filePath);
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
    let recognized = 0;
    for (const page of screenshot.pages ?? []) {
      if (Date.now() >= deadline) {
        break;
      }
      const image = Buffer.from(page.data ?? []);
      if (image.length === 0) {
        continue;
      }
      let text: string;
      try {
        text = await raceWithDeadline(
          readImageTextByVisionModel(image, "image/png", undefined, usageCtx),
          deadline,
        );
      } catch (err) {
        // 预算用完就收下已识别的页，并让「未读完」的页数如实减少。
        if (err instanceof OcrDeadlineError) {
          break;
        }
        throw err;
      }
      recognized += 1;
      if (text) {
        chunks.push(text);
      }
    }
    const body = normalizeExtractedText(chunks.join("\n\n"));
    // 没有正文时不要只回一条【未读完】：调用方会把它当成读到了内容。
    const note = body ? ocrUnreadNote(recognized, screenshot.total) : "";
    return `${body}${note}`;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export type PdfExtractSource = "pdf_text" | "pdf_ocr" | "pdf_vision";

export type PdfTextExtraction =
  | { ok: true; text: string; sourceType: PdfExtractSource }
  /** `stage` = 最后尝试的那一环，供 ingest 审计记录真实阶段。 */
  | { ok: false; reason: string; hint: string; stage: PdfExtractSource };

export type PdfReadDeps = {
  readText: () => Promise<string>;
  readOcr: () => Promise<string>;
  readVision?: () => Promise<string>;
  /** `readVision` 缺省时，说明为什么没启用。 */
  visionUnavailableReason?: string;
};

/** iCloud 未下载 / 需要律师确认属于「停下来问人」，不能被兜底链吞成识别失败。 */
function rethrowIcloud(err: unknown): void {
  if (err instanceof IcloudDatalessError || err instanceof IcloudLawyerPrompt) {
    throw err;
  }
}

/**
 * PDF 读取兜底链：文字层 → 本地 OCR → 视觉模型。
 *
 * 关键约束：**任一环节失败都不能中断后续环节**。此前 OCR 抛 `fetch failed`
 * 会直接穿透到模型，模型只能归纳成「本机没有 OCR 能力」；视觉兜底从未被尝试。
 * 这里把每一环的错误收下来，最后合成一句可执行的失败原因。
 */
export async function withPdfReadFallbacks(deps: PdfReadDeps): Promise<PdfTextExtraction> {
  let textError: string | undefined;
  try {
    const text = (await deps.readText()).trim();
    if (text) {
      return { ok: true, text, sourceType: "pdf_text" };
    }
  } catch (err) {
    rethrowIcloud(err);
    textError = errorMessage(err);
  }

  let ocrError: string | undefined;
  try {
    const ocr = (await deps.readOcr()).trim();
    if (ocr) {
      return { ok: true, text: ocr, sourceType: "pdf_ocr" };
    }
  } catch (err) {
    rethrowIcloud(err);
    ocrError = errorMessage(err);
  }

  let visionNote = deps.visionUnavailableReason ?? "视觉兜底未启用";
  if (deps.readVision) {
    try {
      const vision = (await deps.readVision()).trim();
      if (vision) {
        return { ok: true, text: vision, sourceType: "pdf_vision" };
      }
      visionNote = "视觉兜底未识别出文字";
    } catch (err) {
      rethrowIcloud(err);
      visionNote = `视觉兜底失败：${errorMessage(err)}`;
    }
  }

  const detail = [
    textError ? `文字层解析失败：${textError}` : "没有文字层",
    ocrError ? `本地 OCR 不可用：${ocrError}` : "本地 OCR 未识别出文字",
    visionNote,
  ].join("；");
  return {
    ok: false,
    stage: deps.readVision ? "pdf_vision" : "pdf_ocr",
    reason: `PDF 没有可读正文（${detail}）`,
    hint: "可把关键页另存为 .docx/.txt 后再读；或在设置里指定支持图片的视觉模型（LAWMIND_VISION_MODEL）后重试。",
  };
}

/** 按当前配置读取一份 PDF；失败时给出每一环的真实原因。 */
export async function extractPdfTextWithFallbacks(
  filePath: string,
  opts: { usageCtx?: VisionOcrUsageContext; budgetMs?: number } = {},
): Promise<PdfTextExtraction> {
  // 文字层 → OCR → 视觉共用一份预算：两段各给 90s 会直接越过工具墙钟。
  const deadline = Date.now() + (opts.budgetMs ?? resolveOcrBudgetMs());
  const visionEnabled = shouldUseVisionFallback();
  return withPdfReadFallbacks({
    readText: () => readPdfText(filePath),
    readOcr: () => readPdfTextByOcr(filePath, opts.usageCtx, deadline),
    ...(visionEnabled
      ? {
          readVision: () => {
            if (Date.now() >= deadline) {
              throw new Error("超出本轮时间预算（LAWMIND_OCR_BUDGET_MS）");
            }
            return readPdfTextByVision(filePath, opts.usageCtx, deadline);
          },
        }
      : {}),
    visionUnavailableReason: visionEnabled ? undefined : visionFallbackUnavailableReason(),
  });
}

function normalizeRelPath(p: string): string {
  return (p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
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
const MAX_PDF_OCR_PAGES = 12;

function ocrUnreadNote(readPages: number, total: number | undefined): string {
  if (readPages <= 0) {
    return "";
  }
  if (total !== undefined && total > readPages) {
    return `\n\n【未读完】扫描件只识别了前 ${readPages} 页，共 ${total} 页。后面页面未进入本文，不得当成已读完全文。`;
  }
  return "";
}

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

/**
 * 兜底默认页：与 analyze_document / read_project_file / read_folder_documents
 * 共用同一预算口径（随模型窗口伸缩、扣防注入横幅）。调用方应显式传
 * defaultLimit（携带 contextTokens）；这里只是安全兜底，避免"忘了传就是 40k"
 * 这种隐性不一致再次出现。
 */
export const DOCUMENT_PAGE_DEFAULT_CHARS = resolveDocumentPageChars(undefined);
/** 显式 limit 的硬顶（模型明确要求读大段时）。 */
export const DOCUMENT_PAGE_MAX_CHARS = 120_000;

export type DocumentPageSlice = {
  content: string;
  totalChars: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number;
};

/**
 * Paginate extracted document text so large contracts stay readable across tool calls.
 * `offset` / `limit` are character offsets into the extracted UTF-8 text.
 */
export function sliceDocumentPage(
  fullText: string,
  offsetRaw: unknown,
  limitRaw: unknown,
  defaults: { defaultLimit?: number; maxLimit?: number } = {},
): DocumentPageSlice {
  const defaultLimit = defaults.defaultLimit ?? DOCUMENT_PAGE_DEFAULT_CHARS;
  const maxLimit = defaults.maxLimit ?? DOCUMENT_PAGE_MAX_CHARS;
  const totalChars = fullText.length;
  const offsetNum = Number(offsetRaw);
  const offset =
    Number.isFinite(offsetNum) && offsetNum > 0 ? Math.min(totalChars, Math.floor(offsetNum)) : 0;
  let limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = defaultLimit;
  }
  limit = Math.min(maxLimit, Math.max(1, Math.floor(limit)));
  const content = fullText.slice(offset, offset + limit);
  const nextOffset = offset + content.length;
  return {
    content,
    totalChars,
    offset,
    limit,
    hasMore: nextOffset < totalChars,
    nextOffset,
  };
}

export {
  readSafe,
  isPathInsideRoot,
  isPdfPath,
  isDocxPath,
  isXlsxPath,
  isOcrImagePath,
  isConvertibleWordPath,
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
