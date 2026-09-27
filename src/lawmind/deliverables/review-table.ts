/**
 * review.table — 结构化审查表交付物（对标 Harvey Review Tables）。
 *
 * 尽调 / 证据审查 / 条款矩阵三类模板。草稿正文 sections 只放结论与说明；
 * 表格本体存 sidecar `drafts/<taskId>.table.json`，导出 xlsx/docx 从 sidecar 出。
 */

import fs from "node:fs";
import path from "node:path";

export type ReviewTableTemplate = "due_diligence" | "evidence" | "clause_matrix";

export type ReviewTableColumn = {
  key: string;
  label: string;
  /**
   * 该列的抽取提示（批量抽取时给执行器）。缺省用 label。
   * 列级提示让「同一张表换列 = 换要抽的东西」，不必新建交付物类型。
   */
  prompt?: string;
};

/**
 * 单元格级溯源与诚实度。
 * 规则：每格要么有 source，要么显式弃答（abstained），不得编造。
 */
export type ReviewCellMeta = {
  /** 出处：材料 relPath，可带定位（#page=2 / #h=条款标题）。 */
  source?: string;
  confidence?: "high" | "medium" | "low";
  /** 证据不足时的显式弃答；cell 值写「无法判断」而不是猜。 */
  abstained?: boolean;
  /** 抽取方式说明（OCR / 正则 / 模型）。 */
  note?: string;
};

export type ReviewTableRow = {
  id: string;
  cells: Record<string, string>;
  group?: string;
  /** 来源（材料 relPath / 出处说明）；每行必填才有「可核验」。 */
  source?: string;
  /** 逐格溯源；批量抽取时由执行器填写。 */
  cellMeta?: Record<string, ReviewCellMeta>;
  /** 审核状态（本地持久；零协同依赖）。 */
  review?: CellReviewState;
};

/** 表格审核状态：只记录律师/引擎真正碰过的格子，不强制任何流程。 */
export type CellReviewState = {
  /** 已被看过（导入或人工确认）。 */
  reviewed?: boolean;
  /** 锁定：批量重抽不得覆盖。 */
  locked?: boolean;
  /** 指派给谁（可选，纯记录）。 */
  assignee?: string;
  updatedAt?: string;
};

export type ReviewTable = {
  taskId: string;
  template: ReviewTableTemplate;
  title: string;
  columns: ReviewTableColumn[];
  rows: ReviewTableRow[];
  updatedAt: string;
};

export const REVIEW_TABLE_TEMPLATES: Record<
  ReviewTableTemplate,
  { label: string; columns: ReviewTableColumn[] }
> = {
  due_diligence: {
    label: "尽调审查表",
    columns: [
      { key: "item", label: "审查事项" },
      { key: "document", label: "对应文件" },
      { key: "finding", label: "发现" },
      { key: "risk", label: "风险等级" },
      { key: "source", label: "来源" },
    ],
  },
  evidence: {
    label: "证据审查表",
    columns: [
      { key: "exhibit", label: "证据名称" },
      { key: "purpose", label: "证明目的" },
      { key: "issue", label: "关联争点" },
      { key: "strength", label: "证明力" },
      { key: "source", label: "来源" },
    ],
  },
  clause_matrix: {
    label: "条款对照矩阵",
    columns: [
      { key: "clause", label: "条款" },
      { key: "our_text", label: "我方文本" },
      { key: "their_text", label: "对方文本" },
      { key: "risk", label: "风险" },
      { key: "suggestion", label: "建议" },
      { key: "source", label: "来源" },
    ],
  },
};

export function reviewTablePath(workspaceDir: string, taskId: string): string {
  return path.join(path.resolve(workspaceDir), "drafts", `${taskId}.table.json`);
}

export function readReviewTable(workspaceDir: string, taskId: string): ReviewTable | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(reviewTablePath(workspaceDir, taskId), "utf8"),
    ) as ReviewTable;
    if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

