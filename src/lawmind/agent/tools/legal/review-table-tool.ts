/**
 * review_table_update — 审查表（review.table）的结构化编辑工具。
 *
 * 表格本体存 sidecar（drafts/<taskId>.table.json）；每次写入后把 markdown 预览
 * 同步进草稿「审查表」栏目，对话与导出共用同一真相源。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  extractReviewTable,
  guessDocKind,
  summarizeReviewExtract,
  type ReviewExtractDoc,
} from "../../../deliverables/review-table-extract.js";
import { createPatternExtractor } from "../../../deliverables/review-table-patterns.js";
import {
  cellProvenance,
  newReviewTable,
  readReviewTable,
  reviewTableAcceptanceProblems,
  reviewTableToMarkdown,
  reviewTableValueColumns,
  writeReviewTable,
  REVIEW_TABLE_TEMPLATES,
  type CellReviewState,
  type ReviewTable,
  type ReviewTableColumn,
  type ReviewTableRow,
  type ReviewTableTemplate,
} from "../../../deliverables/review-table.js";
import { readDeskMaterialText } from "../../../desk/desk-material-text.js";
import {
  listMatterMaterialFiles,
  type MatterMaterialListing,
} from "../../../desk/matter-materials.js";
import { readDraft, persistDraft } from "../../../drafts/index.js";
import type { AgentTool } from "../../types.js";

const ACTIONS = [
  "set_template",
  "set_columns",
  "add_rows",
  "update_cells",
  "group_by",
  "import_materials_metadata",
  "extract_batch",
  "set_review",
  "to_draft",
] as const;
type ReviewTableAction = (typeof ACTIONS)[number];

/** 批量抽取的默认与上限（材料份数）。 */
export const REVIEW_EXTRACT_DEFAULT_DOCS = 120;
export const REVIEW_EXTRACT_MAX_DOCS = 500;

/**
 * 材料清单按路径升序。
 *
 * 桌面材料列表按 mtime 倒序（“最近改过的在最上面”，那是人看的）；
 * 审查表的**行序**必须可复现：同一批材料跑两次要出同一张表，
 * 否则 diff 与验收都失去意义。故这里按路径排序，与 mtime 抖动无关。
 */
function listMaterialsForReview(
  workspaceDir: string,
  matterId: string,
  maxFiles: number,
): MatterMaterialListing[] {
  return listMatterMaterialFiles(workspaceDir, matterId, { maxFiles, order: "path" });
}

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

/** 表格溯源统计：有出处 / 显式弃答 / 待补，供律师一眼判断可交付性。 */
export function reviewTableProvenanceSummary(table: ReviewTable): {
  cells: number;
  sourced: number;
  abstained: number;
  missing: number;
} {
  const valueColumns = reviewTableValueColumns(table);
  let sourced = 0;
  let abstained = 0;
  let missing = 0;
  for (const row of table.rows) {
    for (const col of valueColumns) {
      const state = cellProvenance(row, col.key).state;
      if (state === "sourced") {
        sourced += 1;
      } else if (state === "abstained") {
        abstained += 1;
      } else if ((row.cells[col.key] ?? "").trim()) {
        missing += 1;
      }
    }
  }
  return { cells: sourced + abstained + missing, sourced, abstained, missing };
}

/** 审核状态：只改被点名的行，缺省标记为已看；锁定行不覆盖。 */
function applyReviewState(
  table: ReviewTable,
  input: { rowIds: string[]; review: CellReviewState; overwriteLocked: boolean },
): { table: ReviewTable; changed: number; skippedLocked: number } {
  const wanted = new Set(input.rowIds);
  let changed = 0;
  let skippedLocked = 0;
  const now = new Date().toISOString();
  const rows = table.rows.map((row) => {
    if (wanted.size > 0 && !wanted.has(row.id)) {
      return row;
    }
    if (row.review?.locked && !input.overwriteLocked && input.review.locked !== false) {
      skippedLocked += 1;
      return row;
    }
    changed += 1;
    return {
      ...row,
      review: {
        ...row.review,
        ...input.review,
        updatedAt: now,
      },
    };
  });
  return { table: { ...table, rows }, changed, skippedLocked };
}

/**
 * 审查表 → 文书：把已核验的结论与出处推进草稿正文，供导出。
 * 只推「有出处」的行；弃答与待补另列一节，不混进结论。
 * 不要求律师先确认——这就是交付前少介入的那一步。
 */
