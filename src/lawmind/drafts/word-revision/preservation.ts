/**
 * 原有修订不许在交付物里消失。
 *
 * 律师拿到的回稿、对方发来的红线稿，里面的 w:ins / w:del 是证据。
 * 任何一次转换或落改（.doc→.docx、另存、我们叠加修订、格式统一）都不得
 * 让这些修订条目消失或变形。本模块只做「对账」，不改文件。
 *
 * 硬判据：id + 作者 + 文本。日期单独作为软提示——Word 另存时偶尔会重写时间戳，
 * 那不算篡改修订内容。
 */

export type RevisionKind = "ins" | "del" | "moveFrom" | "moveTo" | "format";

export type RevisionFingerprint = {
  id: string;
  kind: RevisionKind;
  author: string;
  date?: string;
  text: string;
};

export type RevisionAlteration = {
  id: string;
  before: RevisionFingerprint;
  after: RevisionFingerprint;
  fields: Array<"kind" | "author" | "text" | "date">;
};

export type RevisionPreservation = {
  ok: boolean;
  /** 交付物里再也找不到的原有修订（硬失败：等于把别人的修订删了）。 */
  missing: RevisionFingerprint[];
  /** 硬失败：作者/类型被改，或 `w:del` 的原文被重写。 */
  altered: RevisionAlteration[];
  /**
   * 软提示：`w:ins` 的文字变了。Word 里删改别人插入的内容时，插入 id 不变、
   * 文字就变了——那是律师的正常动作，不算丢修订。`missing` 仍然会拦住。
   */
  alteredInsertions: RevisionAlteration[];
  /**
   * 软提示：内容一模一样、只是 `w:id` 换了。有些写入器（officecli / Word 另存）
   * 会重编号既有修订；按 id 判会误拦整份合法交付物，所以单列出来只提示。
   */
  renumbered: Array<{ before: RevisionFingerprint; after: RevisionFingerprint }>;
  /** 日期变了但内容没变：只提示，不判失败。 */
  dateOnlyChanges: string[];
  /** 新增的修订（我们叠加的、officecli 生成的）——正常，不算问题。 */
  added: RevisionFingerprint[];
  beforeCount: number;
  afterCount: number;
};

const TRACK_OPEN_RE = /<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange)\b([^>]*)>/g;

function attr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXml(match[1] ?? "") : undefined;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

function kindOfTag(tag: string): "ins" | "del" | "moveFrom" | "moveTo" | "format" | undefined {
  if (tag === "rPrChange" || tag === "pPrChange") {
    return "format";
  }
  return tag as "ins" | "del" | "moveFrom" | "moveTo";
}

/**
 * 收集文档里的修订条目。同一 id 的多个 run 合并成一条（Word 会把一条插入拆成多 run）。
 * 自闭合的空标记（`<w:ins …/>`，用于表格行/段落标记）也计入，文本为空。
 */
export function snapshotDocumentRevisions(xml: string): RevisionFingerprint[] {
  const out: RevisionFingerprint[] = [];
  const seen = new Map<string, RevisionFingerprint>();
  for (const match of xml.matchAll(TRACK_OPEN_RE)) {
    const kind = kindOfTag(match[1] ?? "");
    if (!kind) {
      continue;
    }
    const attrs = match[2] ?? "";
    const id = attr(attrs, "w:id");
    if (id == null) {
      continue;
    }
    const author = attr(attrs, "w:author") ?? "";
    const date = attr(attrs, "w:date");
    const openEnd = xml.indexOf(">", match.index ?? 0);
    const selfClosing = openEnd > 0 && xml[openEnd - 1] === "/";
    let inner = "";
    if (!selfClosing) {
      const closeAt = xml.indexOf(`</w:${match[1]}>`, openEnd + 1);
      inner = closeAt > openEnd ? xml.slice(openEnd + 1, closeAt) : "";
    }
    const text = stripTags(inner).replace(/\s+/g, " ").trim();
    const existing = seen.get(id);
    if (existing) {
      existing.text = `${existing.text}${text}`.trim();
      if (!existing.date && date) {
        existing.date = date;
      }
      continue;
    }
    const fingerprint: RevisionFingerprint = {
      id,
      kind,
      author,
      ...(date ? { date } : {}),
      text,
    };
    seen.set(id, fingerprint);
    out.push(fingerprint);
  }
  return out;
}