export function writeReviewTable(workspaceDir: string, table: ReviewTable): void {
  const file = reviewTablePath(workspaceDir, table.taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ ...table, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

export function newReviewTable(
  taskId: string,
  template: ReviewTableTemplate,
  title?: string,
): ReviewTable {
  const t = REVIEW_TABLE_TEMPLATES[template];
  return {
    taskId,
    template,
    title: title?.trim() || t.label,
    columns: t.columns.map((c) => ({ ...c })),
    rows: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Markdown 预览（写进草稿栏目，供对话与 docx 导出共用）。 */
export function reviewTableToMarkdown(table: ReviewTable): string {
  if (table.rows.length === 0) {
    return "（空表：先用 review_table_update 填充行）";
  }
  const header = `| ${table.columns.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${table.columns.map(() => "---").join(" | ")} |`;
  const lines = table.rows.map((row) => {
    const cells = table.columns.map((c) => (row.cells[c.key] ?? "").replace(/\|/g, "｜"));
    return `| ${cells.join(" | ")} |`;
  });
  return [header, sep, ...lines].join("\n");
}

/** xlsx 导出行（首行表头）。 */
export function reviewTableToXlsxRows(table: ReviewTable): unknown[][] {
  const header = table.columns.map((c) => c.label);
  const rows = table.rows.map((row) => table.columns.map((c) => row.cells[c.key] ?? ""));
  return [header, ...rows];
}

/** 弃答标记值：抽不动时写这个，不猜。 */
export const REVIEW_TABLE_ABSTAIN_TEXT = "无法判断（证据不足）";

/**
 * 识别「文件名列」：批量抽取时每行填材料名，且**不作为抽取目标**
 * （它是元数据，不是要从正文里抽的内容）。source 列同理。
 */
const REVIEW_NAME_COLUMN_KEYS = new Set([
  "document",
  "item",
  "exhibit",
  "clause",
  "name",
  "file",
  "doc",
]);

/** 行身份列的标签。整词匹配，避免「付款条款」「违约事项」被当成文件名列而跳过抽取。 */
const REVIEW_NAME_COLUMN_LABELS = new Set([
  "审查事项",
  "对应文件",
  "证据名称",
  "条款",
  "文件名",
  "事项",
]);

export function detectNameColumnKeys(table: {
  columns: { key: string; label: string }[];
}): string[] {
  return table.columns
    .filter(
      (c) =>
        REVIEW_NAME_COLUMN_KEYS.has(c.key.trim().toLowerCase()) ||
        REVIEW_NAME_COLUMN_LABELS.has(c.label.trim()),
    )
    .map((c) => c.key);
}

/** 批量抽取的目标列：排除来源列与文件名列。 */
export function reviewTableValueColumns(table: {
  columns: { key: string; label: string }[];
}): { key: string; label: string }[] {
  const sourceKey = table.columns.find((c) => c.key === "source")?.key;
  const nameKeys = new Set(detectNameColumnKeys(table));
  return table.columns.filter((c) => c.key !== sourceKey && !nameKeys.has(c.key));
}

/** 表格里所有非元数据列（用于验收与溯源统计）。 */
export function reviewTableContentColumns(table: {
  columns: { key: string; label: string }[];
}): { key: string; label: string }[] {
  const sourceKey = table.columns.find((c) => c.key === "source")?.key;
  return table.columns.filter((c) => c.key !== sourceKey);
}

/** 逐格溯源状态（供验收与 UI 共用）。 */
export type CellProvenance =
  | { state: "sourced"; source: string; confidence?: "high" | "medium" | "low" }
  | { state: "abstained"; reason?: string }
  | { state: "missing" };

export function cellProvenance(row: ReviewTableRow, columnKey: string): CellProvenance {
  const meta = row.cellMeta?.[columnKey];
  const value = (row.cells[columnKey] ?? "").trim();
  if (meta?.abstained || value === REVIEW_TABLE_ABSTAIN_TEXT) {
    return { state: "abstained", ...(meta?.note ? { reason: meta.note } : {}) };
  }
  // 行级 source 只标识「这行是哪份材料」，不能替实质格充当出处。
  // Harvey 审查表的引用在格子上；文件名列有值不等于发现格可核验。
  const source = (meta?.source ?? "").trim();
  if (source) {
    return {
      state: "sourced",
      source,
      ...(meta?.confidence ? { confidence: meta.confidence } : {}),
    };
  }
  return { state: "missing" };
}

/**
 * 验收口径：空表不可交付。
 * 实质列（发现、风险、建议等）每一格要么有**本格**出处，要么显式弃答。
 * 行级文件名 / 「来源」列只说明材料是谁，不能把旁边猜出来的格子洗成合格。
 * 「显式弃答」是诚实交付，不算缺口。
 */
export function reviewTableAcceptanceProblems(table: ReviewTable): string[] {
  const problems: string[] = [];
  if (table.rows.length === 0) {
    problems.push("审查表为空");
    return problems;
  }
  const valueColumns = reviewTableValueColumns(table);
  let unsourcedRows = 0;
  for (const row of table.rows) {
    const hasUnsourcedValue = valueColumns.some((c) => {
      const value = (row.cells[c.key] ?? "").trim();
      if (!value) {
        return false;
      }
      return cellProvenance(row, c.key).state === "missing";
    });
    if (hasUnsourcedValue) {
      unsourcedRows += 1;
    }
  }
  if (unsourcedRows > 0) {
    problems.push(`${unsourcedRows} 行缺来源`);
  }
  return problems;
}

/**
 * 律师在表格里改字时保留锁定与未改动格子的出处。
 * 改过的格子丢掉旧出处，避免「原文引用还挂在律师改过的句子上」。
 */
export function mergeLawyerReviewRows(
  previous: ReviewTableRow[],
  incoming: ReviewTableRow[],
): ReviewTableRow[] {
  const prevById = new Map(previous.map((row) => [row.id, row]));
  const merged = incoming.map((row) => {
    const prev = prevById.get(row.id);
    if (!prev) {
      return row;
    }
    // 锁定只防重抽和误保存。律师显式解除锁定（locked: false）后，这一次提交才改格子。
    if (prev.review?.locked && row.review?.locked !== false) {
      return prev;
    }
    const cellMeta: Record<string, ReviewCellMeta> = { ...prev.cellMeta };
    const keys = new Set([...Object.keys(prev.cells), ...Object.keys(row.cells)]);
    for (const key of keys) {
      if ((prev.cells[key] ?? "").trim() !== (row.cells[key] ?? "").trim()) {
        delete cellMeta[key];
      }
    }
    const keptMeta = Object.keys(cellMeta).length > 0 ? cellMeta : undefined;
    return {
      ...row,
      source: row.source ?? prev.source,
      ...(keptMeta ? { cellMeta: keptMeta } : {}),
      ...(row.review || prev.review ? { review: row.review ?? prev.review } : {}),
    };
  });
  const seen = new Set(merged.map((row) => row.id));
  for (const prev of previous) {
    if (prev.review?.locked && !seen.has(prev.id)) {
      merged.push(prev);
    }
  }
  return merged;
}

/** 第二张工作表：逐格出处。主表仍是律师要看的值，出处不混进同一张网格。 */
export function reviewTableProvenanceXlsxRows(table: ReviewTable): unknown[][] {
  const header = ["行", "列", "值", "状态", "出处", "置信度", "备注"];
  const rows: unknown[][] = [header];
  const nameKeys = new Set(detectNameColumnKeys(table));
  for (const row of table.rows) {
    const label = (row.cells[table.columns[0]?.key ?? ""] ?? "").trim() || row.id;
    for (const col of table.columns) {
      if (col.key === "source" || nameKeys.has(col.key)) {
        continue;
      }
      const prov = cellProvenance(row, col.key);
      const value = row.cells[col.key] ?? "";
      if (!value.trim() && prov.state === "missing") {
        continue;
      }
      rows.push([
        label,
        col.label,
        value,
        prov.state === "sourced" ? "有出处" : prov.state === "abstained" ? "弃答" : "缺出处",
        prov.state === "sourced" ? prov.source : (row.source ?? ""),
        prov.state === "sourced" ? (prov.confidence ?? "") : "",
        prov.state === "abstained" ? (prov.reason ?? "") : (row.cellMeta?.[col.key]?.note ?? ""),
      ]);
    }
  }
  return rows;
}