function pushTableToDraft(
  workspaceDir: string,
  table: ReviewTable,
): { ok: true; pushed: number; abstained: number } | { ok: false; error: string } {
  const draft = readDraft(workspaceDir, table.taskId);
  if (!draft) {
    return { ok: false, error: `找不到草稿 ${table.taskId}。` };
  }
  const valueColumns = reviewTableValueColumns(table);
  const sourcedRows: string[] = [];
  const abstainedRows: string[] = [];

  for (const row of table.rows) {
    const sourced = valueColumns.filter((c) => cellProvenance(row, c.key).state === "sourced");
    const abstained = valueColumns.filter((c) => cellProvenance(row, c.key).state === "abstained");
    const label = (row.cells[table.columns[0]?.key ?? ""] ?? "").trim() || row.id;
    if (sourced.length > 0) {
      const body = sourced
        .map((c) => {
          const meta = row.cellMeta?.[c.key];
          const src = meta?.source ?? row.source ?? "";
          const confidence = meta?.confidence === "low" ? "（置信度低）" : "";
          return `- **${c.label}**：${row.cells[c.key]}${confidence} — 出处：${src}`;
        })
        .join("\n");
      sourcedRows.push(`**${label}**\n${body}`);
    }
    if (abstained.length > 0) {
      abstainedRows.push(
        `- ${label}：${abstained.map((c) => c.label).join("、")} 未取得（${abstained
          .map((c) => row.cellMeta?.[c.key]?.note ?? "证据不足")
          .filter((v, i, a) => a.indexOf(v) === i)
          .join("；")}）`,
      );
    }
  }

  const body = [
    "（由审查表自动归纳；每格结论附出处，可直接核验。）",
    "",
    ...sourcedRows,
    ...(abstainedRows.length > 0
      ? ["", "### 未能取得的项（诚实标注，未作推断）", "", ...abstainedRows]
      : []),
  ].join("\n");

  const idx = draft.sections.findIndex((s) => /审查结论|主要发现|尽调结论/.test(s.heading));
  const sections = [...draft.sections];
  if (idx >= 0) {
    sections[idx] = { ...sections[idx], body };
  } else {
    sections.push({ heading: "审查结论", body, citations: [] });
  }
  persistDraft(workspaceDir, { ...draft, sections });
  return { ok: true, pushed: sourcedRows.length, abstained: abstainedRows.length };
}

/** 批量抽取：材料 → 表格。用确定性模式 + 只读 OCR 兜底，不打断律师。 */
async function runBatchExtract(
  workspaceDir: string,
  table: ReviewTable,
  params: Record<string, unknown>,
  matterId: string,
  emitProgress?: (label: string) => void,
  signal?: AbortSignal,
): Promise<
  | { ok: true; table: ReviewTable; note: string; summary: string; cellKeys?: string[] }
  | { ok: false; error: string }
> {
  const rawMax = params.max_docs;
  const maxDocs =
    typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0
      ? Math.min(REVIEW_EXTRACT_MAX_DOCS, Math.floor(rawMax))
      : REVIEW_EXTRACT_DEFAULT_DOCS;
  const materials = listMaterialsForReview(workspaceDir, matterId, maxDocs);
  if (materials.length === 0) {
    return { ok: false, error: "本案 materials 为空，先 import_host_file 收材料。" };
  }

  const docs: ReviewExtractDoc[] = materials.map((m) => {
    const rel = `cases/${matterId}/${m.relPath}`;
    return {
      relPath: rel,
      absolutePath: path.resolve(workspaceDir, rel),
      fileName: m.fileName,
      kind: guessDocKind(m.fileName),
    };
  });

  const rawColumns = params.cell_keys;
  const cellKeys = Array.isArray(rawColumns)
    ? rawColumns.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : undefined;

  const result = await extractReviewTable({
    table,
    docs,
    columnKeys: cellKeys,
    extractCell: createPatternExtractor(),
    readText: async (abs) => {
      const rel = path.relative(workspaceDir, abs).replace(/\\/g, "/");
      const read = await readDeskMaterialText(workspaceDir, rel);
      return read.ok ? read.text : undefined;
    },
    concurrency: 4,
    ...(emitProgress
      ? {
          onProgress: (e) => {
            if (e.phase !== "cell") {
              emitProgress(e.message);
            }
          },
        }
      : {}),
    ...(signal ? { signal } : {}),
  });

  // 行级 source 同步进来源列，保证「每行可核验」口径一致。
  const sourceKey = result.table.columns.find((c) => c.key === "source")?.key;
  const rows = sourceKey
    ? result.table.rows.map((row) =>
        row.source && !(row.cells[sourceKey] ?? "").trim()
          ? { ...row, cells: { ...row.cells, [sourceKey]: row.source } }
          : row,
      )
    : result.table.rows;
  const merged: ReviewTable = { ...result.table, rows };

  writeReviewTable(workspaceDir, merged);
  syncDraftPreview(workspaceDir, merged);
  const summary = summarizeReviewExtract(result.stats);
  return {
    ok: true,
    table: merged,
    note: `已批量抽取 ${summary}。`,
    summary,
    ...(cellKeys ? { cellKeys } : {}),
  };
}

