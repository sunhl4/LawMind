/**
 * One parent tool call reads a pile of files and returns short cards.
 * Not nested runTurn: text extract is deterministic; optional chat-model
 * batches only summarize excerpts. Writes, export, and send stay on the parent.
 */

import fs from "node:fs";
import path from "node:path";
import { extractLegalEvents } from "../desk/legal-event-extract.js";
import { classifyDocumentGenre, type DocumentGenre } from "../intent/document-genre.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import {
  joinListedRel,
  resolveDirectoryTarget,
  walkDirectoryListing,
} from "../runtime/list-dir.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { elideMiddle } from "./text-elide.js";
import { isOcrImagePath, readImageTextHybrid } from "./tools/legal/ingest-helpers.js";
import { extractReadableFileText } from "./tools/legal/read-folder-documents-tool.js";
import type { AgentContext, ToolCallResult } from "./types.js";
import { isIncompleteWorkerBrief } from "./worker-brief.js";

export const DIGEST_MATERIALS_TOOL_NAME = "digest_materials";

/** Files handled in one call. The rest come back as notRead for a later offset. */
export const DIGEST_MAX_FILES = 32;
export const DIGEST_EXTRACT_CONCURRENCY = 4;
export const DIGEST_MODEL_CONCURRENCY = 4;
export const DIGEST_PER_FILE_MODEL_CHARS = 3_000;
export const DIGEST_CARD_EXCERPT_CHARS = 160;
export const DIGEST_PILE_PIN_COUNT = 8;
export const DIGEST_OCR_MAX = 8;
const MIN_GROUNDED_CITATION_CHARS = 8;

const GENRE_LABEL: Record<DocumentGenre, string> = {
  contract: "合同",
  pleading: "诉状",
  letter: "函件",
  invoice: "发票",
  court_notice: "传票/通知",
  talk: "谈话记录",
  evidence: "证据",
  privacy: "隐私/数据",
  ma: "并购材料",
  capital: "资本市场",
  spreadsheet: "表格",
  identity: "身份证明",
  unknown: "未识别",
};

const DIGEST_MODEL_INSTRUCTIONS = [
  "你只读这一份材料。不要把其他文件的事实写进来。",
  "只根据给出的正文写卡片。正文若标明中间省略，你看到的是头尾，不是全文，不要把省略掉的部分说成已经读过。",
  "返回一个 JSON 对象，不要写其它说明。字段：points（一两句要点）、citations（正文里的连续原文，字符串数组）、reviewPoints（能放进审查表的短句，每句必须是正文原句）、gaps（读不清或正文没有的，没有则空字符串）。",
].join("");

export type MaterialDigestEvent = {
  eventKind: string;
  title: string;
  dueAt?: string;
  notes?: string;
  sourcePath: string;
};

export type MaterialDigestCard = {
  path: string;
  genre: string;
  points: string;
  citations: string[];
  reviewPoints: string[];
  events: MaterialDigestEvent[];
  gaps: string;
  excerpt: string;
  elided: boolean;
};

export type DigestFilePayload = {
  points: string;
  gaps: string;
  citations: string[];
  reviewPoints: string[];
};

export type MaterialDigestSummarizer = (input: {
  goal: string;
  notGoal?: string;
  file: { path: string; genre: string; text: string };
  signal?: AbortSignal;
}) => Promise<DigestFilePayload | null>;

export function instructionLooksLikeMaterialPile(text: string): boolean {
  return /逐份|每一份|每个文件|所有文件|全部材料|这些材料|这些文件|这叠|分头读|批量(阅读|审查|看)/.test(
    text,
  );
}

export function pileNeedsMaterialDigest(text: string, pins?: ComposeContextPin[]): boolean {
  if (instructionLooksLikeMaterialPile(text)) {
    return true;
  }
  const filePins = (pins ?? []).filter((pin) => pin.pinKind === "file" && pin.kind === "file");
  if (filePins.length >= DIGEST_PILE_PIN_COUNT) {
    return true;
  }
  const hasDirectory = (pins ?? []).some(
    (pin) => pin.pinKind === "file" && pin.kind === "directory",
  );
  return hasDirectory && /审查|归纳|整理|时间线|期限/.test(text);
}

