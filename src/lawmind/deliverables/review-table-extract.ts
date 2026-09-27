/**
 * 审查表批量抽取执行器（对标 Harvey Review Tables 的规模化抽取）。
 *
 * 设计约束——**交付前不让律师介入**：
 * - 一次交办把整批材料抽完，不向律师提问、不要求逐格确认。
 * - 每格要么带出处，要么显式弃答（「无法判断（证据不足）」），**绝不编造**。
 * - 扫描件/图片走 OCR 兜底；**只读**抽取不进案件知识库，因此不设律师确认闸门
 *   （`ingest/ocr` 的确认闸门针对的是"写入知识库"，不是"读来抽格子"）。
 * - OCR 兜底失败即弃答，不空跑、不假装成功。
 *
 * 执行器（模型调用 / OCR / 取文）由调用方注入，便于离线测试与替换。
 */

import {
  REVIEW_TABLE_ABSTAIN_TEXT,
  detectNameColumnKeys,
  type ReviewCellMeta,
  type ReviewTable,
  type ReviewTableRow,
} from "./review-table.js";

export type ReviewDocKind = "text" | "image" | "pdf" | "docx" | "xlsx" | "unknown";

export type ReviewExtractDoc = {
  /** 相对路径；写进 source 与来源列。 */
  relPath: string;
  /** 已抽取正文；空/缺省时触发 OCR 兜底（若有 absolutePath）。 */
  text?: string;
  /** 本地绝对路径，供 OCR / 二次取文兜底。 */
  absolutePath?: string;
  kind?: ReviewDocKind;
  fileName?: string;
};

export type ReviewExtractColumnSpec = {
  key: string;
  label: string;
  prompt?: string;
};

export type ReviewExtractCellOk = {
  ok: true;
  value: string;
  /** 文档内定位（如页号/条款号）；会拼进 source。 */
  locator?: string;
  confidence?: "high" | "medium" | "low";
  note?: string;
};

export type ReviewExtractCellFail = {
  ok: false;
  /** 弃答原因；必填，避免静默空值。 */
  reason: string;
};

export type ReviewExtractCellResult = ReviewExtractCellOk | ReviewExtractCellFail;

export type ReviewCellExtractor = (input: {
  doc: ReviewExtractDoc;
  column: ReviewExtractColumnSpec;
  /** 传给抽取器的正文（可能来自 OCR 兜底）。 */
  text: string;
  /** 正文是否是 OCR 得来（置信度默认降级）。 */
  fromOcr: boolean;
}) => Promise<ReviewExtractCellResult>;

export type ReviewOcrResult =
  | { ok: true; text: string; provider: string }
  | { ok: false; error: string };

export type ReviewOcr = (absolutePath: string) => Promise<ReviewOcrResult>;

export type ReviewReadText = (absolutePath: string) => Promise<string | undefined>;

export type ReviewExtractProgress = {
  phase: "read" | "ocr" | "cell" | "row" | "done";
  docIndex: number;
  docTotal: number;
  relPath: string;
  /** 已完成单元格数 / 预计总数。 */
  cellsDone: number;
  cellsTotal: number;
  /** 供 SSE 用的短句。 */
  message: string;
};

export type ReviewExtractStats = {
  docs: number;
  cells: number;
  filled: number;
  abstained: number;
  ocrUsed: number;
  ocrFailed: number;
  readFailed: number;
  /** 因缺正文且无 OCR 可用而整行弃答的文档数。 */
  rowsWithoutText: number;
};

export type ReviewExtractResult = {
  table: ReviewTable;
  stats: ReviewExtractStats;
};

const IMAGE_KINDS: ReadonlySet<ReviewDocKind> = new Set<ReviewDocKind>(["image"]);

