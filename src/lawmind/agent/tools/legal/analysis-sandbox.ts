/**
 * Guest VM for run_analysis / run_compute.
 * Host I/O: readTable / readCsv / readJson / stats / writeTable / emitChart.
 * Language: ordinary JS plus safe globals (Math/JSON/Date/…).
 * No fs, child_process, fetch, or network. Not an OS jail — string codegen is off.
 */

import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { isAllowedAnalysisScriptRel } from "../../../runtime/analysis-script-path.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import { parseChartSpec, type ChartSpec } from "./chart-spec.js";
import {
  loadXlsxWorkbook,
  writeXlsxWorkbook,
  type XlsxCell,
  MAX_XLSX_ROWS_PER_SHEET,
} from "./xlsx-workbook.js";

export { isAllowedAnalysisScriptRel };

export const ANALYSIS_TIMEOUT_MS = 15_000;
export const ANALYSIS_OUTPUT_MAX_CHARS = 40_000;
export const ANALYSIS_CSV_MAX_BYTES = 2_000_000;
export const ANALYSIS_JSON_MAX_BYTES = 1_000_000;

const SAFE_GLOBAL_KEYS = [
  "Math",
  "JSON",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "Date",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Infinity",
  "NaN",
  "undefined",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "URIError",
  "Promise",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
] as const;

function collectSafeGlobals(): Record<string, unknown> {
  const g = globalThis as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SAFE_GLOBAL_KEYS) {
    if (key in g) {
      out[key] = g[key];
    }
  }
  return out;
}

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

function coerceDelimitedCell(raw: string): XlsxCell {
  const t = raw.trim();
  if (t === "") {
    return null;
  }
  if (t === "true") {
    return true;
  }
  if (t === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return t;
}

export function splitDelimitedLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseDelimitedText(
  text: string,
  sep: string,
): { headers: string[]; rows: XlsxCell[][] } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, MAX_XLSX_ROWS_PER_SHEET + 1);
  const headerLine = lines[0] ?? "";
  const headers = splitDelimitedLine(headerLine, sep).map((c, i) =>
    c.trim() === "" ? `列${i + 1}` : c.trim(),
  );
  const rows = lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, sep).map(coerceDelimitedCell);
    while (cells.length < headers.length) {
      cells.push(null);
    }
    return cells.slice(0, headers.length);
  });
  return { headers, rows };
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
    async readCsv(filePath: string): Promise<AnalysisTable> {
      const located = assertSafeRel(workspaceDir, String(filePath ?? ""));
      const ext = path.extname(located.rel).toLowerCase();
      if (ext !== ".csv" && ext !== ".tsv") {
        throw new Error("只支持 .csv / .tsv。");
      }
      const st = await fs.stat(located.abs);
      if (st.size > ANALYSIS_CSV_MAX_BYTES) {
        throw new Error("表格文件过大。");
      }
      const text = await fs.readFile(located.abs, "utf8");
      const sep = ext === ".tsv" ? "\t" : ",";
      const parsed = parseDelimitedText(text, sep);
      return {
        path: located.rel,
        sheet: path.basename(located.rel),
        headers: parsed.headers,
        rows: parsed.rows,
      };
    },
    async readJson(filePath: string): Promise<unknown> {
      const located = assertSafeRel(workspaceDir, String(filePath ?? ""));
      if (path.extname(located.rel).toLowerCase() !== ".json") {
        throw new Error("只支持 .json。");
      }
      const st = await fs.stat(located.abs);
      if (st.size > ANALYSIS_JSON_MAX_BYTES) {
        throw new Error("JSON 文件过大。");
      }
      const text = await fs.readFile(located.abs, "utf8");
      return JSON.parse(text) as unknown;
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
    ...collectSafeGlobals(),
    readTable: api.readTable.bind(api),
    readCsv: api.readCsv.bind(api),
    readJson: api.readJson.bind(api),
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