export function parseDigestFilePayload(raw: string): DigestFilePayload | null {
  const text = stripFence(raw.trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const rec = parsed as {
      points?: unknown;
      gaps?: unknown;
      citations?: unknown;
      reviewPoints?: unknown;
    };
    return {
      points: clip(typeof rec.points === "string" ? rec.points : "", 200),
      gaps: clip(typeof rec.gaps === "string" ? rec.gaps : "", 200),
      citations: stringList(rec.citations),
      reviewPoints: stringList(rec.reviewPoints),
    };
  } catch {
    return null;
  }
}

export function digestReadingText(text: string): { text: string; elided: boolean } {
  const elided = elideMiddle(text, DIGEST_PER_FILE_MODEL_CHARS);
  return { text: elided.text, elided: elided.elided };
}

export function citationAppearsInSource(citation: string, source: string): boolean {
  const quote = citation.replace(/\s+/g, "");
  const body = source.replace(/\s+/g, "");
  if (quote.length < MIN_GROUNDED_CITATION_CHARS) {
    return false;
  }
  return body.includes(quote);
}

export function groundDigestPayload(
  payload: DigestFilePayload,
  source: string,
): { points: string; gaps: string; citations: string[]; reviewPoints: string[] } {
  const citations = payload.citations
    .filter((item) => citationAppearsInSource(item, source))
    .slice(0, 4);
  const reviewPoints = payload.reviewPoints
    .filter((item) => citationAppearsInSource(item, source))
    .slice(0, 4);
  const gaps = [payload.gaps];
  if (citations.length < payload.citations.filter((item) => item.trim()).length) {
    gaps.push("引用未在这份正文出现，已丢弃");
  }
  if (reviewPoints.length < payload.reviewPoints.filter((item) => item.trim()).length) {
    gaps.push("审查要点对不上这份正文，已丢弃");
  }
  if (payload.points && citations.length === 0) {
    gaps.push("要点没有对上正文的引用");
  }
  return {
    points: payload.points,
    gaps: gaps.filter(Boolean).join("；"),
    citations,
    reviewPoints,
  };
}

type PileSource = { abs: string; listedPath: string; size: number };

