/**
 * Hard gate: tracked insert/delete runs must keep the neighbor run's direct
 * formatting (font, size, bold, …). officecli find/replace may emit bare
 * `w:r` inside `w:ins`/`w:del`; this module repairs then re-checks.
 *
 * Empty rPr on both the revision and its donor is OK (paragraph/style inherit).
 * A donor with direct props and a bare revision run is a violation until repaired.
 */

import fs from "node:fs/promises";
import JSZip from "jszip";

export type TrackedFormatViolation = {
  kind: "ins" | "del";
  text: string;
  reason: string;
};

export type TrackedFormatRepairResult = {
  repaired: number;
  unresolved: TrackedFormatViolation[];
  xml: string;
};

export type TrackedFormatQa = {
  ok: boolean;
  checked: boolean;
  repaired: number;
  violations: TrackedFormatViolation[];
  warning?: string;
};

const RPR_RE = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/;
const RUN_RE = /<w:r\b[^>]*(?:\/>|>[\s\S]*?<\/w:r>)/g;
const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;

type SpanKind = "run" | "ins" | "del";

type Span = {
  kind: SpanKind;
  start: number;
  end: number;
  xml: string;
};

/** Comparable slice of direct run props that change how lawyers see the text. */
export type FormatSignature = {
  rFonts?: string;
  rStyle?: string;
  sz?: string;
  szCs?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** 修订/划线常客：删除线（w:strike、w:dstrike）。 */
  strike: boolean;
  /** 上下标（w:vertAlign）——金额、脚标编号的常见直接格式。 */
  vertAlign?: string;
  /** 高亮（w:highlight）。 */
  highlight?: string;
  /** 隐藏文字（w:vanish）——是否可见也属于「律师看到的样子」。 */
  vanish: boolean;
  color?: string;
};

export function extractRPrXml(runOrInner: string): string | undefined {
  const m = runOrInner.match(RPR_RE);
  return m?.[0];
}

export function signatureOfRPr(rPr: string | undefined): FormatSignature {
  if (!rPr) {
    return { bold: false, italic: false, underline: false, strike: false, vanish: false };
  }
  const rFontsTag = rPr.match(/<w:rFonts\b[^>]*\/?>/)?.[0];
  const rFonts = rFontsTag ? normalizeAttrs(rFontsTag) : undefined;
  const rStyle = attrVal(rPr, /<w:rStyle\b[^>]*w:val="([^"]*)"/);
  const sz = attrVal(rPr, /<w:sz\b[^>]*w:val="([^"]*)"/);
  const szCs = attrVal(rPr, /<w:szCs\b[^>]*w:val="([^"]*)"/);
  const color = attrVal(rPr, /<w:color\b[^>]*w:val="([^"]*)"/);
  const vertAlign = attrVal(rPr, /<w:vertAlign\b[^>]*w:val="([^"]*)"/);
  const highlight = attrVal(rPr, /<w:highlight\b[^>]*w:val="([^"]*)"/);
  return {
    ...(rFonts ? { rFonts } : {}),
    ...(rStyle ? { rStyle } : {}),
    ...(sz ? { sz } : {}),
    ...(szCs ? { szCs } : {}),
    bold: /<w:b\b[^>]*\/?>|<w:b\b[^>]*>\s*<\/w:b>/.test(rPr) && !/<w:b\b[^>]*w:val="0"/.test(rPr),
    italic: /<w:i\b[^>]*\/?>|<w:i\b[^>]*>\s*<\/w:i>/.test(rPr) && !/<w:i\b[^>]*w:val="0"/.test(rPr),
    underline: /<w:u\b/.test(rPr) && !/<w:u\b[^>]*w:val="none"/.test(rPr),
    strike:
      /<w:strike\b|<w:dstrike\b/.test(rPr) &&
      !/<w:(?:strike|dstrike)\b[^>]*w:val="(?:0|false)"/.test(rPr),
    ...(vertAlign ? { vertAlign } : {}),
    ...(highlight ? { highlight } : {}),
    vanish: /<w:vanish\b/.test(rPr) && !/<w:vanish\b[^>]*w:val="(?:0|false)"/.test(rPr),
    ...(color && color.toLowerCase() !== "auto" ? { color: color.toLowerCase() } : {}),
  };
}

export function signatureHasDirectProps(sig: FormatSignature): boolean {
  return Boolean(
    sig.rFonts ||
    sig.rStyle ||
    sig.sz ||
    sig.szCs ||
    sig.bold ||
    sig.italic ||
    sig.underline ||
    sig.strike ||
    sig.vertAlign ||
    sig.highlight ||
    sig.vanish ||
    sig.color,
  );
}

export function signaturesEqual(a: FormatSignature, b: FormatSignature): boolean {
  return (
    a.rFonts === b.rFonts &&
    a.rStyle === b.rStyle &&
    a.sz === b.sz &&
    a.szCs === b.szCs &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.vertAlign === b.vertAlign &&
    a.highlight === b.highlight &&
    a.vanish === b.vanish &&
    a.color === b.color
  );
}

