/**
 * 证据支持度：从「能定位」走到「能支持结论」。
 *
 * 现有引用只记 `path#line=3` 与一段 quote。它能回答「这个位置存在」，
 * 回答不了两个更要紧的问题：
 *   1. 材料后来被改过吗？（引用的还是当时那段原文吗）
 *   2. 那段原文真的在支持这条结论 / 这个字段吗？
 *
 * 本模块只做可判定的部分，不假装能判断法律适用：
 *   - `missing`       ：来源文件不在了
 *   - `stale`         ：文件版本变了（内容摘要不同）
 *   - `quote_mismatch`：版本未变/未知，但在正文里找不到那段原句
 *   - `supported`     ：版本一致（或未知）且原句能在正文里找到
 *   - `unverifiable`  ：没有 quote 或没有可读正文，无法判断（不得算通过）
 *
 * 「字段角色是否吻合」仍由抽取层（`review-table-patterns`）与模型负责：
 * 原句存在只证明定位，不证明语义。
 */

import fs from "node:fs";
import path from "node:path";
import { fileVersionOf } from "../runtime/file-version.js";
import { fenceAgentFilePath } from "../runtime/workspace-io-fence.js";
import {
  locatorNeedsRichParser,
  locatorPlainTextLineRange,
  parseEvidenceLocator,
  type EvidenceLocator,
} from "./evidence-locator.js";
import { readRichLocatorText } from "./evidence-rich-locator.js";

export { fileVersionOf };

export type EvidenceSupportStatus =
  | "supported"
  | "quote_mismatch"
  | "stale"
  | "missing"
  | "unverifiable";

export type EvidenceSupport = {
  status: EvidenceSupportStatus;
  /** 律师可读的一句话；UI 直接显示，不必再拼。 */
  reasonZh: string;
  /** 当前文件版本（可计算时）；与预期不同即为 `stale`。 */
  actualVersion?: string;
};

/**
 * 解码纯文本来源。中文材料常见 GBK/GB18030，按 UTF-8 强读会把原句读成乱码，
 * 进而把「编码不对」误判成「原句找不到」并挡住交件。这里 BOM → UTF-8 → GBK 依次尝试；
 * 都不行就返回失败，让调用方标「无法判定」而不是「不一致」。
 */
export function decodePlainText(
  bytes: Buffer | Uint8Array,
): { ok: true; text: string } | { ok: false } {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { ok: true, text: buf.subarray(3).toString("utf8") };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { ok: true, text: buf.subarray(2).toString("utf16le") };
  }
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { ok: true, text: utf8 };
  } catch {
    /* 不是合法 UTF-8：继续试中文常见编码。 */
  }
  for (const label of ["gb18030", "gbk"]) {
    try {
      const text = new TextDecoder(label, { fatal: true }).decode(buf);
      return { ok: true, text };
    } catch {
      /* 该编码也解不了 */
    }
  }
  return { ok: false };
}

/** 归一化：全半角、中文标点、空白与大小写差异不应当成「原文对不上」。 */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, "")
    .replace(/[，、；：（）【】“”‘’]/g, (ch) => {
      const map: Record<string, string> = {
        "，": ",",
        "、": ",",
        "；": ";",
        "：": ":",
        "（": "(",
        "）": ")",
        "【": "[",
        "】": "]",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
      };
      return map[ch] ?? ch;
    });
}

export function quoteAppearsIn(normalizedHaystack: string, quote: string): boolean {
  const needle = normalizeForQuoteMatch(quote);
  if (!needle) {
    return false;
  }
  return normalizedHaystack.includes(needle);
}

type SourceResolution =
  | { ok: false; support: EvidenceSupport }
  | {
      ok: true;
      rel: string;
      abs: string;
      actualVersion: string;
      locatorRaw: string;
    };

