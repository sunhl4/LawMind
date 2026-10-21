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

/**
 * 判定一条证据还能不能当依据。
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
  const rel = (opts.relPath ?? "").split("#")[0]?.trim() ?? "";
  if (!rel) {
    return { status: "unverifiable", reasonZh: "没有记录来源文件，无法核对。" };
  }
  const root = path.resolve(opts.rootDir);
  const fenced = fenceAgentFilePath({ rootDir: root, abs: path.resolve(root, rel) });
  if (!fenced.ok) {
    return { status: "unverifiable", reasonZh: fenced.error };
  }
  const abs = fenced.abs;
  const actualVersion = fileVersionOf(abs);
  if (!actualVersion) {
    return { status: "missing", reasonZh: `来源文件已不存在：${rel}` };
  }
  if (opts.expectedVersion && opts.expectedVersion !== actualVersion) {
    return {
      status: "stale",
      reasonZh: "来源文件在引用之后被改过，原句可能已移动或失效，请重新核对。",
      actualVersion,
    };
  }
  if (!opts.quote?.trim()) {
    return {
      status: "unverifiable",
      reasonZh: "这条依据没有记录原文，只能核对文件存在，不能核对内容。",
      actualVersion,
    };
  }
  if (!/\.(md|txt|markdown|csv|json)$/i.test(rel)) {
    // docx/pdf 需要各自的抽取器；本函数不假装能读。
    return {
      status: "unverifiable",
      reasonZh: "该格式需要专用解析器才能核对原句，本次未核对。",
      actualVersion,
    };
  }
  let raw = "";
  try {
    const bytes = fs.readFileSync(abs);
    const decoded = decodePlainText(bytes);
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
  // Locator is part of the evidence, not decoration. Only line locators are
  // currently verifiable for plain text; unsupported locators remain unknown.
  const locator = opts.relPath.split("#").slice(1).join("#").trim();
  if (locator) {
    const lines = /^(?:line=|L)(\d+)(?:[-:](?:L)?(\d+))?$/.exec(locator);
    if (!lines) {
      return { status: "unverifiable", reasonZh: "尚不支持该来源定位方式。", actualVersion };
    }
    const start = Number(lines[1]);
    const end = Number(lines[2] ?? start);
    const all = raw.split(/\r?\n/);
    if (start < 1 || end < start || end > all.length) {
      return { status: "quote_mismatch", reasonZh: "来源定位超出当前文件范围。", actualVersion };
    }
    raw = all.slice(start - 1, end).join("\n");
  }
  // 读完之后再核一次版本：只算一次，别在「变更」分支里重算第二遍（大文件上是纯浪费）。
  const recheckedVersion = fileVersionOf(abs);
  if (recheckedVersion !== actualVersion) {
    return {
      status: "stale",
      reasonZh: "核对过程中来源文件发生变更，请重新读取。",
      actualVersion: recheckedVersion,
    };
  }
  if (!quoteAppearsIn(normalizeForQuoteMatch(raw), opts.quote)) {
    return {
      status: "quote_mismatch",
      reasonZh: "引用的原句在来源文件中找不到，可能已被改写。",
      actualVersion,
    };
  }
  return { status: "supported", reasonZh: "原句可在来源文件中找到。", actualVersion };
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