export function compareRevisionPreservation(
  before: readonly RevisionFingerprint[],
  after: readonly RevisionFingerprint[],
): RevisionPreservation {
  const afterById = new Map(after.map((item) => [item.id, item]));
  const beforeIds = new Set(before.map((item) => item.id));
  const missing: RevisionFingerprint[] = [];
  const altered: RevisionAlteration[] = [];
  const alteredInsertions: RevisionAlteration[] = [];
  const dateOnlyChanges: string[] = [];

  for (const item of before) {
    const now = afterById.get(item.id);
    if (!now) {
      missing.push(item);
      continue;
    }
    const fields: RevisionAlteration["fields"] = [];
    if (now.kind !== item.kind) {
      fields.push("kind");
    }
    if (now.author !== item.author) {
      fields.push("author");
    }
    if (now.text !== item.text) {
      fields.push("text");
    }
    if (fields.length > 0) {
      const onlyTextChanged = fields.length === 1 && fields[0] === "text";
      const alteration: RevisionAlteration = {
        id: item.id,
        before: item,
        after: now,
        fields,
      };
      if (onlyTextChanged && item.kind === "ins") {
        // 律师在别人插入的句子里改字（或我们按 hunk 落改）——Word 保留同一个 ins id。
        alteredInsertions.push(alteration);
      } else {
        altered.push(alteration);
      }
      continue;
    }
    if ((now.date ?? "") !== (item.date ?? "")) {
      dateOnlyChanges.push(item.id);
    }
  }

  const added = after.filter((item) => !beforeIds.has(item.id));
  // 重编号容忍：内容完全一样、只是 id 换了 → 属于「改写器重排了编号」，不是丢修订。
  const unmatchedAdded = [...added];
  const stillMissing: RevisionFingerprint[] = [];
  const renumbered: Array<{ before: RevisionFingerprint; after: RevisionFingerprint }> = [];
  for (const item of missing) {
    const at = unmatchedAdded.findIndex(
      (candidate) =>
        candidate.kind === item.kind &&
        candidate.author === item.author &&
        candidate.text === item.text,
    );
    const twin = at >= 0 ? unmatchedAdded.splice(at, 1)[0] : undefined;
    if (twin) {
      renumbered.push({ before: item, after: twin });
    } else {
      stillMissing.push(item);
    }
  }

  return {
    ok: stillMissing.length === 0 && altered.length === 0,
    missing: stillMissing,
    altered,
    alteredInsertions,
    renumbered,
    dateOnlyChanges,
    added,
    beforeCount: before.length,
    afterCount: after.length,
  };
}

function summarize(list: readonly RevisionFingerprint[], limit = 3): string {
  return list
    .slice(0, limit)
    .map((item) => `${item.author || "未署名"}「${item.text.slice(0, 20) || "（段落标记）"}」`)
    .join("、");
}

/** 给律师/模型看的一句话。绝不把「丢了修订」说成成功。 */
export function explainRevisionPreservation(result: RevisionPreservation): string | undefined {
  if (result.ok) {
    return undefined;
  }
  const parts: string[] = [];
  if (result.missing.length > 0) {
    parts.push(`原有修订有 ${result.missing.length} 条不见了（${summarize(result.missing)}）`);
  }
  if (result.altered.length > 0) {
    parts.push(
      `原有修订有 ${result.altered.length} 条被改动（${summarize(
        result.altered.map((a) => a.before),
      )}）`,
    );
  }
  return `${parts.join("；")}。这不是可交付的修订稿。`;
}

/** 软提示：别人插入的句子被改过字（Word 的正常行为），只说明，不拦交付。 */
export function describeInsertionEdits(
  result: RevisionPreservation,
  limit = 2,
): string | undefined {
  if (result.alteredInsertions.length === 0) {
    return undefined;
  }
  const samples = result.alteredInsertions
    .slice(0, limit)
    .map((item) => `${item.before.author || "未署名"}「${item.before.text.slice(0, 16)}」`)
    .join("、");
  return `另改动了 ${result.alteredInsertions.length} 处别人插入的句子（${samples}），修订条目仍在。`;
}

/** 软提示：内容没变，只是修订编号被重排（不影响交付）。 */
export function describeRenumbered(result: RevisionPreservation): string | undefined {
  if (result.renumbered.length === 0) {
    return undefined;
  }
  return `有 ${result.renumbered.length} 条原有修订只是编号变了（内容一致），按保留处理。`;
}

export const REVISION_PRESERVATION_FAILED_CODE = "revision_preservation_failed";