function resolveSource(opts: {
  rootDir: string;
  relPath: string;
  quote?: string;
  expectedVersion?: string;
}): SourceResolution {
  const rel = (opts.relPath ?? "").split("#")[0]?.trim() ?? "";
  if (!rel) {
    return {
      ok: false,
      support: { status: "unverifiable", reasonZh: "没有记录来源文件，无法核对。" },
    };
  }
  const root = path.resolve(opts.rootDir);
  const fenced = fenceAgentFilePath({ rootDir: root, abs: path.resolve(root, rel) });
  if (!fenced.ok) {
    return { ok: false, support: { status: "unverifiable", reasonZh: fenced.error } };
  }
  const abs = fenced.abs;
  const actualVersion = fileVersionOf(abs);
  if (!actualVersion) {
    return {
      ok: false,
      support: { status: "missing", reasonZh: `来源文件已不存在：${rel}` },
    };
  }
  if (opts.expectedVersion && opts.expectedVersion !== actualVersion) {
    return {
      ok: false,
      support: {
        status: "stale",
        reasonZh: "来源文件在引用之后被改过，原句可能已移动或失效，请重新核对。",
        actualVersion,
      },
    };
  }
  if (!opts.quote?.trim()) {
    return {
      ok: false,
      support: {
        status: "unverifiable",
        reasonZh: "这条依据没有记录原文，只能核对文件存在，不能核对内容。",
        actualVersion,
      },
    };
  }
  return {
    ok: true,
    rel,
    abs,
    actualVersion,
    locatorRaw: opts.relPath.split("#").slice(1).join("#").trim(),
  };
}

/** 读完之后再核一次版本 + 原句匹配；同步与异步读取共用同一收尾。 */
function finishQuoteCheck(
  abs: string,
  actualVersion: string,
  raw: string,
  quote: string,
): EvidenceSupport {
  const recheckedVersion = fileVersionOf(abs);
  if (recheckedVersion !== actualVersion) {
    return {
      status: "stale",
      reasonZh: "核对过程中来源文件发生变更，请重新读取。",
      actualVersion: recheckedVersion,
    };
  }
  if (!quoteAppearsIn(normalizeForQuoteMatch(raw), quote)) {
    return {
      status: "quote_mismatch",
      reasonZh: "引用的原句在来源文件中找不到，可能已被改写。",
      actualVersion,
    };
  }
  return { status: "supported", reasonZh: "原句可在来源文件中找到。", actualVersion };
}

function isPlainTextRel(rel: string): boolean {
  return /\.(md|txt|markdown|csv|json)$/i.test(rel);
}

function slicePlainTextByLocator(
  raw: string,
  locatorRaw: string,
  actualVersion: string,
): { ok: true; text: string } | { ok: false; support: EvidenceSupport } {
  if (!locatorRaw) {
    return { ok: true, text: raw };
  }
  const locator = parseEvidenceLocator(locatorRaw);
  if (!locator) {
    return {
      ok: false,
      support: { status: "unverifiable", reasonZh: "尚不支持该来源定位方式。", actualVersion },
    };
  }
  if (locatorNeedsRichParser(locator)) {
    return {
      ok: false,
      support: {
        status: "unverifiable",
        reasonZh: "页/单元格定位需要专用解析器，本次未核对。",
        actualVersion,
      },
    };
  }
  const range = locatorPlainTextLineRange(locator);
  if (!range) {
    return {
      ok: false,
      support: { status: "unverifiable", reasonZh: "尚不支持该来源定位方式。", actualVersion },
    };
  }
  const all = raw.split(/\r?\n/);
  if (range.start < 1 || range.end < range.start || range.end > all.length) {
    return {
      ok: false,
      support: {
        status: "quote_mismatch",
        reasonZh: "来源定位超出当前文件范围。",
        actualVersion,
      },
    };
  }
  return { ok: true, text: all.slice(range.start - 1, range.end).join("\n") };
}

/**
 * 判定一条证据还能不能当依据（同步版）。
 *
 * 纯文本行定位可核对；PDF 页/Excel 单元格需要异步读取器，
 * 这里保持 `INCOMPLETE`，不得当作通过。需要核对富定位请用
 * `checkEvidenceSupportAsync`。
 *
 * @param rootDir 工作区根；`relPath` 相对它解析（越界拒绝）
 * @param relPath 材料相对路径（可带 `#line=3` 之类的定位后缀，会被剥掉）
 */
