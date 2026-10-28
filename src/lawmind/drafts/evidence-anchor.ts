/**
 * 证据锚闸门：路径 + 内容指纹 + 定位符 + 原文 quote。
 *
 * 对照 MeWork `ValidateFileReferences`（合法吸收规格，不拷实现）：
 * 仅 `PASSED` 可作出稿终态；`FAILED` 修正后重试；`INCOMPLETE` 不得视为通过。
 */

import path from "node:path";
import { fileVersionOf } from "../runtime/file-version.js";
import { fenceAgentFilePath } from "../runtime/workspace-io-fence.js";
import {
  formatEvidenceLocator,
  locatorNeedsRichParser,
  locatorPlainTextLineRange,
  parseEvidenceLocator,
  type EvidenceLocator,
} from "./evidence-locator.js";
import {
  checkEvidenceSupport,
  checkEvidenceSupportAsync,
  type EvidenceSupport,
} from "./evidence-support.js";

export {
  formatEvidenceLocator,
  parseEvidenceLocator,
  splitPathAndLocator,
  type EvidenceLocator,
} from "./evidence-locator.js";

const SHA256_RE = /^[0-9a-f]{64}$/;

/** Pull the content sha256 hex out of `fileVersionOf` (`size:mtimeMs:hex`). */
export function contentSha256FromFileVersion(version: string | undefined): string | undefined {
  if (!version) {
    return undefined;
  }
  const hex = version.split(":").at(-1)?.trim() ?? "";
  return SHA256_RE.test(hex) ? hex : undefined;
}

export type FileReferenceSource = {
  path: string;
  /** Lowercase hex sha256 of file bytes (MeWork contentSha256). */
  contentSha256: string;
};

export type FileReference = {
  id: string;
  filePath: string;
  /** MeWork-style lineRef (`L3`, `P2`, `S1!A1`, …). */
  lineRef: string;
  text: string;
};

export type FileReferenceIssueCode =
  | "missing_source"
  | "bad_line_ref"
  | "sha_mismatch"
  | "missing_file"
  | "quote_mismatch"
  | "unverifiable_locator"
  | "incomplete";

export type FileReferenceIssue = {
  id: string;
  code: FileReferenceIssueCode;
  reasonZh: string;
};

export type ValidateFileReferencesStatus = "PASSED" | "FAILED" | "INCOMPLETE";

export type ValidateFileReferencesResult = {
  status: ValidateFileReferencesStatus;
  summary: { total: number; passed: number; failed: number; incomplete: number };
  /** Empty when status is PASSED. */
  issues: FileReferenceIssue[];
};

function isPlainTextRel(rel: string): boolean {
  return /\.(md|txt|markdown|csv|json)$/i.test(rel);
}

type PreparedReference = {
  id: string;
  filePath: string;
  lineRef: string;
  text: string;
  locator: EvidenceLocator;
  version: string;
};

type ReferenceFailure = {
  ok: false;
  issue: FileReferenceIssue;
  bucket: "failed" | "incomplete";
};