export async function digestMaterialPile(
  ctx: AgentContext,
  input: {
    goal?: string;
    notGoal?: string;
    path?: string;
    paths?: string[];
    offset?: number;
    maxFiles?: number;
  },
  deps?: {
    summarize?: MaterialDigestSummarizer;
    readImage?: (abs: string) => Promise<string | null>;
  },
): Promise<ToolCallResult> {
  const goal = (input.goal ?? "").replace(/\s+/g, " ").trim();
  if (!goal || isIncompleteWorkerBrief(goal)) {
    return {
      ok: false,
      error:
        "任务书不完整。请写清要从这些材料里抽出什么。不要只写「帮我看看」。写入档案、起草和导出不要放进这次分头读。",
    };
  }
  if (ctx.abortSignal?.aborted) {
    return { ok: false, aborted: true, error: "已停止" };
  }

  const collected = collectSources(ctx, input);
  if (!collected.ok) {
    return { ok: false, error: collected.error };
  }
  const maxFiles = clampInt(input.maxFiles, DIGEST_MAX_FILES, 1, DIGEST_MAX_FILES);
  const offset = clampInt(input.offset, 0, 0, collected.sources.length);
  const window = collected.sources.slice(offset, offset + maxFiles);
  const notRead = collected.sources.slice(offset + window.length).map((row) => row.listedPath);
  const nextOffset = notRead.length > 0 ? offset + window.length : undefined;
  if (window.length === 0) {
    return {
      ok: true,
      data: {
        fileCount: 0,
        cards: [],
        notRead,
        hint:
          collected.sources.length === 0
            ? "没有可读文件。"
            : "这一页没有文件。减小 offset 或换路径。",
      },
    };
  }

  const extracted = await mapPool(window, DIGEST_EXTRACT_CONCURRENCY, async (source, index) => {
    if (ctx.abortSignal?.aborted) {
      return emptyExtract(source, "已停止");
    }
    ctx.emitToolProgress?.(
      `正在读 ${index + 1}/${window.length}：${path.basename(source.listedPath)}`,
    );
    const extractedFile = await extractReadableFileText(source.abs, source.size);
    if (!extractedFile.ok) {
      return emptyExtract(source, extractedFile.reason);
    }
    const reading = digestReadingText(extractedFile.text);
    return {
      source,
      text: extractedFile.text,
      reading: reading.text,
      elided: reading.elided,
      genre: classifyDocumentGenre(source.listedPath, extractedFile.text),
      gap: "",
    };
  });

  const readImage = deps?.readImage ?? readPileImageText;
  let ocrUsed = 0;
  for (let i = 0; i < extracted.length; i += 1) {
    const row = extracted[i];
    if (!row || row.text.trim() || !isOcrImagePath(row.source.abs)) {
      continue;
    }
    if (ctx.abortSignal?.aborted) {
      break;
    }
    if (ocrUsed >= DIGEST_OCR_MAX) {
      extracted[i] = emptyExtract(row.source, "本页图片识别已满，请用分析文书单读这一张");
      continue;
    }
    ocrUsed += 1;
    ctx.emitToolProgress?.(`正在识别图片 ${ocrUsed}：${path.basename(row.source.listedPath)}`);
    const text = (await readImage(row.source.abs))?.trim() ?? "";
    if (!text) {
      extracted[i] = emptyExtract(row.source, "图片未能识别出文字");
      continue;
    }
    const reading = digestReadingText(text);
    extracted[i] = {
      source: row.source,
      text,
      reading: reading.text,
      elided: reading.elided,
      genre: classifyDocumentGenre(row.source.listedPath, text),
      gap: "",
    };
  }

  if (ctx.abortSignal?.aborted) {
    return {
      ok: false,
      aborted: true,
      error: "已停止",
      data: { cards: cardsFromExtracts(extracted, new Map(), true), notRead },
    };
  }

  const summarized = new Map<
    string,
    { points: string; gaps: string; citations: string[]; reviewPoints: string[] }
  >();
  const skipModel = ctx.inReadonlyWorkerLoop === true || !ctx.chatModel;
  const readable = extracted.filter((row) => row.text.trim());
  if (!skipModel && readable.length > 0) {
    const summarize =
      deps?.summarize ?? ((file) => summarizeOneFile(ctx, goal, input.notGoal, file));
    let done = 0;
    await mapPool(readable, DIGEST_MODEL_CONCURRENCY, async (row) => {
      if (ctx.abortSignal?.aborted) {
        return;
      }
      done += 1;
      ctx.emitToolProgress?.(
        `正在归纳 ${done}/${readable.length}：${path.basename(row.source.listedPath)}`,
      );
      try {
        const payload = await summarize({
          goal,
          notGoal: input.notGoal,
          file: {
            path: row.source.listedPath,
            genre: GENRE_LABEL[row.genre],
            text: row.reading,
          },
          signal: ctx.abortSignal,
        });
        summarized.set(
          row.source.listedPath,
          payload
            ? groundDigestPayload(payload, row.text)
            : {
                points: "",
                gaps: "归纳没有返回可用卡片，仅保留摘录",
                citations: [],
                reviewPoints: [],
              },
        );
      } catch (err) {
        if (err instanceof ModelCallUserAbortError || ctx.abortSignal?.aborted) {
          summarized.set(row.source.listedPath, {
            points: "",
            gaps: "已停止",
            citations: [],
            reviewPoints: [],
          });
          return;
        }
        summarized.set(row.source.listedPath, {
          points: "",
          gaps: "归纳失败，仅保留摘录",
          citations: [],
          reviewPoints: [],
        });
      }
    });
  }

  if (ctx.abortSignal?.aborted) {
    return {
      ok: false,
      aborted: true,
      error: "已停止",
      data: { cards: cardsFromExtracts(extracted, summarized, skipModel), notRead },
    };
  }

  const cards = cardsFromExtracts(extracted, summarized, skipModel);
  const suggestedEvents = cards.flatMap((card) => card.events);
  const suggestedReviewRows = cards.flatMap((card) =>
    card.reviewPoints.map((point) => ({
      source: card.path,
      group: card.genre,
      cells: {
        文种: card.genre,
        要点: point,
        引用: card.citations[0] ?? "",
      },
    })),
  );
  return {
    ok: true,
    data: {
      fileCount: cards.length,
      cards,
      suggestedEvents,
      suggestedReviewRows,
      notRead: notRead.slice(0, 40),
      notReadCount: notRead.length,
      ...(nextOffset != null ? { nextOffset } : {}),
      ...(collected.missing && collected.missing.length > 0 ? { missing: collected.missing } : {}),
      truncatedListing: collected.truncated === true,
      hint: digestHint(skipModel, notRead.length),
    },
  };
}