export function guessDocKind(relPath: string): ReviewDocKind {
  const lower = relPath.toLowerCase();
  if (/\.(png|jpe?g|webp|tiff?|bmp)$/.test(lower)) {
    return "image";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (/\.docx?$/.test(lower)) {
    return "docx";
  }
  if (/\.xlsx?$/.test(lower)) {
    return "xlsx";
  }
  if (/\.(md|txt|markdown|json|csv)$/.test(lower)) {
    return "text";
  }
  return "unknown";
}

/** 行 id 由序号 + 路径哈希决定，同一批材料两次抽取得到同一套 id，锁定与 diff 才对得上。 */
export function stableReviewRowId(index: number, relPath: string): string {
  let hash = 2166136261;
  for (let i = 0; i < relPath.length; i += 1) {
    hash ^= relPath.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
  return `row-${index}-${hex}`;
}

/**
 * 批量重抽不得覆盖已锁定的行。按材料路径对齐；这份材料已不在本轮清单里时，锁定行仍保留。
 */
export function preserveLockedReviewRows(
  previous: ReviewTableRow[],
  next: ReviewTableRow[],
): ReviewTableRow[] {
  const locked = previous.filter((row) => row.review?.locked);
  if (locked.length === 0) {
    return next;
  }
  const bySource = new Map<string, ReviewTableRow>();
  for (const row of locked) {
    const key = (row.source ?? "").trim();
    if (key) {
      bySource.set(key, row);
    }
  }
  const used = new Set<string>();
  const merged = next.map((row) => {
    const key = (row.source ?? "").trim();
    const keep = key ? bySource.get(key) : undefined;
    if (!keep || used.has(keep.id)) {
      return row;
    }
    used.add(keep.id);
    return keep;
  });
  for (const row of locked) {
    if (!used.has(row.id)) {
      merged.push(row);
    }
  }
  return merged;
}

/** 拼出处：relPath 加定位片段。 */
export function buildCellSource(relPath: string, locator?: string): string {
  const base = relPath.trim();
  const loc = (locator ?? "").trim();
  if (!loc) {
    return base;
  }
  const norm = loc.startsWith("#") ? loc : `#${loc}`;
  return `${base}${norm}`;
}

/**
 * 按文档有界并发跑「文档 × 列」抽取。
 * 每完成一格发一次进度（供 SSE），不等待任何人工确认。
 */
export async function extractReviewTable(opts: {
  table: ReviewTable;
  docs: ReviewExtractDoc[];
  extractCell: ReviewCellExtractor;
  ocr?: ReviewOcr;
  readText?: ReviewReadText;
  /** 只抽这些列；缺省抽所有非 source 列。 */
  columnKeys?: string[];
  /** 并发文档数（默认 4）。 */
  concurrency?: number;
  /** 每文档最多多少字进抽取（默认 200k，防空转与爆上下文）。 */
  maxCharsPerDoc?: number;
  onProgress?: (e: ReviewExtractProgress) => void;
  signal?: AbortSignal;
}): Promise<ReviewExtractResult> {
  const sourceKey = opts.table.columns.find((c) => c.key === "source")?.key;
  const nameKeys = new Set(detectNameColumnKeys(opts.table));
  const allTargets = opts.table.columns.filter((c) => c.key !== sourceKey && !nameKeys.has(c.key));
  const wanted = opts.columnKeys?.length
    ? allTargets.filter((c) => opts.columnKeys!.includes(c.key))
    : allTargets;

  const columns: ReviewExtractColumnSpec[] = wanted.map((c) => ({
    key: c.key,
    label: c.label,
    ...(c.prompt ? { prompt: c.prompt } : {}),
  }));

  const docs = opts.docs;
  const cellsTotal = docs.length * columns.length;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 16));
  const maxChars = opts.maxCharsPerDoc ?? 200_000;

  const stats: ReviewExtractStats = {
    docs: docs.length,
    cells: 0,
    filled: 0,
    abstained: 0,
    ocrUsed: 0,
    ocrFailed: 0,
    readFailed: 0,
    rowsWithoutText: 0,
  };
  let cellsDone = 0;

  const rows = Array.from<ReviewTableRow>({ length: docs.length });

  const emit = (e: Omit<ReviewExtractProgress, "cellsDone" | "cellsTotal">) => {
    opts.onProgress?.({ ...e, cellsDone, cellsTotal });
  };

  const resolveText = async (
    doc: ReviewExtractDoc,
    docIndex: number,
  ): Promise<{ text: string; fromOcr: boolean; ocrFailed: boolean }> => {
    const inline = (doc.text ?? "").trim();
    if (inline) {
      return { text: inline.slice(0, maxChars), fromOcr: false, ocrFailed: false };
    }
    const kind = doc.kind ?? guessDocKind(doc.relPath);
    // 二次取文（docx/xlsx/pdf 有本地抽取器时）
    if (opts.readText && doc.absolutePath) {
      const read = await opts.readText(doc.absolutePath);
      if (read && read.trim()) {
        return { text: read.trim().slice(0, maxChars), fromOcr: false, ocrFailed: false };
      }
      stats.readFailed += 1;
    }
    // 只读 OCR 兜底：扫描件/图片/无文本 PDF。不写知识库，因此无需律师确认。
    if (
      opts.ocr &&
      doc.absolutePath &&
      (IMAGE_KINDS.has(kind) || kind === "pdf" || kind === "unknown")
    ) {
      emit({
        phase: "ocr",
        docIndex,
        docTotal: docs.length,
        relPath: doc.relPath,
        message: `扫描件识别中：${doc.relPath}`,
      });
      const res = await opts.ocr(doc.absolutePath);
      if (res.ok && res.text.trim()) {
        stats.ocrUsed += 1;
        return { text: res.text.trim().slice(0, maxChars), fromOcr: true, ocrFailed: false };
      }
      stats.ocrFailed += 1;
      return { text: "", fromOcr: false, ocrFailed: true };
    }
    return { text: "", fromOcr: false, ocrFailed: false };
  };

  const buildRow = (doc: ReviewExtractDoc, index: number): ReviewTableRow => {
    const cells: Record<string, string> = {};
    const cellMeta: Record<string, ReviewCellMeta> = {};
    if (nameKeys.size > 0) {
      const label = doc.fileName?.trim() || doc.relPath.split("/").pop() || doc.relPath;
      for (const key of nameKeys) {
        cells[key] = label;
      }
    }
    if (sourceKey) {
      cells[sourceKey] = doc.relPath;
    }
    return {
      id: stableReviewRowId(index, doc.relPath),
      cells,
      cellMeta,
      source: doc.relPath,
    };
  };

  const extractOne = async (doc: ReviewExtractDoc, index: number): Promise<ReviewTableRow> => {
    const row = buildRow(doc, index);
    const { text, fromOcr, ocrFailed } = await resolveText(doc, index);

    if (!text) {
      // 无正文：整行显式弃答，逐格写原因，绝不编造。
      // 原因按这一份材料自己的 OCR 结果写，不用全局计数（并发时别的材料失败会串味）。
      stats.rowsWithoutText += 1;
      const reason = ocrFailed ? "扫描件未能识别出正文" : "该材料无可用正文";
      for (const col of columns) {
        row.cells[col.key] = REVIEW_TABLE_ABSTAIN_TEXT;
        row.cellMeta![col.key] = { abstained: true, note: reason, confidence: "low" };
        stats.cells += 1;
        stats.abstained += 1;
        cellsDone += 1;
      }
      emit({
        phase: "row",
        docIndex: index,
        docTotal: docs.length,
        relPath: doc.relPath,
        message: `${doc.relPath}：无可用正文，已逐格弃答`,
      });
      return row;
    }

    for (const col of columns) {
      if (opts.signal?.aborted) {
        row.cells[col.key] = REVIEW_TABLE_ABSTAIN_TEXT;
        row.cellMeta![col.key] = { abstained: true, note: "已取消", confidence: "low" };
        stats.cells += 1;
        stats.abstained += 1;
        cellsDone += 1;
        continue;
      }
      let result: ReviewExtractCellResult;
      try {
        result = await opts.extractCell({ doc, column: col, text, fromOcr });
      } catch (e) {
        result = { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
      stats.cells += 1;
      if (result.ok && result.value.trim()) {
        row.cells[col.key] = result.value.trim();
        const meta: ReviewCellMeta = {
          source: buildCellSource(doc.relPath, result.locator),
          confidence: result.confidence ?? (fromOcr ? "low" : "medium"),
          ...(result.note ? { note: result.note } : fromOcr ? { note: "OCR 只读抽取" } : {}),
        };
        row.cellMeta![col.key] = meta;
        stats.filled += 1;
      } else {
        row.cells[col.key] = REVIEW_TABLE_ABSTAIN_TEXT;
        row.cellMeta![col.key] = {
          abstained: true,
          note: result.ok ? "证据不足" : result.reason,
          confidence: "low",
        };
        stats.abstained += 1;
      }
      cellsDone += 1;
      emit({
        phase: "cell",
        docIndex: index,
        docTotal: docs.length,
        relPath: doc.relPath,
        message: `${doc.relPath} · ${col.label}`,
      });
    }
    return row;
  };

  // 有界并发：文档为工作单元，避免一次打满模型配额。
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(docs.length, 1)) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= docs.length) {
          return;
        }
        const doc = docs[index];
        emit({
          phase: "read",
          docIndex: index,
          docTotal: docs.length,
          relPath: doc.relPath,
          message: `读取：${doc.relPath}`,
        });
        rows[index] = await extractOne(doc, index);
      }
    },
  );
  await Promise.all(workers);

  emit({
    phase: "done",
    docIndex: docs.length,
    docTotal: docs.length,
    relPath: "",
    message: `抽取完成：${stats.filled} 格有出处 · ${stats.abstained} 格弃答`,
  });

  const extracted: ReviewTableRow[] = opts.docs.map((_, i) => rows[i]).filter(Boolean);
  const merged = preserveLockedReviewRows(opts.table.rows, extracted);

  return {
    table: {
      ...opts.table,
      rows: merged,
      updatedAt: new Date().toISOString(),
    },
    stats,
  };
}

/** 汇总一句话，供对话与 Doctor 展示（不暴露内部实现）。 */
export function summarizeReviewExtract(stats: ReviewExtractStats): string {
  const parts = [
    `${stats.docs} 份材料 · ${stats.cells} 格`,
    `${stats.filled} 格有出处`,
    `${stats.abstained} 格弃答`,
  ];
  if (stats.ocrUsed > 0) {
    parts.push(`${stats.ocrUsed} 份走扫描件识别`);
  }
  if (stats.ocrFailed > 0) {
    parts.push(`${stats.ocrFailed} 份扫描件未能识别`);
  }
  return parts.join(" · ");
}