function buildSourceMap(sourceFiles: readonly FileReferenceSource[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const src of sourceFiles) {
    const p = src.path.trim().replace(/^\.?\//, "");
    const sha = src.contentSha256.trim().toLowerCase();
    if (p && SHA256_RE.test(sha)) {
      sources.set(p, sha);
    }
  }
  return sources;
}

function prepareReference(
  ref: FileReference,
  sources: Map<string, string>,
  rootDir: string,
): { ok: true; value: PreparedReference } | ReferenceFailure {
  const id = ref.id.trim() || "(missing-id)";
  const filePath = ref.filePath.trim().replace(/^\.?\//, "");
  const lineRef = ref.lineRef.trim();
  const text = ref.text.trim();

  if (!filePath || !sources.has(filePath)) {
    return {
      ok: false,
      bucket: "failed",
      issue: {
        id,
        code: "missing_source",
        reasonZh: `引用 ${id} 缺少已登记的来源指纹（path + contentSha256）。`,
      },
    };
  }
  if (!text) {
    return {
      ok: false,
      bucket: "incomplete",
      issue: {
        id,
        code: "incomplete",
        reasonZh: `引用 ${id} 未提供原文 quote，无法核对内容。`,
      },
    };
  }
  const locator = parseEvidenceLocator(lineRef);
  if (!locator) {
    return {
      ok: false,
      bucket: "failed",
      issue: {
        id,
        code: "bad_line_ref",
        reasonZh: `引用 ${id} 的 lineRef「${lineRef}」无法解析（支持 L/P/S!）。`,
      },
    };
  }
  const expectedSha = sources.get(filePath)!;
  const root = path.resolve(rootDir);
  const fenced = fenceAgentFilePath({ rootDir: root, abs: path.resolve(root, filePath) });
  if (!fenced.ok) {
    return {
      ok: false,
      bucket: "failed",
      issue: { id, code: "missing_file", reasonZh: fenced.error },
    };
  }
  const version = fileVersionOf(fenced.abs);
  const actualSha = contentSha256FromFileVersion(version);
  if (!version || !actualSha) {
    return {
      ok: false,
      bucket: "failed",
      issue: {
        id,
        code: "missing_file",
        reasonZh: `来源文件不存在或无法读取：${filePath}`,
      },
    };
  }
  if (actualSha !== expectedSha) {
    return {
      ok: false,
      bucket: "failed",
      issue: {
        id,
        code: "sha_mismatch",
        reasonZh: `来源 ${filePath} 在引用后被改过（内容指纹不一致）。`,
      },
    };
  }
  return { ok: true, value: { id, filePath, lineRef, text, locator, version } };
}

type SupportClassification =
  | { passed: true }
  | { passed: false; issue: FileReferenceIssue; bucket: "failed" | "incomplete" };

function classifySupport(id: string, support: EvidenceSupport): SupportClassification {
  if (support.status === "supported") {
    return { passed: true };
  }
  if (support.status === "unverifiable") {
    return {
      passed: false,
      bucket: "incomplete",
      issue: { id, code: "incomplete", reasonZh: support.reasonZh },
    };
  }
  return {
    passed: false,
    bucket: "failed",
    issue: {
      id,
      code: support.status === "stale" ? "sha_mismatch" : "quote_mismatch",
      reasonZh: support.reasonZh,
    },
  };
}

function finalize(
  total: number,
  passed: number,
  failed: number,
  incomplete: number,
  issues: FileReferenceIssue[],
): ValidateFileReferencesResult {
  let status: ValidateFileReferencesStatus = "PASSED";
  if (failed > 0) {
    status = "FAILED";
  } else if (incomplete > 0 || total === 0 || passed < total) {
    status = "INCOMPLETE";
  }
  return {
    status,
    summary: { total, passed, failed, incomplete },
    issues: status === "PASSED" ? [] : issues,
  };
}

/**
 * MeWork-shaped gate: every reference must have a declared source fingerprint
 * and a parseable locator; quote checks run when the format is locally readable.
 *
 * 同步版对 PDF 页 / Excel 单元格保持 `INCOMPLETE`；需要真正核对时用
 * `validateFileReferencesAsync`。
 */
export function validateFileReferences(input: {
  rootDir: string;
  sourceFiles: readonly FileReferenceSource[];
  references: readonly FileReference[];
}): ValidateFileReferencesResult {
  const sources = buildSourceMap(input.sourceFiles);
  const issues: FileReferenceIssue[] = [];
  let passed = 0;
  let failed = 0;
  let incomplete = 0;
  const push = (issue: FileReferenceIssue, bucket: "failed" | "incomplete"): void => {
    issues.push(issue);
    if (bucket === "failed") {
      failed += 1;
    } else {
      incomplete += 1;
    }
  };

  for (const ref of input.references) {
    const prepared = prepareReference(ref, sources, input.rootDir);
    if (!prepared.ok) {
      push(prepared.issue, prepared.bucket);
      continue;
    }
    const { id, filePath, locator, text, version } = prepared.value;
    if (locatorNeedsRichParser(locator)) {
      push(
        {
          id,
          code: "unverifiable_locator",
          reasonZh: `引用 ${id} 的定位 ${formatEvidenceLocator(locator)} 需要专用解析器，本次未完成核对。`,
        },
        "incomplete",
      );
      continue;
    }
    if (!isPlainTextRel(filePath)) {
      push(
        {
          id,
          code: "unverifiable_locator",
          reasonZh: `引用 ${id} 指向非纯文本文件，行级核对未就绪。`,
        },
        "incomplete",
      );
      continue;
    }
    const range = locatorPlainTextLineRange(locator);
    if (!range) {
      push(
        {
          id,
          code: "unverifiable_locator",
          reasonZh: `引用 ${id} 无法映射到可核对行区间。`,
        },
        "incomplete",
      );
      continue;
    }
    const lineRefForSupport =
      range.start === range.end ? `L${range.start}` : `L${range.start}-L${range.end}`;
    const support = checkEvidenceSupport({
      rootDir: input.rootDir,
      relPath: `${filePath}#${lineRefForSupport}`,
      quote: text,
      expectedVersion: version,
    });
    const classified = classifySupport(id, support);
    if (classified.passed) {
      passed += 1;
    } else {
      push(classified.issue, classified.bucket);
    }
  }

  return finalize(input.references.length, passed, failed, incomplete, issues);
}

/**
 * 异步版：PDF 页码与 Excel 单元格/范围会真正读取原文再核对；
 * 读不出来（扫描件、加密、范围过大、公式无缓存）仍记 `INCOMPLETE`。
 */
export async function validateFileReferencesAsync(input: {
  rootDir: string;
  sourceFiles: readonly FileReferenceSource[];
  references: readonly FileReference[];
}): Promise<ValidateFileReferencesResult> {
  const sources = buildSourceMap(input.sourceFiles);
  const issues: FileReferenceIssue[] = [];
  let passed = 0;
  let failed = 0;
  let incomplete = 0;
  const push = (issue: FileReferenceIssue, bucket: "failed" | "incomplete"): void => {
    issues.push(issue);
    if (bucket === "failed") {
      failed += 1;
    } else {
      incomplete += 1;
    }
  };

  for (const ref of input.references) {
    const prepared = prepareReference(ref, sources, input.rootDir);
    if (!prepared.ok) {
      push(prepared.issue, prepared.bucket);
      continue;
    }
    const { id, filePath, lineRef, text, version } = prepared.value;
    const support = await checkEvidenceSupportAsync({
      rootDir: input.rootDir,
      relPath: `${filePath}#${lineRef}`,
      quote: text,
      expectedVersion: version,
    });
    const classified = classifySupport(id, support);
    if (classified.passed) {
      passed += 1;
    } else {
      push(classified.issue, classified.bucket);
    }
  }

  return finalize(input.references.length, passed, failed, incomplete, issues);
}

/** Export helper: only PASSED may ship a final deliverable. */
export function fileReferencesBlockExport(
  result: ValidateFileReferencesResult | null | undefined,
): boolean {
  if (!result) {
    return false;
  }
  return result.status !== "PASSED";
}