type FileExtract = {
  source: PileSource;
  text: string;
  reading: string;
  elided: boolean;
  genre: DocumentGenre;
  gap: string;
};

type GroundedFile = {
  points: string;
  gaps: string;
  citations: string[];
  reviewPoints: string[];
};

function emptyExtract(source: PileSource, gap: string): FileExtract {
  return {
    source,
    text: "",
    reading: "",
    elided: false,
    genre: classifyDocumentGenre(source.listedPath),
    gap,
  };
}

function digestHint(skipModel: boolean, notReadCount: number): string {
  const page =
    notReadCount > 0 ? `还有 ${notReadCount} 份未读，下次把 offset 设为返回的 nextOffset。` : "";
  const handoff =
    "suggestedEvents 可原样作为 apply_legal_events 的 events；suggestedReviewRows 可原样作为 review_table_update add_rows 的 rows。本工具不写档案、不导出。";
  if (skipModel) {
    return `这些卡片有文种、摘录和从正文抽出的期限候选，还没有逐份判断。${handoff}${page}`;
  }
  return `每份单独归纳。引用对不上该文件正文的已丢弃。${handoff}${page}`;
}

function cardsFromExtracts(
  extracted: FileExtract[],
  summarized: Map<string, GroundedFile>,
  skipModel: boolean,
): MaterialDigestCard[] {
  return extracted.map((row) => {
    const listed = row.source.listedPath;
    const model = summarized.get(listed);
    const gaps = [row.gap, model?.gaps ?? ""].filter(Boolean);
    if (!row.gap && skipModel) {
      gaps.push("未做逐份判断，仅保留摘录和期限候选");
    }
    return {
      path: listed,
      genre: GENRE_LABEL[row.genre],
      points: model?.points ?? "",
      citations: model?.citations ?? [],
      reviewPoints: model?.reviewPoints ?? [],
      events: eventsForFile(row.text, listed),
      gaps: gaps.join("；"),
      excerpt: clip(row.text.replace(/\s+/g, " ").trim(), DIGEST_CARD_EXCERPT_CHARS),
      elided: row.elided,
    };
  });
}

function eventsForFile(text: string, sourcePath: string): MaterialDigestEvent[] {
  if (!text.trim()) {
    return [];
  }
  return extractLegalEvents(text)
    .filter((event) => Boolean(event.dueAt))
    .slice(0, 5)
    .map((event) => ({
      eventKind: event.eventKind,
      title: event.title,
      dueAt: event.dueAt,
      notes: `来自 ${sourcePath}`,
      sourcePath,
    }));
}

