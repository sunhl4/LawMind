/**
 * Structured spreadsheet analyze/write — schema and stats, not a TSV dump.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveLawyerLocalFile } from "../../../runtime/lawyer-local-file.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import type { AgentTool } from "../../types.js";
import {
  loadXlsxWorkbook,
  MAX_XLSX_PREVIEW_ROWS,
  writeXlsxWorkbook,
  type XlsxCell,
} from "./xlsx-workbook.js";

export type SpreadsheetColType = "number" | "date" | "text";

export type SpreadsheetColumnStat = {
  name: string;
  type: SpreadsheetColType;
  empty: number;
  filled: number;
  min?: number;
  max?: number;
  sum?: number;
  avg?: number;
};

function asPath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function locateSpreadsheet(
  claimed: string,
  ctx: {
    workspaceDir: string;
    projectDir?: string;
    contextPins?: import("../../../platform/compose-context-pin.js").ComposeContextPin[];
  },
) {
  return resolveLawyerLocalFile({
    workspaceDir: ctx.workspaceDir,
    projectDir: ctx.projectDir,
    raw: claimed,
    pins: ctx.contextPins,
  });
}

function isDateText(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) && !/^\d{4}\/\d{1,2}\/\d{1,2}/.test(value)) {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function inferColType(values: XlsxCell[]): SpreadsheetColType {
  const filled = values.filter((v) => v != null && String(v).trim() !== "");
  if (filled.length === 0) {
    return "text";
  }
  if (filled.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return "number";
  }
  if (
    filled.every((v) => {
      if (typeof v === "number" && Number.isFinite(v)) {
        return true;
      }
      return typeof v === "string" && isDateText(v);
    }) &&
    filled.some((v) => typeof v === "string" && isDateText(v))
  ) {
    return "date";
  }
  return "text";
}

function asNumber(value: XlsxCell): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function columnStats(name: string, values: XlsxCell[]): SpreadsheetColumnStat {
  const type = inferColType(values);
  let empty = 0;
  let filled = 0;
  const nums: number[] = [];
  for (const v of values) {
    if (v == null || String(v).trim() === "") {
      empty += 1;
      continue;
    }
    filled += 1;
    const n = asNumber(v);
    if (n !== undefined) {
      nums.push(n);
    }
  }
  const stat: SpreadsheetColumnStat = { name, type, empty, filled };
  if (type === "number" && nums.length > 0) {
    stat.min = Math.min(...nums);
    stat.max = Math.max(...nums);
    stat.sum = nums.reduce((a, b) => a + b, 0);
    stat.avg = stat.sum / nums.length;
  }
  return stat;
}

function pickSheet<T extends { name: string }>(
  sheets: T[],
  wanted: string | undefined,
): T | undefined {
  if (!wanted?.trim()) {
    return sheets[0];
  }
  const q = wanted.trim();
  return (
    sheets.find((s) => s.name === q) ?? sheets.find((s) => s.name.toLowerCase() === q.toLowerCase())
  );
}

function headerAndBody(rows: XlsxCell[][]): { headers: string[]; body: XlsxCell[][] } {
  const first = rows[0] ?? [];
  const headers = first.map((c, i) => {
    const t = c == null ? "" : String(c).trim();
    return t || `列${i + 1}`;
  });
  return { headers, body: rows.slice(1) };
}

export const analyzeSpreadsheet: AgentTool = {
  definition: {
    name: "analyze_spreadsheet",
    description:
      "分析工作区或项目内的 .xlsx：列名、推断类型、行数、空值、数值列 min/max/sum/avg，以及前几行预览。不要用 analyze_document 把表格倒成 TSV。",
    category: "analyze",
    parameters: {
      path: {
        type: "string",
        description: "相对工作区或项目根的 .xlsx 路径",
        required: true,
      },
      sheet: { type: "string", description: "工作表名（默认第一张）" },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const claimed = asPath(params.path) || asPath(params.file_path);
    if (!claimed) {
      return { ok: false, error: "请提供表格路径。" };
    }
    const located = locateSpreadsheet(claimed, ctx);
    if (!located) {
      const wsPath = resolveWorkspaceRelativePath(ctx.workspaceDir, claimed);
      const projPath = ctx.projectDir?.trim()
        ? resolveWorkspaceRelativePath(ctx.projectDir.trim(), claimed)
        : undefined;
      const escaped =
        !wsPath.ok &&
        wsPath.error === "escape" &&
        (projPath == null || (!projPath.ok && projPath.error === "escape"));
      return {
        ok: false,
        error: escaped
          ? "不允许读取工作区外的文件。"
          : `找不到表格：${claimed}。已查工作区与项目目录。`,
      };
    }
    if (path.extname(located.abs).toLowerCase() !== ".xlsx") {
      return { ok: false, error: "analyze_spreadsheet 只支持 .xlsx。" };
    }
    try {
      const loaded = await loadXlsxWorkbook(located.abs);
      const sheet = pickSheet(
        loaded.sheets,
        typeof params.sheet === "string" ? params.sheet : undefined,
      );
      if (!sheet) {
        return {
          ok: false,
          error: `找不到工作表。可用：${loaded.sheets.map((s) => s.name).join("、") || "（空）"}`,
        };
      }
      const { headers, body } = headerAndBody(sheet.rows);
      const width = headers.length;
      const columns = headers.map((name, i) =>
        columnStats(
          name,
          body.map((row) => row[i] ?? null),
        ),
      );
      const preview = body.slice(0, MAX_XLSX_PREVIEW_ROWS).map((row) => {
        const rec: Record<string, XlsxCell> = {};
        for (let i = 0; i < width; i++) {
          rec[headers[i] ?? `列${i + 1}`] = row[i] ?? null;
        }
        return rec;
      });
      return {
        ok: true,
        data: {
          path: located.rel,
          root: located.root,
          sheet: sheet.name,
          sheets: loaded.sheets.map((s) => s.name),
          rowCount: body.length,
          columnCount: width,
          columns,
          preview,
          truncatedRows: sheet.truncatedRows,
          truncatedSheets: loaded.truncatedSheets,
          hint: "需要出图用 render_chart；需要落表用 write_spreadsheet。数字必须带来源列。",
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

function asRowMatrix(value: unknown): unknown[][] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((row) => (Array.isArray(row) ? row : [row]));
}

export const writeSpreadsheet: AgentTool = {
  definition: {
    name: "write_spreadsheet",
    description: "把二维表写入工作区 artifacts/ 下的 .xlsx，供律师入卷。首行视为列名。",
    category: "draft",
    parameters: {
      rows: {
        type: "array",
        description: "二维表，首行为列名",
        required: true,
      },
      sheet: { type: "string", description: "工作表名（默认 分析）" },
      filename: { type: "string", description: "artifacts 下的文件名，需以 .xlsx 结尾" },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const rows = asRowMatrix(params.rows);
    if (!rows || rows.length === 0) {
      return { ok: false, error: "请提供非空的 rows 二维表。" };
    }
    const sheetName =
      typeof params.sheet === "string" && params.sheet.trim()
        ? params.sheet.trim().slice(0, 31)
        : "分析";
    const rawName =
      typeof params.filename === "string" && params.filename.trim()
        ? params.filename.trim().replace(/\\/g, "/")
        : `table-${randomUUID().slice(0, 8)}.xlsx`;
    const base = path.basename(rawName);
    if (!base.toLowerCase().endsWith(".xlsx")) {
      return { ok: false, error: "filename 必须以 .xlsx 结尾。" };
    }
    const rel = `artifacts/${base}`;
    const resolved = resolveWorkspaceRelativePath(ctx.workspaceDir, rel);
    if (!resolved.ok) {
      return { ok: false, error: "不允许写到工作区外。" };
    }
    if (!resolved.rel.startsWith("artifacts/")) {
      return { ok: false, error: "表格只能写入 artifacts/。" };
    }
    try {
      await writeXlsxWorkbook(resolved.abs, [{ name: sheetName, rows }]);
      return {
        ok: true,
        data: {
          path: resolved.rel,
          sheet: sheetName,
          rowCount: Math.max(0, rows.length - 1),
          columnCount: Array.isArray(rows[0]) ? rows[0].length : 0,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
