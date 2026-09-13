/**
 * After a successful run_compute, persist a lawyer-reviewable 核算对照 pack:
 * dated xlsx + analysis.table draft on 在办. Scripts stay hidden.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { linkDraftToDeliverable } from "../../../application/services/deliverable-service.js";
import { openQueueItem } from "../../../application/services/queue-write-service.js";
import { resolveDefaultDeliverableLocation } from "../../../artifacts/default-output-location.js";
import {
  formatDeliveryDateStamp,
  safeDeliveryStem,
} from "../../../artifacts/matter-word-delivery.js";
import { getDeliverableSpec } from "../../../deliverables/registry.js";
import { persistDraft } from "../../../drafts/index.js";
import { isPathInsideRoot, resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import { ensureTaskRecord, readTaskRecord, updateTaskRecord } from "../../../tasks/index.js";
import type { ArtifactDraft, ArtifactSection, TaskIntent } from "../../../types.js";
import { upsertLawyerWorkFromPersist } from "../../../work/store.js";
import type { ChartSpec } from "./chart-spec.js";
import { loadXlsxWorkbook, MAX_XLSX_PREVIEW_ROWS, type XlsxCell } from "./xlsx-workbook.js";

export const ANALYSIS_TABLE_DELIVERABLE = "analysis.table";

export const COMPUTE_PACK_NEXT_HINT =
  "交件已写入在办（核算对照草稿）。正文只给结论、表路径，并用 lm-chart 围栏贴回 spec；不要贴源码。不必再 draft_document，除非律师要求改意见稿。法定金额与期限仍须 calculate。";

export type ComputeTableRef = {
  path: string;
  sheet?: string;
  rowCount?: number;
};

export type ComputeChartRef = {
  path: string;
  spec: ChartSpec;
};

export type PersistComputePackInput = {
  workspaceDir: string;
  projectDir?: string;
  matterId?: string;
  sessionId: string;
  assistantId?: string;
  purpose?: string;
  tables: ComputeTableRef[];
  charts: ComputeChartRef[];
  value?: unknown;
};

export type ComputePack = {
  taskId: string;
  draftPath: string;
  title: string;
  tables: ComputeTableRef[];
  charts: ComputeChartRef[];
};

export function computePackTaskId(sessionId: string, purpose: string): string {
  const h = createHash("sha256").update(`${sessionId}\0${purpose}`).digest("hex").slice(0, 12);
  return `compute-${h}`;
}

export function formatComputeValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim().slice(0, 400);
  }
  try {
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return "";
  }
}

function cellText(cell: XlsxCell | undefined): string {
  if (cell == null) {
    return "";
  }
  return String(cell).replace(/\|/g, "\\|");
}

export function markdownTablePreview(rows: XlsxCell[][]): string {
  if (rows.length === 0) {
    return "（空表）";
  }
  const width = Math.max(1, ...rows.map((row) => row.length));
  const pad = (row: XlsxCell[]) => Array.from({ length: width }, (_, i) => cellText(row[i]));
  const header = pad(rows[0] ?? []);
  const sep = header.map(() => "---");
  const body = rows.slice(1, MAX_XLSX_PREVIEW_ROWS + 1).map(pad);
  return [header, sep, ...body].map((cols) => `| ${cols.join(" | ")} |`).join("\n");
}

function lawyerPath(workspaceDir: string, abs: string): string {
  if (isPathInsideRoot(workspaceDir, abs)) {
    return path.relative(workspaceDir, abs).replace(/\\/g, "/");
  }
  return abs;
}

async function resolveTableAbs(workspaceDir: string, rawPath: string): Promise<string | undefined> {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return undefined;
  }
  if (path.isAbsolute(trimmed)) {
    return isPathInsideRoot(workspaceDir, trimmed) ? trimmed : undefined;
  }
  const resolved = resolveWorkspaceRelativePath(workspaceDir, trimmed);
  return resolved.ok ? resolved.abs : undefined;
}

async function relocateTable(params: {
  workspaceDir: string;
  projectDir?: string;
  matterId?: string;
  title: string;
  index: number;
  table: ComputeTableRef;
}): Promise<ComputeTableRef> {
  const srcAbs = await resolveTableAbs(params.workspaceDir, params.table.path);
  if (!srcAbs) {
    return params.table;
  }
  try {
    await fs.access(srcAbs);
  } catch {
    return params.table;
  }
  const stem = safeDeliveryStem(params.title);
  const stamp = formatDeliveryDateStamp();
  const seq = String(params.index + 1).padStart(2, "0");
  const keepFilename = `${stem}_${stamp}_${seq}.xlsx`;
  const located = resolveDefaultDeliverableLocation({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    matterId: params.matterId,
    title: stem,
    extension: ".xlsx",
    keepFilename,
  });
  if (!located.ok) {
    return params.table;
  }
  const destAbs = located.planned.outputPath;
  if (path.resolve(srcAbs) !== path.resolve(destAbs)) {
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.copyFile(srcAbs, destAbs);
  }
  return {
    path: lawyerPath(params.workspaceDir, destAbs),
    sheet: params.table.sheet,
    rowCount: params.table.rowCount,
  };
}

async function tablePreviewBody(workspaceDir: string, table: ComputeTableRef): Promise<string> {
  const bits = [
    table.path ? `文件：${table.path}` : "",
    table.sheet ? `工作表：${table.sheet}` : "",
    table.rowCount != null ? `行数：${table.rowCount}` : "",
  ].filter(Boolean);
  const abs = await resolveTableAbs(workspaceDir, table.path);
  if (!abs) {
    return bits.join("\n");
  }
  try {
    const loaded = await loadXlsxWorkbook(abs);
    const sheet = loaded.sheets.find((s) => s.name === table.sheet) ?? loaded.sheets[0];
    if (!sheet) {
      return bits.join("\n");
    }
    const preview = markdownTablePreview(sheet.rows);
    const extra =
      sheet.rows.length > MAX_XLSX_PREVIEW_ROWS + 1
        ? `\n（仅预览前 ${MAX_XLSX_PREVIEW_ROWS} 行，全文见文件）`
        : "";
    return `${bits.join("\n")}\n\n${preview}${extra}`;
  } catch {
    return bits.join("\n");
  }
}

function chartFence(spec: ChartSpec): string {
  return `\`\`\`lm-chart\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
}

export function buildComputePackSections(params: {
  purpose: string;
  valueText: string;
  tables: ComputeTableRef[];
  charts: ComputeChartRef[];
  previews: string[];
}): ArtifactSection[] {
  const conclusionBits = [
    params.purpose ? `事项：${params.purpose}` : "事项：核算对照",
    params.valueText ? `结果：${params.valueText}` : "",
    params.tables[0]?.path ? `对照表：${params.tables[0].path}` : "",
    params.charts[0]?.spec.title ? `图：${params.charts[0].spec.title}` : "",
  ].filter(Boolean);
  const contrast =
    params.previews.length > 0
      ? params.previews.join("\n\n")
      : params.charts.length > 0
        ? "对照见下图；未另存表格文件。"
        : "【待补充对照表】";
  const sourceLines = [
    ...params.tables.map((t) => `- 表：${t.path}${t.sheet ? `（${t.sheet}）` : ""}`),
    ...params.charts.map((c) => `- 图：${c.spec.title}${c.path ? `（${c.path}）` : ""}`),
    "- 数字来自本案材料核算，非正式鉴定；法定金额与期限须另走公式核算。",
  ];
  const sections: ArtifactSection[] = [
    { heading: "结论", body: conclusionBits.join("\n") },
    { heading: "对照", body: contrast },
    { heading: "来源", body: sourceLines.join("\n") },
  ];
  if (params.charts.length > 0) {
    sections.push({
      heading: "图",
      body: params.charts.map((c) => chartFence(c.spec)).join("\n\n"),
    });
  }
  return sections;
}

export async function persistComputeDeliverablePack(
  input: PersistComputePackInput,
): Promise<ComputePack | undefined> {
  if (input.tables.length === 0 && input.charts.length === 0) {
    return undefined;
  }
  const purpose = input.purpose?.trim() || "核算对照";
  const title = purpose.slice(0, 80);
  const taskId = computePackTaskId(input.sessionId, purpose);
  const createdAt = new Date().toISOString();
  const spec = getDeliverableSpec(ANALYSIS_TABLE_DELIVERABLE);
  const tables: ComputeTableRef[] = [];
  for (let i = 0; i < input.tables.length; i += 1) {
    const table = input.tables[i];
    if (!table) {
      continue;
    }
    tables.push(
      await relocateTable({
        workspaceDir: input.workspaceDir,
        projectDir: input.projectDir,
        matterId: input.matterId,
        title,
        index: i,
        table,
      }),
    );
  }
  const previews: string[] = [];
  for (const table of tables) {
    previews.push(await tablePreviewBody(input.workspaceDir, table));
  }
  const valueText = formatComputeValue(input.value);
  const sections = buildComputePackSections({
    purpose: title,
    valueText,
    tables,
    charts: input.charts,
    previews,
  });
  const intent: TaskIntent = {
    taskId,
    kind: "draft.word",
    output: "docx",
    instruction: title,
    summary: title,
    riskLevel: spec?.defaultRiskLevel ?? "medium",
    models: ["legal"],
    requiresConfirmation: false,
    createdAt,
    matterId: input.matterId,
    templateId: spec?.defaultTemplateId ?? "word/legal-memo-default",
    deliverableType: ANALYSIS_TABLE_DELIVERABLE,
    acceptanceCriteria: spec?.acceptanceCriteria,
    audience: "律师内部",
  };
  const { created } = ensureTaskRecord(input.workspaceDir, intent, {
    assistantId: input.assistantId,
  });
  const draft: ArtifactDraft = {
    taskId,
    matterId: input.matterId,
    title,
    output: "docx",
    templateId: intent.templateId ?? "word/legal-memo-default",
    deliverableType: ANALYSIS_TABLE_DELIVERABLE,
    summary: valueText ? `${title}：${valueText}` : title,
    audience: "律师内部",
    sections,
    reviewNotes: [],
    acceptanceCriteria: spec?.acceptanceCriteria,
    reviewStatus: "pending",
    createdAt,
  };
  const storedDraftPath = persistDraft(input.workspaceDir, draft);
  updateTaskRecord(input.workspaceDir, taskId, {
    title,
    draftPath: storedDraftPath,
    status: "drafted",
    sessionId: input.sessionId,
  });
  upsertLawyerWorkFromPersist(input.workspaceDir, {
    taskId,
    draftId: taskId,
    matterId: input.matterId,
    title,
    status: "needs_signoff",
    source: "chat",
  });
  if (input.matterId) {
    const tr = readTaskRecord(input.workspaceDir, taskId);
    try {
      linkDraftToDeliverable(input.workspaceDir, draft, tr ?? undefined);
      if (created) {
        openQueueItem(input.workspaceDir, {
          matterId: input.matterId,
          kind: "need_lawyer_review",
          title: `草稿待审核：${title}`,
          relatedTaskId: taskId,
          relatedDeliverableId: taskId,
        });
      }
    } catch {
      /* best-effort dual-write */
    }
  }
  return {
    taskId,
    draftPath: path.relative(input.workspaceDir, storedDraftPath).replace(/\\/g, "/"),
    title,
    tables,
    charts: input.charts,
  };
}