async function summarizeOneFile(
  ctx: AgentContext,
  goal: string,
  notGoal: string | undefined,
  input: {
    file: { path: string; genre: string; text: string };
    signal?: AbortSignal;
  },
): Promise<DigestFilePayload | null> {
  const model = ctx.chatModel;
  if (!model) {
    return null;
  }
  const notGoalLine = notGoal?.trim() ? `\n不要做：${notGoal.trim()}` : "";
  const response = await callModelWithRetry(
    model,
    [
      { role: "system", content: DIGEST_MODEL_INSTRUCTIONS },
      {
        role: "user",
        content: `要做：${goal}${notGoalLine}\n文种：${input.file.genre}\n文件：${input.file.path}\n\n${input.file.text}`,
      },
    ],
    [],
    { signal: input.signal },
  );
  const content = response.choices?.[0]?.message?.content ?? "";
  return parseDigestFilePayload(typeof content === "string" ? content : "");
}

function collectSources(
  ctx: AgentContext,
  input: { path?: string; paths?: string[] },
):
  | { ok: true; sources: PileSource[]; truncated?: boolean; missing?: string[] }
  | { ok: false; error: string } {
  const explicit = (input.paths ?? []).map((item) => item.trim()).filter(Boolean);
  if (explicit.length > 0) {
    const sources: PileSource[] = [];
    const missing: string[] = [];
    for (const raw of explicit) {
      const hit = resolveLawyerLocalFile({
        workspaceDir: ctx.workspaceDir,
        projectDir: ctx.projectDir,
        raw,
        pins: ctx.contextPins,
      });
      if (!hit) {
        missing.push(raw);
        continue;
      }
      sources.push(sourceFromAbs(hit.abs, hit.rel));
    }
    if (sources.length === 0) {
      return { ok: false, error: `找不到这些文件：${missing.slice(0, 5).join("、")}` };
    }
    return { ok: true, sources, missing };
  }

  const rawPath = input.path?.trim() ?? "";
  const pinFiles = (ctx.contextPins ?? []).filter(
    (pin): pin is Extract<ComposeContextPin, { pinKind: "file" }> =>
      pin.pinKind === "file" && pin.kind === "file",
  );
  if (!rawPath && pinFiles.length > 0) {
    const sources: PileSource[] = [];
    for (const pin of pinFiles) {
      const hit = resolveLawyerLocalFile({
        workspaceDir: ctx.workspaceDir,
        projectDir: ctx.projectDir,
        raw: pin.relPath,
        pins: ctx.contextPins,
        preferredRoot: pin.root === "project" ? "project" : "workspace",
      });
      if (hit) {
        sources.push(sourceFromAbs(hit.abs, hit.rel));
      }
    }
    if (sources.length > 0) {
      return { ok: true, sources };
    }
  }

  const resolved = resolveDirectoryTarget(ctx, rawPath);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  const walked = walkDirectoryListing(resolved.target.abs, {
    recursive: true,
    homeDir: resolved.target.runtime.homeDir,
    denyPathPatterns: resolved.target.runtime.policy?.denyPathPatterns,
    workspaceDir: resolved.target.runtime.workspaceDir,
  });
  const sources = walked.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => ({
      abs: path.join(resolved.target.abs, entry.path),
      listedPath: joinListedRel(resolved.target.listedPath, entry.path),
      size: entry.size ?? 0,
    }));
  return { ok: true, sources, truncated: walked.truncated };
}

function sourceFromAbs(abs: string, listedPath: string): PileSource {
  let size = 0;
  try {
    size = fs.statSync(abs).size;
  } catch {
    size = 0;
  }
  return { abs, listedPath, size };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() || text;
}

async function readPileImageText(abs: string): Promise<string | null> {
  try {
    const hit = await readImageTextHybrid(abs);
    return hit?.text?.trim() || null;
  } catch {
    return null;
  }
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 6);
}
