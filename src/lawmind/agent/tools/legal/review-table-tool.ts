/**
 * review_table_update — 审查表（review.table）的结构化编辑工具。
 *
 * 表格本体存 sidecar（drafts/<taskId>.table.json）；每次写入后把 markdown 预览
 * 同步进草稿「审查表」栏目，对话与导出共用同一真相源。
 */

import { randomUUID } from "node:crypto";
import {
  newReviewTable,
  readReviewTable,
  reviewTableAcceptanceProblems,
  reviewTableToMarkdown,
  writeReviewTable,
  REVIEW_TABLE_TEMPLATES,
  type ReviewTable,
  type ReviewTableColumn,
  type ReviewTableRow,
  type ReviewTableTemplate,
} from "../../../deliverables/review-table.js";
import { listMatterMaterialFiles } from "../../../desk/matter-materials.js";
import { readDraft, persistDraft } from "../../../drafts/index.js";
import type { AgentTool } from "../../types.js";

const ACTIONS = [
  "set_template",
  "set_columns",
  "add_rows",
  "update_cells",
  "group_by",
  "import_materials_metadata",
] as const;
type ReviewTableAction = (typeof ACTIONS)[number];

function asColumns(raw: unknown): ReviewTableColumn[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: ReviewTableColumn[] = [];
  for (const row of raw) {
    const rec = row as { key?: unknown; label?: unknown };
    if (
      typeof rec.key === "string" &&
      rec.key.trim() &&
      typeof rec.label === "string" &&
      rec.label.trim()
    ) {
      out.push({ key: rec.key.trim(), label: rec.label.trim() });
    }
  }
  return out.length > 0 ? out : undefined;
}

function asRows(raw: unknown): ReviewTableRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ReviewTableRow[] = [];
  for (const row of raw) {
    const rec = row as { cells?: unknown; group?: unknown; source?: unknown };
    const cells: Record<string, string> = {};
    if (rec.cells && typeof rec.cells === "object" && !Array.isArray(rec.cells)) {
      for (const [k, v] of Object.entries(rec.cells as Record<string, unknown>)) {
        cells[k] = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
      }
    }
    out.push({
      id: randomUUID(),
      cells,
      ...(typeof rec.group === "string" && rec.group.trim() ? { group: rec.group.trim() } : {}),
      ...(typeof rec.source === "string" && rec.source.trim() ? { source: rec.source.trim() } : {}),
    });
  }
  return out;
}

/** 把表格 markdown 预览同步进草稿的「审查表」栏目（没有则追加）。 */
function syncDraftPreview(workspaceDir: string, table: ReviewTable): void {
  const draft = readDraft(workspaceDir, table.taskId);
  if (!draft) {
    return;
  }
  const markdown = reviewTableToMarkdown(table);
  const idx = draft.sections.findIndex((s) => /审查表|明细|表格/.test(s.heading));
  const sections = [...draft.sections];
  if (idx >= 0) {
    sections[idx] = { ...sections[idx], body: markdown };
  } else {
    sections.push({ heading: "审查表", body: markdown, citations: [] });
  }
  persistDraft(workspaceDir, { ...draft, sections });
}

