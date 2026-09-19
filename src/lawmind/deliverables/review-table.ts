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
};

export type ReviewTableRow = {
  id: string;
  cells: Record<string, string>;
  group?: string;
  /** 来源（材料 relPath / 出处说明）；每行必填才有「可核验」。 */
  source?: string;
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

/** 验收口径：空表不可交付；每行须有来源列（模板含 source 列时）。 */
export function reviewTableAcceptanceProblems(table: ReviewTable): string[] {
  const problems: string[] = [];
  if (table.rows.length === 0) {
    problems.push("审查表为空");
    return problems;
  }
  const sourceKey = table.columns.find((c) => c.key === "source")?.key;
  if (sourceKey) {
    const noSource = table.rows.filter((r) => !(r.cells[sourceKey] ?? "").trim()).length;
    if (noSource > 0) {
      problems.push(`${noSource} 行缺来源`);
    }
  }
  return problems;
}
