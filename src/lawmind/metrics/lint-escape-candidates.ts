import fs from "node:fs";
import path from "node:path";
import { detectStanceClauseType } from "../stance/capture.js";

export type LintEscapeCandidate = {
  ts: string;
  taskId?: string;
  ruleIds: string[];
  snippet?: string;
};

/** `escape-corpus.jsonl`：漏网正文本身，作为规则候选语料。 */
export type LintEscapeCorpusRow = {
  ts: string;
  taskId?: string;
  ruleIds: string[];
  snippet: string;
};

/** `escape-stance.jsonl`：漏网正文命中的条款类型，作为立场候选。 */
export type LintEscapeStanceRow = {
  ts: string;
  taskId?: string;
  clauseType: string;
  snippet: string;
};

/**
 * 读取口径：缺文件 **不等于** 空结果。`present: false` 表示这个来源从未产生过数据，
 * 消费方不得据此推断「逃逸率为 0」。参照 `metrics/north-star.ts` 的
 * 「Missing samples stay null — do not invent a 0% story」。
 */
export type EscapeReadResult<T> = {
  present: boolean;
  rows: T[];
  /** 文件内原始行数（含坏行）；文件不存在时为 0。 */
  totalLines: number;
  /** 被跳过的坏行 / 半写行数——口径显式化，不静默吞掉。 */
  skippedLines: number;
};

export type LintEscapeFiles = {
  candidates: EscapeReadResult<LintEscapeCandidate>;
  corpus: EscapeReadResult<LintEscapeCorpusRow>;
  stance: EscapeReadResult<LintEscapeStanceRow>;
};

function lintEscapeDir(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "lint");
}

function appendJsonl(dest: string, rec: unknown): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.appendFileSync(dest, `${JSON.stringify(rec)}\n`, "utf8");
}

/** 坏行静默跳过（与 `adapters/matter-storage/io.ts` 的 readJsonl 同口径），但把跳过数报出来。 */
function readJsonlTolerant<T>(
  filePath: string,
  validate: (row: Record<string, unknown>) => T | undefined,
): EscapeReadResult<T> {
  if (!fs.existsSync(filePath)) {
    return { present: false, rows: [], totalLines: 0, skippedLines: 0 };
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const rows: T[] = [];
  let totalLines = 0;
  let skippedLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    totalLines += 1;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        skippedLines += 1;
        continue;
      }
      const row = validate(parsed as Record<string, unknown>);
      if (!row) {
        skippedLines += 1;
        continue;
      }
      rows.push(row);
    } catch {
      // JSONL 追加中途崩溃会留半行——跳过，不抛。
      skippedLines += 1;
    }
  }
  return { present: true, rows, totalLines, skippedLines };
}

function asStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
}

export function readEscapeCandidates(workspaceDir: string): EscapeReadResult<LintEscapeCandidate> {
  return readJsonlTolerant(
    path.join(lintEscapeDir(workspaceDir), "escape-candidates.jsonl"),
    (r) => {
      const ts = asStringOrUndefined(r.ts);
      if (!ts) {
        return undefined;
      }
      return {
        ts,
        ...(asStringOrUndefined(r.taskId) ? { taskId: asStringOrUndefined(r.taskId)! } : {}),
        ruleIds: asStringArray(r.ruleIds),
        ...(asStringOrUndefined(r.snippet) ? { snippet: asStringOrUndefined(r.snippet)! } : {}),
      };
    },
  );
}

export function readEscapeCorpus(workspaceDir: string): EscapeReadResult<LintEscapeCorpusRow> {
  return readJsonlTolerant(path.join(lintEscapeDir(workspaceDir), "escape-corpus.jsonl"), (r) => {
    const ts = asStringOrUndefined(r.ts);
    const snippet = asStringOrUndefined(r.snippet);
    if (!ts || !snippet) {
      return undefined;
    }
    return {
      ts,
      ...(asStringOrUndefined(r.taskId) ? { taskId: asStringOrUndefined(r.taskId)! } : {}),
      ruleIds: asStringArray(r.ruleIds),
      snippet,
    };
  });
}

export function readEscapeStance(workspaceDir: string): EscapeReadResult<LintEscapeStanceRow> {
  return readJsonlTolerant(path.join(lintEscapeDir(workspaceDir), "escape-stance.jsonl"), (r) => {
    const ts = asStringOrUndefined(r.ts);
    const snippet = asStringOrUndefined(r.snippet);
    const clauseType = asStringOrUndefined(r.clauseType);
    if (!ts || !snippet || !clauseType) {
      return undefined;
    }
    return {
      ts,
      ...(asStringOrUndefined(r.taskId) ? { taskId: asStringOrUndefined(r.taskId)! } : {}),
      clauseType,
      snippet,
    };
  });
}

/** 一次性读齐三个逃逸文件（飞轮的读取端）。 */
export function readLintEscapeFiles(workspaceDir: string): LintEscapeFiles {
  return {
    candidates: readEscapeCandidates(workspaceDir),
    corpus: readEscapeCorpus(workspaceDir),
    stance: readEscapeStance(workspaceDir),
  };
}

/**
 * Three-way flywheel: rule candidate + corpus snippet + stance candidate.
 * Does not write LAWYER_PROFILE or stance items.json.
 */
export function distributeLintEscape(
  workspaceDir: string,
  row: { taskId?: string; ruleIds: string[]; snippet?: string },
): void {
  const snippet = row.snippet?.replace(/\s+/g, " ").trim().slice(0, 400);
  const ts = new Date().toISOString();
  const dir = lintEscapeDir(workspaceDir);
  appendJsonl(path.join(dir, "escape-candidates.jsonl"), {
    ts,
    taskId: row.taskId,
    ruleIds: row.ruleIds,
    ...(snippet ? { snippet } : {}),
  } satisfies LintEscapeCandidate);
  if (!snippet) {
    return;
  }
  appendJsonl(path.join(dir, "escape-corpus.jsonl"), {
    ts,
    taskId: row.taskId,
    snippet,
    ruleIds: row.ruleIds,
  });
  const clauseType = detectStanceClauseType(snippet);
  if (clauseType) {
    appendJsonl(path.join(dir, "escape-stance.jsonl"), {
      ts,
      taskId: row.taskId,
      clauseType,
      snippet,
    });
  }
}