export function checkEvidenceSupport(opts: {
  rootDir: string;
  relPath: string;
  quote?: string;
  /** 抽取/引用时记录的版本；缺省表示历史数据，版本未知。 */
  expectedVersion?: string;
}): EvidenceSupport {
  const source = resolveSource(opts);
  if (!source.ok) {
    return source.support;
  }
  const { rel, abs, actualVersion, locatorRaw } = source;
  if (!isPlainTextRel(rel)) {
    // docx/pdf 需要各自的抽取器；本函数不假装能读。
    return {
      status: "unverifiable",
      reasonZh: "该格式需要专用解析器才能核对原句，本次未核对。",
      actualVersion,
    };
  }
  let raw = "";
  try {
    const decoded = decodePlainText(fs.readFileSync(abs));
    if (!decoded.ok) {
      // 编码认不出就不判「原句不存在」：那是 false block，比「未核对」更糟。
      return {
        status: "unverifiable",
        reasonZh: "来源文件编码无法识别（既不是 UTF-8 也不是 GBK），本次未核对原句。",
        actualVersion,
      };
    }
    raw = decoded.text;
  } catch {
    return {
      status: "unverifiable",
      reasonZh: "读取来源文件失败，未完成核对。",
      actualVersion,
    };
  }
  const sliced = slicePlainTextByLocator(raw, locatorRaw, actualVersion);
  if (!sliced.ok) {
    return sliced.support;
  }
  return finishQuoteCheck(abs, actualVersion, sliced.text, opts.quote!);
}

/**
 * 异步版：额外支持 PDF 页码（`P{n}`）与 Excel 单元格/范围（`S{n}!A1`）。
 * 读不出来一律 `unverifiable`，调用方不得当成通过。
 */
export async function checkEvidenceSupportAsync(opts: {
  rootDir: string;
  relPath: string;
  quote?: string;
  expectedVersion?: string;
}): Promise<EvidenceSupport> {
  const source = resolveSource(opts);
  if (!source.ok) {
    return source.support;
  }
  const { rel, abs, actualVersion, locatorRaw } = source;
  const locator: EvidenceLocator | null = locatorRaw ? parseEvidenceLocator(locatorRaw) : null;
  if (locatorRaw && !locator) {
    return { status: "unverifiable", reasonZh: "尚不支持该来源定位方式。", actualVersion };
  }
  if (locator && locatorNeedsRichParser(locator)) {
    const rich = await readRichLocatorText(abs, rel, locator);
    if (!rich.ok) {
      return { status: "unverifiable", reasonZh: rich.reason, actualVersion };
    }
    return finishQuoteCheck(abs, actualVersion, rich.text, opts.quote!);
  }
  if (!isPlainTextRel(rel)) {
    return {
      status: "unverifiable",
      reasonZh: "该格式需要专用解析器才能核对原句，本次未核对。",
      actualVersion,
    };
  }
  let raw = "";
  try {
    const decoded = decodePlainText(await fs.promises.readFile(abs));
    if (!decoded.ok) {
      return {
        status: "unverifiable",
        reasonZh: "来源文件编码无法识别（既不是 UTF-8 也不是 GBK），本次未核对原句。",
        actualVersion,
      };
    }
    raw = decoded.text;
  } catch {
    return {
      status: "unverifiable",
      reasonZh: "读取来源文件失败，未完成核对。",
      actualVersion,
    };
  }
  const sliced = slicePlainTextByLocator(raw, locatorRaw, actualVersion);
  if (!sliced.ok) {
    return sliced.support;
  }
  return finishQuoteCheck(abs, actualVersion, sliced.text, opts.quote!);
}

/** 汇总：任一条 stale / mismatch / missing 都不得当作「全部可核验」。 */
export function summarizeEvidenceSupport(results: readonly EvidenceSupport[]): {
  supported: number;
  stale: number;
  quoteMismatch: number;
  missing: number;
  unverifiable: number;
  /** `supported` 之外都算未通过核对。 */
  allSupported: boolean;
} {
  const out = {
    supported: 0,
    stale: 0,
    quoteMismatch: 0,
    missing: 0,
    unverifiable: 0,
    allSupported: true,
  };
  for (const result of results) {
    switch (result.status) {
      case "supported":
        out.supported += 1;
        break;
      case "stale":
        out.stale += 1;
        break;
      case "quote_mismatch":
        out.quoteMismatch += 1;
        break;
      case "missing":
        out.missing += 1;
        break;
      default:
        out.unverifiable += 1;
    }
  }
  out.allSupported = results.length > 0 && out.supported === results.length;
  return out;
}
