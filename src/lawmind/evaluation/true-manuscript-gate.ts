/**
 * Optional true-manuscript gate.
 * Place real .docx / 起诉状 under fixtures/lawmind-true-manuscript/ to compare
 * against panrui / copilot baselines. Missing fixtures must skip — never
 * pretend in-repo NDA markdown is 真稿.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TRUE_MANUSCRIPT_DIR_REL = "fixtures/lawmind-true-manuscript";

export type TrueManuscriptGate = {
  present: boolean;
  dir: string;
  files: string[];
  skipReason?: string;
};

export function resolveTrueManuscriptDir(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.join(root, TRUE_MANUSCRIPT_DIR_REL);
}

export function inspectTrueManuscriptGate(repoRoot?: string): TrueManuscriptGate {
  const dir = resolveTrueManuscriptDir(repoRoot);
  if (!fs.existsSync(dir)) {
    return {
      present: false,
      dir,
      files: [],
      skipReason:
        "未放入 fixtures/lawmind-true-manuscript/（真 .docx / 起诉状）。仓库内 NDA markdown 不能替代。",
    };
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => /\.(docx|doc|pdf)$/i.test(name) && !name.startsWith("."));
  if (files.length === 0) {
    return {
      present: false,
      dir,
      files: [],
      skipReason:
        "真稿目录 fixtures/lawmind-true-manuscript/ 存在但没有 .docx/.doc/.pdf。仓库内 NDA markdown 不能替代。",
    };
  }
  return { present: true, dir, files };
}

/** Always-printable status for CLI / CI logs (never silent about skip). */
export function formatTrueManuscriptGateReport(gate: TrueManuscriptGate): string {
  if (!gate.present) {
    return `SKIP: ${gate.skipReason ?? "真稿夹具未放入"}`;
  }
  const baselines = loadTrueManuscriptBaselines(gate.dir);
  return `RUN: ${gate.files.length} file(s)${baselines.length > 0 ? ` · ${baselines.length} sidecar baseline(s)` : ""} → ${gate.dir}`;
}

/**
 * CLI entry for `pnpm lawmind:true-manuscript`.
 * Default: print SKIP/RUN and exit 0 (honest skip is not a failure).
 * `LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1`: exit 1 on skip (local/nightly only).
 */
export async function runTrueManuscriptGateCli(opts?: {
  repoRoot?: string;
  require?: boolean;
  log?: (line: string) => void;
}): Promise<{ ok: boolean; gate: TrueManuscriptGate; exitCode: number }> {
  const log = opts?.log ?? ((line: string) => console.log(line));
  const require =
    opts?.require === true ||
    ["1", "true", "yes"].includes(
      (process.env.LAWMIND_REQUIRE_TRUE_MANUSCRIPT ?? "").trim().toLowerCase(),
    );
  const gate = inspectTrueManuscriptGate(opts?.repoRoot);
  log(formatTrueManuscriptGateReport(gate));
  if (!gate.present) {
    return { ok: !require, gate, exitCode: require ? 1 : 0 };
  }
  let failed = 0;
  for (const name of gate.files) {
    const shape = await inspectTrueManuscriptFileShape(path.join(gate.dir, name));
    if (!shape.ok) {
      log(`FAIL: ${name}: ${shape.reason ?? "形态检查失败"}`);
      failed += 1;
    } else {
      log(`OK: ${name}${shape.textChars != null ? ` (${shape.textChars} chars)` : ""}`);
    }
  }
  for (const baseline of loadTrueManuscriptBaselines(gate.dir)) {
    const r = await compareTrueManuscriptAgainstBaseline(gate.dir, baseline);
    if (!r.ok) {
      log(`FAIL baseline: ${baseline.file}: ${r.reason ?? "未通过"}`);
      failed += 1;
    } else {
      log(`OK baseline: ${baseline.file}`);
    }
  }
  if (failed > 0) {
    return { ok: false, gate, exitCode: 1 };
  }
  log("true-manuscript gate pass");
  return { ok: true, gate, exitCode: 0 };
}

export type TrueManuscriptFileShape = {
  name: string;
  kind: "docx" | "doc" | "pdf" | "unknown";
  ok: boolean;
  textChars?: number;
  text?: string;
  reason?: string;
};

function kindFromName(name: string): TrueManuscriptFileShape["kind"] {
  if (/\.docx$/i.test(name)) {
    return "docx";
  }
  if (/\.doc$/i.test(name)) {
    return "doc";
  }
  if (/\.pdf$/i.test(name)) {
    return "pdf";
  }
  return "unknown";
}

/** Shape check only — not a panrui/copilot compare, and not an NDA-markdown stand-in. */
export async function inspectTrueManuscriptFileShape(
  filePath: string,
): Promise<TrueManuscriptFileShape> {
  const name = path.basename(filePath);
  const kind = kindFromName(name);
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    return {
      name,
      kind,
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
  if (kind === "pdf") {
    const ok = buf.subarray(0, 5).toString("latin1") === "%PDF-";
    return ok ? { name, kind, ok: true } : { name, kind, ok: false, reason: "不是 PDF 文件头" };
  }
  if (kind === "doc") {
    const ole = buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    return ole
      ? { name, kind, ok: true }
      : { name, kind, ok: false, reason: "不是 Word .doc 复合文档头" };
  }
  if (kind !== "docx") {
    return { name, kind, ok: false, reason: "不是 .docx/.doc/.pdf" };
  }
  if (buf.subarray(0, 2).toString("latin1") !== "PK") {
    return { name, kind, ok: false, reason: "不是 OOXML（疑似把 markdown 改名为 .docx）" };
  }
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")?.async("string");
    if (!docXml) {
      return { name, kind, ok: false, reason: "docx 缺少 word/document.xml" };
    }
    const text = docXml
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
    if (text.length < 20) {
      return { name, kind, ok: false, reason: "抽取正文过短，不像真稿", textChars: text.length };
    }
    return { name, kind, ok: true, textChars: text.length, text };
  } catch {
    return { name, kind, ok: false, reason: "无法作为 Word OOXML 打开" };
  }
}

export type TrueManuscriptBaseline = {
  file: string;
  minTextChars?: number;
  mustContain?: string[];
  kind?: "contract" | "complaint" | "other";
};

export function loadTrueManuscriptBaselines(dir: string): TrueManuscriptBaseline[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: TrueManuscriptBaseline[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".baseline.json") || name.startsWith(".")) {
      continue;
    }
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8"),
      ) as TrueManuscriptBaseline;
      if (typeof raw.file === "string" && raw.file.trim()) {
        out.push(raw);
      }
    } catch {
      /* skip malformed sidecar */
    }
  }
  return out;
}

export async function compareTrueManuscriptAgainstBaseline(
  dir: string,
  baseline: TrueManuscriptBaseline,
): Promise<{ ok: boolean; reason?: string }> {
  const filePath = path.join(dir, baseline.file);
  const shape = await inspectTrueManuscriptFileShape(filePath);
  if (!shape.ok) {
    return { ok: false, reason: shape.reason ?? `${baseline.file} 形态检查失败` };
  }
  if (baseline.minTextChars && (shape.textChars ?? 0) < baseline.minTextChars) {
    return {
      ok: false,
      reason: `${baseline.file} 抽取 ${shape.textChars ?? 0} 字，少于基线 ${baseline.minTextChars}`,
    };
  }
  const hay = shape.text ?? "";
  for (const needle of baseline.mustContain ?? []) {
    if (needle && !hay.includes(needle)) {
      return { ok: false, reason: `${baseline.file} 未包含基线短语「${needle}」` };
    }
  }
  return { ok: true };
}
