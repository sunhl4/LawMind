/**
 * Guest VM for run_analysis: only readTable / stats / writeTable / emitChart.
 * No fs, child_process, fetch, or network. Not an OS jail — string codegen is off.
 */

import path from "node:path";
import vm from "node:vm";
import { isAllowedAnalysisScriptRel } from "../../../runtime/analysis-script-path.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import { parseChartSpec, type ChartSpec } from "./chart-spec.js";
import { loadXlsxWorkbook, writeXlsxWorkbook, type XlsxCell } from "./xlsx-workbook.js";

export { isAllowedAnalysisScriptRel };

export const ANALYSIS_TIMEOUT_MS = 15_000;
export const ANALYSIS_OUTPUT_MAX_CHARS = 40_000;

const FORBIDDEN_RE =
  /\b(require|process|fetch|XMLHttpRequest|WebSocket|child_process|import\s*\(|Function\s*\(|eval\s*\(|constructor\s*\(|__proto__|globalThis|Proxy\s*\()/;

export type AnalysisTable = {
  path: string;
  sheet: string;
  headers: string[];
  rows: XlsxCell[][];
};

export type AnalysisSandboxResult = {
  logs: string[];
  tables: Array<{ path: string; sheet: string; rowCount: number }>;
  charts: ChartSpec[];
  value?: unknown;
};

function assertSafeRel(workspaceDir: string, raw: string): { abs: string; rel: string } {
  const resolved = resolveWorkspaceRelativePath(workspaceDir, raw);
  if (!resolved.ok) {
    throw new Error("路径不在工作区内。");
  }
  return resolved;
}

function headerBody(rows: XlsxCell[][]): { headers: string[]; body: XlsxCell[][] } {
  const first = rows[0] ?? [];
  return {
    headers: first.map((c, i) =>
      c == null || String(c).trim() === "" ? `列${i + 1}` : String(c).trim(),
    ),
    body: rows.slice(1),
  };
}

function assertXlsxRel(rel: string): void {
  if (path.extname(rel).toLowerCase() !== ".xlsx") {
    throw new Error("只支持 .xlsx 表格。");
  }
}

export function createAnalysisApi(workspaceDir: string, out: AnalysisSandboxResult) {
  return {
    async readTable(filePath: string, sheet?: string): Promise<AnalysisTable> {
      const located = assertSafeRel(workspaceDir, String(filePath ?? ""));
      assertXlsxRel(located.rel);
      const loaded = await loadXlsxWorkbook(located.abs);
      const hit =
        sheet && sheet.trim()
          ? loaded.sheets.find((s) => s.name === sheet.trim())
          : loaded.sheets[0];
      if (!hit) {
        throw new Error("找不到工作表。");
      }
      const { headers, body } = headerBody(hit.rows);
      return { path: located.rel, sheet: hit.name, headers, rows: body };
    },
    stats(table: AnalysisTable, column: string) {
      const idx = table.headers.indexOf(column);
      if (idx < 0) {
        throw new Error(`没有列：${column}`);
      }
      const nums = table.rows
        .map((r) => r[idx])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const sum = nums.reduce((a, b) => a + b, 0);
      return {
        count: nums.length,
        sum,
        avg: nums.length ? sum / nums.length : 0,
        min: nums.length ? Math.min(...nums) : 0,
        max: nums.length ? Math.max(...nums) : 0,
      };
    },
    async writeTable(
      filePath: string,
      payload: { sheet?: string; headers: string[]; rows: unknown[][] },
    ) {
      const base = path.basename(String(filePath ?? "").replace(/\\/g, "/"));
      if (!base.toLowerCase().endsWith(".xlsx")) {
        throw new Error("writeTable 只能写入 .xlsx。");
      }
      const located = assertSafeRel(workspaceDir, `artifacts/${base}`);
      if (!located.rel.startsWith("artifacts/") || located.rel.includes("..")) {
        throw new Error("writeTable 只能写入 artifacts/。");
      }
      const headers = Array.isArray(payload.headers) ? payload.headers.map(String) : [];
      const body = Array.isArray(payload.rows) ? payload.rows : [];
      await writeXlsxWorkbook(located.abs, [
        { name: payload.sheet?.trim() || "分析", rows: [headers, ...body] },
      ]);
      out.tables.push({
        path: located.rel,
        sheet: payload.sheet?.trim() || "分析",
        rowCount: body.length,
      });
      return { path: located.rel };
    },
    emitChart(raw: unknown) {
      const parsed = parseChartSpec(raw);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      out.charts.push(parsed.spec);
      return parsed.spec;
    },
  };
}

export function assertAnalysisScriptAllowed(source: string): void {
  if (FORBIDDEN_RE.test(source)) {
    throw new Error("脚本含有禁止的接口（fs/fetch/process/require 等）。");
  }
}

function withTimeout<T>(pending: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("分析脚本超时（15 秒）。")), timeoutMs);
  });
  return Promise.race([pending, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function runAnalysisScriptInVm(opts: {
  source: string;
  workspaceDir: string;
  timeoutMs?: number;
}): Promise<AnalysisSandboxResult> {
  assertAnalysisScriptAllowed(opts.source);
  const timeoutMs = opts.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
  const out: AnalysisSandboxResult = { logs: [], tables: [], charts: [] };
  const api = createAnalysisApi(opts.workspaceDir, out);
  const logs: string[] = [];
  const sandbox: Record<string, unknown> = {
    readTable: api.readTable.bind(api),
    stats: api.stats.bind(api),
    writeTable: api.writeTable.bind(api),
    emitChart: api.emitChart.bind(api),
    console: {
      log: (...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      },
    },
  };
  Object.setPrototypeOf(sandbox, null);
  const context = vm.createContext(sandbox, {
    name: "lawmind-analysis",
    codeGeneration: { strings: false, wasm: false },
  });
  const wrapped = `"use strict";(async () => {\n${opts.source}\n})()`;
  const ran = vm.runInContext(wrapped, context, {
    timeout: timeoutMs,
    filename: "analysis-script.js",
  });
  const result = await withTimeout(Promise.resolve(ran), timeoutMs);
  out.logs = logs;
  if (result !== undefined) {
    out.value = result;
  }
  const dumped = JSON.stringify(out);
  if (dumped.length > ANALYSIS_OUTPUT_MAX_CHARS) {
    throw new Error("分析输出超过大小上限。");
  }
  return out;
}