export const reviewTableUpdate: AgentTool = {
  definition: {
    name: "review_table_update",
    description:
      "编辑审查表（review.table）：set_template 建表 / set_columns 改列 / add_rows 批量加行 / update_cells 批量改格 / group_by 按列分组 / import_materials_metadata 从本案材料导入行 / extract_batch 批量抽取全案材料（确定性模式 + 只读扫描件识别，逐格带出处，抽不动的格写「无法判断」不猜） / set_review 标记已看·锁定·指派 / to_draft 把已核验结论与出处推进文书正文。",
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
      max_docs: {
        type: "number",
        description: `extract_batch：最多抽多少份材料（默认 ${REVIEW_EXTRACT_DEFAULT_DOCS}，上限 ${REVIEW_EXTRACT_MAX_DOCS}）`,
      },
      cell_keys: {
        type: "array",
        description: "extract_batch：只抽这些列（列 key）；缺省抽全部非来源列",
      },
      row_ids: { type: "array", description: "set_review：要标记的行 id；缺省全部行" },
      review: {
        type: "string",
        description:
          "set_review：reviewed 标记已看 / unlocked 解除锁定 / locked 锁定（批量重抽不覆盖）",
      },
      assignee: { type: "string", description: "set_review：指派给谁（可选，仅记录）" },
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
      const materials = listMaterialsForReview(ctx.workspaceDir, matterId, 200);
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
    } else if (action === "extract_batch") {
      const matterId = draft.matterId?.trim();
      if (!matterId) {
        return { ok: false, error: "草稿未关联案件，无法批量抽取材料。" };
      }
      const extracted = await runBatchExtract(
        ctx.workspaceDir,
        table,
        params,
        matterId,
        ctx.emitToolProgress,
        ctx.abortSignal,
      );
      if (!extracted.ok) {
        return { ok: false, error: extracted.error };
      }
      table = extracted.table;
      note = extracted.note;
    } else if (action === "set_review") {
      const raw = typeof params.review === "string" ? params.review.trim().toLowerCase() : "";
      if (!["reviewed", "locked", "unlocked"].includes(raw)) {
        return { ok: false, error: "set_review 需要 review：reviewed / locked / unlocked。" };
      }
      const rowIds = Array.isArray(params.row_ids)
        ? params.row_ids.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        : [];
      const assignee = typeof params.assignee === "string" ? params.assignee.trim() : "";
      const review: CellReviewState =
        raw === "reviewed"
          ? { reviewed: true, ...(assignee ? { assignee } : {}) }
          : raw === "locked"
            ? { reviewed: true, locked: true, ...(assignee ? { assignee } : {}) }
            : { locked: false };
      const applied = applyReviewState(table, {
        rowIds,
        review,
        overwriteLocked: true,
      });
      table = applied.table;
      const reviewLabel = raw === "reviewed" ? "已看" : raw === "locked" ? "锁定" : "解除锁定";
      note =
        `已标记 ${applied.changed} 行（${reviewLabel}）` +
        (applied.skippedLocked > 0 ? `；${applied.skippedLocked} 行已锁定未动` : "") +
        (assignee ? `；指派：${assignee}` : "") +
        "。";
    } else if (action === "to_draft") {
      const pushed = pushTableToDraft(ctx.workspaceDir, table);
      if (!pushed.ok) {
        return { ok: false, error: pushed.error };
      }
      note = `已把 ${pushed.pushed} 行结论与出处推进文书正文${pushed.abstained > 0 ? `；${pushed.abstained} 行未取得的项另列诚实标注` : ""}。`;
    }

    if (action !== "to_draft") {
      writeReviewTable(ctx.workspaceDir, table);
    }
    syncDraftPreview(ctx.workspaceDir, table);
    const problems = reviewTableAcceptanceProblems(table);
    const provenance = reviewTableProvenanceSummary(table);
    return {
      ok: true,
      data: {
        taskId,
        template: table.template,
        columns: table.columns,
        rowCount: table.rows.length,
        note,
        provenance,
        ...(problems.length > 0 ? { acceptanceGaps: problems } : {}),
      },
    };
  },
};
