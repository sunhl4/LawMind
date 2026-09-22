/**
 * Guest VM for run_analysis / run_compute.
 * Host I/O: readTable / readCsv / readJson / stats / writeTable / emitChart.
 * Language: ordinary JS plus safe globals (Math/JSON/Date/…).
 * No fs, child_process, fetch, or network. Not an OS jail — string codegen is off.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { isDeniedHostPath } from "../../../host-access/deny-list.js";
import {
  isAllowedAnalysisScriptRel,
  isProtectedAnalysisScriptRel,
} from "../../../runtime/analysis-script-path.js";
import {
  PROTECTED_WORKSPACE_WRITE_REFUSAL,
  isProtectedWorkspaceRel,
} from "../../../runtime/protected-workspace-rels.js";
import { fenceAgentFilePath } from "../../../runtime/workspace-io-fence.js";
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
/** readText 单文件上限：够读合同全文，又不至于把内存吃穿。 */
export const ANALYSIS_TEXT_MAX_BYTES = 200_000;
/** listFiles 走查上限与深度上限（与 copyImportTree 同一量级）。 */
export const ANALYSIS_LIST_MAX_ENTRIES = 5_000;
export const ANALYSIS_LIST_MAX_DEPTH = 8;
/** writeText 单次写入上限。 */
export const ANALYSIS_WRITE_MAX_CHARS = 2_000_000;

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
  /** writeText 落盘的文本文件（工作区相对路径）。 */
  files?: Array<{ path: string; chars: number }>;
  value?: unknown;
};

export type AnalysisDirEntry = {
  name: string;
  /** 工作区相对路径，可直接传给 readText / readCsv / readTable。 */
  path: string;
  kind: "file" | "directory";
  size?: number;
};

/**
 * 路径围栏：工作区相对路径 + deny-list + **realpath**。
 *
 * 只做 `path.resolve` 不够：工作区里放一个指向 `~/.ssh/id_rsa` 的软链，脚本就能
 * 借它把工作区外的内容读出来。`fenceAgentFilePath` 会 realpath 后再判根，并把
 * 密钥/治理数据挡在 deny-list 外（与 write_document / 主机工具同一道门）。
 */