export function injectRPrIntoRun(runXml: string, rPr: string): string {
  if (runXml.endsWith("/>")) {
    return runXml;
  }
  if (RPR_RE.test(runXml)) {
    return runXml.replace(RPR_RE, rPr);
  }
  return runXml.replace(/(<w:r\b[^>]*>)/, `$1${rPr}`);
}

export function repairTrackedRunFormatInXml(xml: string): TrackedFormatRepairResult {
  let repaired = 0;
  const unresolved: TrackedFormatViolation[] = [];
  const next = xml.replace(PARA_RE, (para) => {
    const result = repairParagraph(para);
    repaired += result.repaired;
    unresolved.push(...result.unresolved);
    return result.xml;
  });
  return { xml: next, repaired, unresolved };
}

export function findTrackedFormatMismatches(xml: string): TrackedFormatViolation[] {
  const violations: TrackedFormatViolation[] = [];
  for (const para of xml.matchAll(PARA_RE)) {
    violations.push(...mismatchesInParagraph(para[0] ?? ""));
  }
  return violations;
}

export async function repairTrackedDocxFormat(filePath: string): Promise<{
  repaired: number;
  unresolved: TrackedFormatViolation[];
}> {
  const buf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) {
    return { repaired: 0, unresolved: [] };
  }
  const xml = await file.async("string");
  const result = repairTrackedRunFormatInXml(xml);
  if (result.repaired > 0 || result.xml !== xml) {
    zip.file("word/document.xml", result.xml);
    await fs.writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
  }
  return { repaired: result.repaired, unresolved: result.unresolved };
}

export async function qaTrackedDocxFormat(filePath: string): Promise<TrackedFormatQa> {
  let xml = "";
  try {
    const buf = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  } catch {
    return {
      ok: false,
      checked: false,
      repaired: 0,
      violations: [],
      warning: "无法打开导出的 Word 做格式对齐核对。",
    };
  }
  if (!xml) {
    return {
      ok: false,
      checked: false,
      repaired: 0,
      violations: [],
      warning: "导出文件没有 word/document.xml，无法核对格式对齐。",
    };
  }
  const violations = findTrackedFormatMismatches(xml);
  if (violations.length === 0) {
    return { ok: true, checked: true, repaired: 0, violations: [] };
  }
  const head = violations[0];
  return {
    ok: false,
    checked: true,
    repaired: 0,
    violations,
    warning:
      `导出的修订文字有 ${violations.length} 处未对齐原稿直接格式` +
      `（字体/字号/加粗等）：${head?.kind ?? "ins"}「${head?.text ?? ""}」。` +
      "导出时已按旁边原稿补过；仍不一致的地方请律师在 Word 里看。",
  };
}

function repairParagraph(para: string): {
  xml: string;
  repaired: number;
  unresolved: TrackedFormatViolation[];
} {
  const openEnd = para.indexOf(">");
  const close = para.lastIndexOf("</w:p>");
  if (openEnd < 0 || close < 0) {
    return { xml: para, repaired: 0, unresolved: [] };
  }
  const open = para.slice(0, openEnd + 1);
  const inner = para.slice(openEnd + 1, close);
  const spans = collectSpans(inner);
  let repaired = 0;
  const unresolved: TrackedFormatViolation[] = [];
  let out = "";
  let cursor = 0;
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (!span || (span.kind !== "ins" && span.kind !== "del")) {
      continue;
    }
    out += inner.slice(cursor, span.start);
    const donor = donorRPrFor(spans, i);
    if (!donor || !signatureHasDirectProps(signatureOfRPr(donor))) {
      out += span.xml;
      cursor = span.end;
      continue;
    }
    const patched = patchRevisionRuns(span.xml, span.kind, donor);
    repaired += patched.repaired;
    unresolved.push(...patched.unresolved);
    out += patched.xml;
    cursor = span.end;
  }
  out += inner.slice(cursor);
  return { xml: `${open}${out}</w:p>`, repaired, unresolved };
}

function mismatchesInParagraph(para: string): TrackedFormatViolation[] {
  const openEnd = para.indexOf(">");
  const close = para.lastIndexOf("</w:p>");
  if (openEnd < 0 || close < 0) {
    return [];
  }
  const inner = para.slice(openEnd + 1, close);
  const spans = collectSpans(inner);
  const violations: TrackedFormatViolation[] = [];
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (!span || (span.kind !== "ins" && span.kind !== "del")) {
      continue;
    }
    for (const run of span.xml.matchAll(RUN_RE)) {
      const runXml = run[0] ?? "";
      if (runXml.endsWith("/>") || !runHasVisibleText(runXml)) {
        continue;
      }
      const sig = signatureOfRPr(extractRPrXml(runXml));
      // Deletion runs that still carry direct props are the original glyphs.
      if (span.kind === "del" && signatureHasDirectProps(sig)) {
        continue;
      }
      const donor = donorRPrFor(spans, i);
      if (!donor || !signatureHasDirectProps(signatureOfRPr(donor))) {
        continue;
      }
      const donorSig = signatureOfRPr(donor);
      if (!signaturesEqual(sig, donorSig)) {
        violations.push({
          kind: span.kind,
          text: visibleRevisionText(runXml, span.kind).slice(0, 40),
          reason: "修订 run 的直接格式与邻接原稿 run 不一致",
        });
      }
    }
  }
  return violations;
}