export const reviewTableUpdate: AgentTool = {
  definition: {
    name: "review_table_update",
    description:
      "编辑审查表（review.table）：set_template 建表 / set_columns 改列 / add_rows 批量加行 / update_cells 批量改格 / group_by 按列分组 / import_materials_metadata 从本案材料导入行。",
    category: "draft",
    parameters: {
      task_id: { type: "string", description: "审查表草稿 taskId" },
      action: { type: "string", description: `动作：${ACTIONS.join(" / ")}`, required: true },
      template: {
        type: "string",
        description: "set_template：due_diligence | evidence | clause_matrix",
      },
      columns: { type: "array", description: "set_columns：[{key,label}]" },
      rows: { type: "array", description: "add_rows：[{cells:{列key:值}, group?, source?}]" },
      updates: { type: "array", description: "update_cells：[{rowId, cells:{列key:值}}]" },
      column: { type: "string", description: "group_by：按哪一列分组（列 key）" },
    },
  },
  async execute(params, ctx) {
    const taskId = typeof params.task_id === "string" ? params.task_id.trim() : "";
    if (!taskId) {
      return { ok: false, error: "缺少 task_id。" };
    }
    const draft = readDraft(ctx.workspaceDir, taskId);
    if (!draft) {
      return { ok: false, error: `找不到草稿 ${taskId}。请先 draft_document 建审查表草稿。` };
    }
    const action =
      typeof params.action === "string" ? (params.action.trim() as ReviewTableAction) : "";
    if (!ACTIONS.includes(action as ReviewTableAction)) {
      return { ok: false, error: `未知动作 ${action}。可用：${ACTIONS.join(" / ")}` };
    }

    let table = readReviewTable(ctx.workspaceDir, taskId);
    if (action === "set_template") {
      const template = (
        typeof params.template === "string" ? params.template.trim() : ""
      ) as ReviewTableTemplate;
      if (!REVIEW_TABLE_TEMPLATES[template]) {
        return {
          ok: false,
          error: `未知模板 ${template}。可用：${Object.keys(REVIEW_TABLE_TEMPLATES).join(" / ")}`,
        };
      }
      table = newReviewTable(taskId, template, draft.title);
    }
    if (!table) {
      return {
        ok: false,
        error: "还没有审查表。请先 set_template（due_diligence / evidence / clause_matrix）。",
      };
    }

    let note = "";
    if (action === "set_template") {
      note = `已建 ${REVIEW_TABLE_TEMPLATES[table.template].label}（${table.columns.length} 列）。`;
    } else if (action === "set_columns") {
      const columns = asColumns(params.columns);
      if (!columns) {
        return { ok: false, error: "set_columns 需要非空 columns：[{key,label}]。" };
      }
      table = { ...table, columns };
      note = `已更新列（${columns.length} 列）。`;
    } else if (action === "add_rows") {
      const rows = asRows(params.rows);
      if (rows.length === 0) {
        return { ok: false, error: "add_rows 需要非空 rows。" };
      }
      // 行级 source 同步进来源列（若有），保证「每行需来源」口径一致可核验。
      const sourceKey = table.columns.find((c) => c.key === "source")?.key;
      const normalized = sourceKey
        ? rows.map((row) =>
            row.source && !(row.cells[sourceKey] ?? "").trim()
              ? { ...row, cells: { ...row.cells, [sourceKey]: row.source } }
              : row,
          )
        : rows;
      table = { ...table, rows: [...table.rows, ...normalized] };
      note = `已加 ${rows.length} 行（共 ${table.rows.length} 行）。`;
    } else if (action === "update_cells") {
      const updates = Array.isArray(params.updates) ? params.updates : [];
      let changed = 0;
      const rows = table.rows.map((row) => {
        const hit = updates.find((u) => (u as { rowId?: unknown }).rowId === row.id) as
          | { cells?: unknown }
          | undefined;
        if (!hit || !hit.cells || typeof hit.cells !== "object" || Array.isArray(hit.cells)) {
          return row;
        }
        changed += 1;
        const cells = { ...row.cells };
        for (const [k, v] of Object.entries(hit.cells as Record<string, unknown>)) {
          cells[k] = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
        }
        return { ...row, cells };
      });
      if (changed === 0) {
        return { ok: false, error: "update_cells 没有命中任何 rowId。" };
      }
      table = { ...table, rows };
      note = `已改 ${changed} 行。`;
    } else if (action === "group_by") {
      const column = typeof params.column === "string" ? params.column.trim() : "";
      if (!table.columns.some((c) => c.key === column)) {
        return { ok: false, error: `列 ${column} 不存在。` };
      }
      const rows = table.rows.map((row) => ({
        ...row,
        group: (row.cells[column] ?? "").trim() || "未分组",
      }));
      table = { ...table, rows };
      note = `已按「${column}」分组。`;
    } else if (action === "import_materials_metadata") {
      const matterId = draft.matterId?.trim();
      if (!matterId) {
        return { ok: false, error: "草稿未关联案件，无法导入材料元数据。" };
      }
      const materials = listMatterMaterialFiles(ctx.workspaceDir, matterId, { maxFiles: 200 });
      if (materials.length === 0) {
        return { ok: false, error: "本案 materials 为空，先 import_host_file 收材料。" };
      }
      const docKey = table.columns.find((c) => c.key === "document")?.key ?? table.columns[1]?.key;
      const sourceKey = table.columns.find((c) => c.key === "source")?.key;
      const firstKey = table.columns[0]?.key;
      const rows: ReviewTableRow[] = materials.map((m) => {
        // 与 materials_fts / 桌面对照 Tab 同一路径口径：cases/<id>/materials/…
        const fullPath = `cases/${matterId}/${m.relPath}`;
        return {
          id: randomUUID(),
          cells: {
            ...(firstKey ? { [firstKey]: m.fileName } : {}),
            ...(docKey ? { [docKey]: m.fileName } : {}),
            ...(sourceKey ? { [sourceKey]: fullPath } : {}),
          },
          source: fullPath,
        };
      });
      table = { ...table, rows: [...table.rows, ...rows] };
      note = `已从本案材料导入 ${rows.length} 行元数据。`;
    }

    writeReviewTable(ctx.workspaceDir, table);
    syncDraftPreview(ctx.workspaceDir, table);
    const problems = reviewTableAcceptanceProblems(table);
    return {
      ok: true,
      data: {
        taskId,
        template: table.template,
        columns: table.columns,
        rowCount: table.rows.length,
        note,
        ...(problems.length > 0 ? { acceptanceGaps: problems } : {}),
      },
    };
  },
};