function assertSafeRel(workspaceDir: string, raw: string): { abs: string; rel: string } {
  const resolved = resolveWorkspaceRelativePath(workspaceDir, raw);
  if (!resolved.ok) {
    throw new Error("路径不在工作区内。");
  }
  // 治理/真相源（tasks/、matters/、策略、RULES.md 等）不进沙箱：脚本是最少受监督的
  // 代码路径，不该顺手把引擎内部数据当材料读走。
  if (isProtectedWorkspaceRel(resolved.rel)) {
    throw new Error(PROTECTED_WORKSPACE_WRITE_REFUSAL);
  }
  const fenced = fenceAgentFilePath({ rootDir: workspaceDir, abs: resolved.abs });
  if (!fenced.ok) {
    throw new Error(fenced.error);
  }
  return { abs: fenced.abs, rel: resolved.rel };
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
      const located = assertSafeRel(workspaceDir, filePath ?? "");
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
      const base = path.basename((filePath ?? "").replace(/\\/g, "/"));
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
      const located = assertSafeRel(workspaceDir, filePath ?? "");
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
      const located = assertSafeRel(workspaceDir, filePath ?? "");
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
    /**
     * 读纯文本（.txt/.md/.csv/.json…任意可解码文本）。
     *
     * 补这一支的理由：沙箱此前只能读表格三件套（xlsx/csv/json），连一份
     * `.md` 或 `.txt` 材料都读不进来——于是「把这 200 份材料过一遍、建个清单」
     * 这类批量活儿，写代码也干不成。二进制（PDF/Word/图片）仍走
     * `analyze_document`，不在这里假装能读。
     */
    async readText(filePath: string): Promise<string> {
      const located = assertSafeRel(workspaceDir, filePath ?? "");
      const st = await fs.stat(located.abs);
      if (st.isDirectory()) {
        throw new Error("这是目录，请用 listFiles。");
      }
      if (st.size > ANALYSIS_TEXT_MAX_BYTES) {
        throw new Error(`文本文件过大（上限 ${ANALYSIS_TEXT_MAX_BYTES} 字节）。`);
      }
      const buf = await fs.readFile(located.abs);
      if (buf.includes(0)) {
        throw new Error("这是二进制文件，请用 analyze_document 读正文。");
      }
      return buf.toString("utf8");
    },
    /**
     * 列目录（有界走查）。批量整理的第一块砖：先看清有什么，再逐个读。
     * 跳过软链、点文件与 deny-list（密钥/治理数据）；默认不递归，`recursive: true`
     * 时按 `ANALYSIS_LIST_MAX_DEPTH` / `ANALYSIS_LIST_MAX_ENTRIES` 截断。
     */
    async listFiles(
      dirPath?: string,
      opts?: { recursive?: boolean },
    ): Promise<{ path: string; entries: AnalysisDirEntry[]; truncated: boolean }> {
      const raw = (dirPath ?? "").trim();
      const located = assertSafeRel(workspaceDir, raw || ".");
      const st = await fs.stat(located.abs);
      if (!st.isDirectory()) {
        throw new Error("不是目录。");
      }
      const recursive = opts?.recursive === true;
      const entries: AnalysisDirEntry[] = [];
      let truncated = false;
      const walk = async (absDir: string, relDir: string, depth: number): Promise<void> => {
        if (truncated) {
          return;
        }
        let items: import("node:fs").Dirent[];
        try {
          items = await fs.readdir(absDir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ent of items) {
          if (entries.length >= ANALYSIS_LIST_MAX_ENTRIES) {
            truncated = true;
            return;
          }
          if (ent.isSymbolicLink() || ent.name.startsWith(".")) {
            continue;
          }
          const childAbs = path.join(absDir, ent.name);
          const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;
          if (
            isDeniedHostPath(childAbs, {
              homeDir: os.homedir(),
              workspaceDir,
            })
          ) {
            continue;
          }
          if (ent.isDirectory()) {
            entries.push({ name: ent.name, path: childRel, kind: "directory" });
            if (recursive && depth < ANALYSIS_LIST_MAX_DEPTH) {
              await walk(childAbs, childRel, depth + 1);
            }
            continue;
          }
          if (!ent.isFile()) {
            continue;
          }
          let size: number | undefined;
          try {
            size = (await fs.stat(childAbs)).size;
          } catch {
            /* size 是提示，不是必需 */
          }
          entries.push({
            name: ent.name,
            path: childRel,
            kind: "file",
            ...(typeof size === "number" ? { size } : {}),
          });
        }
      };
      await walk(located.abs, located.rel, 0);
      return { path: located.rel || ".", entries, truncated };
    },
    /**
     * 写文本文件。落点与 `writeTable` 同一口径：只允许 `artifacts/`。
     *
     * 路径策略（刻意严格，避免"静默换地方"）：
     *   - 只给文件名（`清单.txt`）→ 落 `artifacts/analysis/清单.txt`；
     *   - 给 `artifacts/...` 开头的相对路径 → 按原路径写；
     *   - 其它（绝对路径、`cases/...`、`../` 等）→ **报错并要求改**，不做重定向。
     *
     * 为什么不放更宽：脚本是"当场写、当场跑"的临时产物，让它能往案件卷、治理目录
     * 或交付管线里落字节，等于绕过 `write_document` 的门（研究类正文有旁路门禁）。
     * 需要把结果放进案件卷或出正式交付物时，由模型读完本函数返回的路径，再用
     * `write_document` / `draft_document` 办理。
     */
    async writeText(filePath: string, content: unknown): Promise<{ path: string; chars: number }> {
      const raw = (filePath ?? "").trim().replace(/\\/g, "/");
      if (!raw) {
        throw new Error("缺少文件名。");
      }
      const hasDir = raw.includes("/") || path.isAbsolute(raw);
      const rel = hasDir ? raw.replace(/^\/+/, "") : `artifacts/analysis/${raw}`;
      if (!rel.startsWith("artifacts/")) {
        throw new Error(
          `writeText 只能写 artifacts/ 下（建议只传文件名，如 "清单.txt" → artifacts/analysis/清单.txt）。收到：${raw}`,
        );
      }
      const base = path.posix.basename(rel);
      if (!base || base.startsWith(".")) {
        throw new Error("文件名无效。");
      }
      const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      if (text === undefined) {
        throw new Error("内容无法序列化。");
      }
      if (text.length > ANALYSIS_WRITE_MAX_CHARS) {
        throw new Error(`写入内容过大（上限 ${ANALYSIS_WRITE_MAX_CHARS} 字符）。`);
      }
      if (isProtectedWorkspaceRel(rel) || isProtectedAnalysisScriptRel(rel)) {
        throw new Error(PROTECTED_WORKSPACE_WRITE_REFUSAL);
      }
      const located = assertSafeRel(workspaceDir, rel);
      await fs.mkdir(path.dirname(located.abs), { recursive: true });
      // mkdir 之后再 fence 一次：父目录可能是软链，realpath 后才看得出它通向哪里。
      const refenced = fenceAgentFilePath({ rootDir: workspaceDir, abs: located.abs });
      if (!refenced.ok) {
        throw new Error(refenced.error);
      }
      await fs.writeFile(refenced.abs, text, "utf8");
      const written = { path: located.rel, chars: text.length };
      out.files = [...(out.files ?? []), written];
      return written;
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
    readText: api.readText.bind(api),
    listFiles: api.listFiles.bind(api),
    stats: api.stats.bind(api),
    writeTable: api.writeTable.bind(api),
    writeText: api.writeText.bind(api),
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