function patchRevisionRuns(
  revXml: string,
  kind: "ins" | "del",
  donorRPr: string,
): { xml: string; repaired: number; unresolved: TrackedFormatViolation[] } {
  const donorSig = signatureOfRPr(donorRPr);
  let repaired = 0;
  const unresolved: TrackedFormatViolation[] = [];
  const xml = revXml.replace(RUN_RE, (runXml) => {
    if (runXml.endsWith("/>") || !runHasVisibleText(runXml)) {
      return runXml;
    }
    const current = extractRPrXml(runXml);
    const currentSig = signatureOfRPr(current);
    if (signaturesEqual(currentSig, donorSig)) {
      return runXml;
    }
    // Never clobber a deletion run that already has original direct formatting
    // (e.g. mixed KaiTi inside a SimSun paragraph).
    if (kind === "del" && signatureHasDirectProps(currentSig)) {
      return runXml;
    }
    const next = injectRPrIntoRun(runXml, donorRPr);
    if (signaturesEqual(signatureOfRPr(extractRPrXml(next)), donorSig)) {
      repaired += 1;
      return next;
    }
    unresolved.push({
      kind,
      text: visibleRevisionText(runXml, kind).slice(0, 40),
      reason: "无法把邻接原稿格式写入该修订 run",
    });
    return runXml;
  });
  return { xml, repaired, unresolved };
}

/**
 * Donor order (hard control — no cross-cluster bleed):
 * 1. Paired previous `w:del` for a `w:ins` (original glyphs of this replace)
 * 2. Nearest plain `w:r` by span distance (not another revision pair)
 *
 * Never borrow `w:rPr` from an unrelated `w:ins`/`w:del` cluster.
 */
function donorRPrFor(spans: Span[], index: number): string | undefined {
  const self = spans[index];
  if (!self || (self.kind !== "ins" && self.kind !== "del")) {
    return undefined;
  }
  if (self.kind === "ins") {
    const prev = spans[index - 1];
    if (prev?.kind === "del") {
      const fromDel = firstRunRPr(prev.xml);
      if (fromDel && signatureHasDirectProps(signatureOfRPr(fromDel))) {
        return fromDel;
      }
    }
  }
  return nearestPlainRunRPr(spans, index);
}

function nearestPlainRunRPr(spans: Span[], index: number): string | undefined {
  let best: { dist: number; rPr: string } | undefined;
  for (let i = 0; i < spans.length; i += 1) {
    if (i === index) {
      continue;
    }
    const span = spans[i];
    if (span?.kind !== "run") {
      continue;
    }
    const rPr = extractRPrXml(span.xml);
    if (!rPr || !signatureHasDirectProps(signatureOfRPr(rPr))) {
      continue;
    }
    const dist = Math.abs(i - index);
    if (!best || dist < best.dist) {
      best = { dist, rPr };
    }
  }
  return best?.rPr;
}

function collectSpans(inner: string): Span[] {
  const spans: Span[] = [];
  for (const tag of ["ins", "del"] as const) {
    const re = new RegExp(`<w:${tag}\\b[^>]*>[\\s\\S]*?</w:${tag}>`, "g");
    for (const m of inner.matchAll(re)) {
      spans.push({
        kind: tag,
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        xml: m[0],
      });
    }
  }
  for (const m of inner.matchAll(RUN_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (
      spans.some((s) => (s.kind === "ins" || s.kind === "del") && start >= s.start && end <= s.end)
    ) {
      continue;
    }
    spans.push({ kind: "run", start, end, xml: m[0] });
  }
  return spans.toSorted((a, b) => a.start - b.start || a.end - b.end);
}

function firstRunRPr(revXml: string): string | undefined {
  for (const m of revXml.matchAll(RUN_RE)) {
    const runXml = m[0] ?? "";
    if (runXml.endsWith("/>") || !runHasVisibleText(runXml)) {
      continue;
    }
    const rPr = extractRPrXml(runXml);
    if (rPr) {
      return rPr;
    }
  }
  return undefined;
}

function runHasVisibleText(runXml: string): boolean {
  return /<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/.test(runXml);
}

function visibleRevisionText(runXml: string, kind: "ins" | "del"): string {
  const tag = kind === "del" ? "w:delText" : "w:t";
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let out = "";
  for (const m of runXml.matchAll(re)) {
    out += (m[1] ?? "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return out;
}

function attrVal(block: string, re: RegExp): string | undefined {
  return block.match(re)?.[1];
}

function normalizeAttrs(tag: string): string {
  const attrs = [...tag.matchAll(/\b([\w:]+)="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`).toSorted();
  return attrs.join("|");
}
