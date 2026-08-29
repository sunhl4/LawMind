/**
 * Lawyer-authored Word-revision checklists — inject into the existing
 * tracked-export turn. Not a second pipeline. Items are 看/改/停, not mandatory rewrites.
 */

import fs from "node:fs";
import path from "node:path";
import type { ComposeContextPin } from "./compose-context-pin.js";
import { WORD_REVISION_PACKS } from "./word-revision-packs.js";

export const WORD_REVISION_FAMILY_IDS = [
  "equity",
  "ma",
  "procurement",
  "construction",
  "tech",
  "loan",
  "lease",
  "employment",
  "charter",
] as const;
export type WordRevisionFamilyId = (typeof WORD_REVISION_FAMILY_IDS)[number];

export const WORD_REVISION_STANCES = ["甲方", "乙方", "中立"] as const;
export type WordRevisionStance = (typeof WORD_REVISION_STANCES)[number];

export type WordRevisionChecklistItem = {
  id: string;
  look: string;
  editA: string;
  editB: string;
  stop: string;
  lens: string;
};

export type WordRevisionPack = {
  id: WordRevisionFamilyId;
  label: string;
  aliases: string[];
  items: WordRevisionChecklistItem[];
};

export type WordRevisionFieldSource = "explicit" | "hint" | "inferred" | "none";

export type WordRevisionChecklistResolution = {
  family?: WordRevisionFamilyId;
  familyLabel?: string;
  familySource: WordRevisionFieldSource;
  stance?: WordRevisionStance;
  stanceSource: WordRevisionFieldSource;
};

export const WORD_REVISION_FAMILY_LABEL: Record<WordRevisionFamilyId, string> = {
  equity: "股权融资",
  ma: "股权并购",
  procurement: "采购供货",
  construction: "建设工程",
  tech: "技术与许可",
  loan: "借款担保",
  lease: "房屋租赁",
  employment: "人事用工",
  charter: "公司章程",
};

const WORD_REVISION_FAMILY_ROLE_NOTE: Record<WordRevisionFamilyId, string> = {
  equity: "甲方侧按投资人常见诉求写，乙方侧按公司/创始人。抬头相反则对调或缓办。",
  ma: "甲方侧按受让方常见诉求写，乙方侧按转让方。抬头相反则对调或缓办。",
  procurement: "甲方侧按买方常见诉求写，乙方侧按卖方。抬头相反则对调或缓办。",
  construction: "甲方侧按发包人常见诉求写，乙方侧按承包人。抬头相反则对调或缓办。",
  tech: "甲方侧按委托方/被许可方常见诉求写，乙方侧按开发方/许可方。抬头相反则对调或缓办。",
  loan: "甲方侧按出借人/债权人常见诉求写，乙方侧按借款人/担保人。抬头相反则对调或缓办。",
  lease: "甲方侧按出租人常见诉求写，乙方侧按承租人。抬头相反则对调或缓办。",
  employment: "甲方侧按用人单位常见诉求写，乙方侧按劳动者。抬头相反则对调或缓办。",
  charter: "甲方侧按控股股东/发起方常见诉求写，乙方侧按中小股东。抬头相反则对调或缓办。",
};

export const WORD_REVISION_AUTHORITY_NOTE =
  "口径：制定法与司法解释优先。NVCA 等行业示范、律所公开课只作比较，不替代中国法。透栏写的是规范依据，不是必须整段写入合同。";

export const WORD_REVISION_TYPE_LINE_RE = /^改稿类型：\s*(.+)$/m;
export const WORD_REVISION_STANCE_LINE_RE = /^己方立场：\s*(.+)$/m;

/** Bump when builtin packs change; stale workspace overlays merge in missing builtin items. */
export const WORD_REVISION_PACK_VERSION = 2;
const PACK_VERSION_RE = /<!--\s*word-revision-pack:v(\d+)\s*-->/;

const STANCE_EXPLICIT_RE = /己方立场：\s*(甲方|乙方|中立)/;
const STANCE_HINT_RE =
  /立场甲方|代表甲方|按甲方|我方为甲方|立场乙方|代表乙方|按乙方|我方为乙方|中立审查|中立立场/;

function builtinPacks(): Record<WordRevisionFamilyId, WordRevisionPack> {
  return WORD_REVISION_PACKS;
}

/** ASCII aliases (SHA/SPA/MSA/ESOP) match as tokens; substrings like SHANGHAI must not hit. */
function aliasMatches(text: string, alias: string): boolean {
  if (/^[A-Za-z]+$/.test(alias)) {
    return new RegExp(`(?<![A-Za-z])${alias}(?![A-Za-z])`, "i").test(text);
  }
  return text.includes(alias);
}

export function familyIdFromLabel(raw: string): WordRevisionFamilyId | undefined {
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  for (const id of WORD_REVISION_FAMILY_IDS) {
    if (t === id || t === WORD_REVISION_FAMILY_LABEL[id]) {
      return id;
    }
  }
  const packs = builtinPacks();
  for (const id of WORD_REVISION_FAMILY_IDS) {
    if (packs[id].aliases.some((a) => a === t || aliasMatches(t, a))) {
      return id;
    }
  }
  return undefined;
}

export function parseWordRevisionStance(raw: string): WordRevisionStance | undefined {
  const t = raw.trim();
  if (t === "甲方" || t === "乙方" || t === "中立") {
    return t;
  }
  if (/立场甲方|代表甲方|按甲方|我方为甲方/.test(t) && !/立场乙方|代表乙方/.test(t)) {
    return "甲方";
  }
  if (/立场乙方|代表乙方|按乙方|我方为乙方/.test(t) && !/立场甲方|代表甲方/.test(t)) {
    return "乙方";
  }
  if (/中立审查|中立立场|^中立$/.test(t)) {
    return "中立";
  }
  return undefined;
}

function haystackFromPins(pins?: ComposeContextPin[]): string {
  return (pins ?? [])
    .map((pin) => ("relPath" in pin && typeof pin.relPath === "string" ? pin.relPath : ""))
    .join("\n");
}

function countFamilyHits(text: string, pack: WordRevisionPack): number {
  let n = 0;
  for (const alias of pack.aliases) {
    if (alias.length >= 2 && aliasMatches(text, alias)) {
      n += 1;
    }
  }
  return n;
}

function uniqueFamilyWinner(text: string): WordRevisionFamilyId | undefined {
  const packs = builtinPacks();
  const scored = WORD_REVISION_FAMILY_IDS.map((id) => ({
    id,
    n: countFamilyHits(text, packs[id]),
  })).filter((row) => row.n > 0);
  scored.sort((a, b) => b.n - a.n);
  if (scored.length === 1 || (scored[0] && scored[1] && scored[0].n > scored[1].n)) {
    return scored[0]?.id;
  }
  return undefined;
}

export function resolveWordRevisionChecklist(input: {
  instruction: string;
  pins?: ComposeContextPin[];
  /** First pages of the pinned Word — used when the lawyer did not pick a type. */
  documentText?: string;
}): WordRevisionChecklistResolution {
  const instruction = input.instruction ?? "";
  const typeLine = instruction.match(WORD_REVISION_TYPE_LINE_RE)?.[1];
  const explicitFamily = typeLine ? familyIdFromLabel(typeLine) : undefined;
  const stanceLine = instruction.match(WORD_REVISION_STANCE_LINE_RE)?.[1];
  const explicitStance = stanceLine
    ? parseWordRevisionStance(stanceLine)
    : STANCE_EXPLICIT_RE.exec(instruction)
      ? parseWordRevisionStance(STANCE_EXPLICIT_RE.exec(instruction)?.[1] ?? "")
      : undefined;

  let hintedFamily: WordRevisionFamilyId | undefined;
  let inferredFamily: WordRevisionFamilyId | undefined;
  if (!explicitFamily) {
    const pathHay = `${instruction}\n${haystackFromPins(input.pins)}`;
    hintedFamily = uniqueFamilyWinner(pathHay);
    if (!hintedFamily && input.documentText?.trim()) {
      inferredFamily =
        uniqueFamilyWinner(input.documentText) ??
        uniqueFamilyWinner(`${pathHay}\n${input.documentText}`);
    }
  }

  let hintedStance: WordRevisionStance | undefined;
  if (!explicitStance && STANCE_HINT_RE.test(instruction)) {
    hintedStance = parseWordRevisionStance(instruction);
  }

  const family = explicitFamily ?? hintedFamily ?? inferredFamily;
  const stance = explicitStance ?? hintedStance;
  return {
    family,
    familyLabel: family ? WORD_REVISION_FAMILY_LABEL[family] : undefined,
    familySource: explicitFamily
      ? "explicit"
      : hintedFamily
        ? "hint"
        : inferredFamily
          ? "inferred"
          : "none",
    stance,
    stanceSource: explicitStance ? "explicit" : hintedStance ? "hint" : "none",
  };
}

export function readWordRevisionMarkers(text: string): {
  family?: WordRevisionFamilyId;
  stance?: WordRevisionStance;
} {
  const familyRaw = text.match(WORD_REVISION_TYPE_LINE_RE)?.[1];
  const stanceRaw = text.match(WORD_REVISION_STANCE_LINE_RE)?.[1];
  return {
    family: familyRaw ? familyIdFromLabel(familyRaw) : undefined,
    stance: stanceRaw ? parseWordRevisionStance(stanceRaw) : undefined,
  };
}

export function upsertWordRevisionMarkers(
  text: string,
  next: { family?: WordRevisionFamilyId | ""; stance?: WordRevisionStance | "" },
): string {
  const current = readWordRevisionMarkers(text);
  const family =
    next.family === undefined ? current.family : next.family === "" ? undefined : next.family;
  const stance =
    next.stance === undefined ? current.stance : next.stance === "" ? undefined : next.stance;
  const body = text
    .split("\n")
    .filter((line) => !line.startsWith("改稿类型：") && !line.startsWith("己方立场："))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const head = [
    family ? `改稿类型：${WORD_REVISION_FAMILY_LABEL[family]}` : "",
    stance ? `己方立场：${stance}` : "",
  ].filter(Boolean);
  return [...head, body].filter(Boolean).join("\n");
}

export function parseChecklistMarkdown(
  markdown: string,
  fallbackId: WordRevisionFamilyId,
): WordRevisionPack {
  const packs = builtinPacks();
  const base = packs[fallbackId];
  const items: WordRevisionChecklistItem[] = [];
  const sections = markdown.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const headerEnd = section.indexOf("\n");
    const header = (headerEnd >= 0 ? section.slice(0, headerEnd) : section).trim();
    const body = headerEnd >= 0 ? section.slice(headerEnd) : "";
    const id = header.split(/\s+/)[0]?.trim();
    if (!id || id.startsWith(".")) {
      continue;
    }
    const grab = (label: string): string => {
      const m = body.match(new RegExp(`^[\\t ]*-\\s*${label}：\\s*(.+)$`, "m"));
      return m?.[1]?.trim() ?? "";
    };
    items.push({
      id,
      look: grab("看"),
      editA: grab("改·甲方"),
      editB: grab("改·乙方"),
      stop: grab("停"),
      lens: grab("透"),
    });
  }
  return {
    ...base,
    items: items.filter((it) => it.look || it.stop),
  };
}

export function serializeChecklistMarkdown(pack: WordRevisionPack): string {
  const lines = [
    `# ${pack.label}`,
    `<!-- word-revision-pack:v${WORD_REVISION_PACK_VERSION} -->`,
    "",
    "律师可改本文件。每条是检查单，不是必须全改。停项未经客户确认不得改数字或商务条件。",
    "",
  ];
  for (const item of pack.items) {
    lines.push(`## ${item.id} ${item.look.slice(0, 16)}`);
    lines.push(`- 看：${item.look}`);
    lines.push(`- 改·甲方：${item.editA}`);
    lines.push(`- 改·乙方：${item.editB}`);
    lines.push(`- 停：${item.stop}`);
    lines.push(`- 透：${item.lens}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function loadWordRevisionPack(
  family: WordRevisionFamilyId,
  workspaceDir?: string,
): WordRevisionPack {
  const builtin = builtinPacks()[family];
  if (!workspaceDir) {
    return builtin;
  }
  const mdPath = path.join(workspaceDir, "playbooks", "word-revision", `${family}.md`);
  try {
    const raw = fs.readFileSync(mdPath, "utf8");
    const parsed = parseChecklistMarkdown(raw, family);
    if (parsed.items.length === 0) {
      return builtin;
    }
    const overlayVersion = Number(raw.match(PACK_VERSION_RE)?.[1] ?? "0");
    if (overlayVersion >= WORD_REVISION_PACK_VERSION) {
      return parsed;
    }
    // Stale overlay (e.g. lawyer forked an older wave): keep lawyer items, append new builtin ones.
    const seen = new Set(parsed.items.map((it) => it.id));
    return {
      ...parsed,
      items: [...parsed.items, ...builtin.items.filter((it) => !seen.has(it.id))],
    };
  } catch {
    /* builtin */
  }
  return builtin;
}

export function formatWordRevisionChecklistBlock(input: {
  instruction: string;
  pins?: ComposeContextPin[];
  workspaceDir?: string;
  documentText?: string;
  purpose?: "revise" | "review";
}): string {
  const purpose = input.purpose ?? "revise";
  const title = purpose === "review" ? "## 审查对照要点" : "## 改稿要点";
  const resolved = resolveWordRevisionChecklist(input);
  if (!resolved.family) {
    const stanceLine = resolved.stance
      ? `己方立场：${resolved.stance}（${resolved.stanceSource === "explicit" ? "律师选定" : "从指令推断"}）。未确认的数字仍缓办。`
      : "立场不明则写入 deferred，勿单边改商务条件。";
    if (purpose === "review") {
      return [
        title,
        "未识别合同类型。请先通读合同，按正文归纳审查要点，不要套用某一类预设清单。",
        stanceLine,
      ].join("\n");
    }
    return [
      title,
      "未识别合同类型。不要套用任何预设类型清单。",
      stanceLine,
      "按用户指令与必要性落改。",
    ].join("\n");
  }
  const pack = loadWordRevisionPack(resolved.family, input.workspaceDir);
  const head =
    resolved.familySource === "explicit"
      ? `律师选定「${pack.label}」。按下列检查单处理：能落改则最短锚定；停项不得改；不对题的条目忽略并缓办。`
      : resolved.familySource === "inferred"
        ? `律师未点选类型。按合同正文判断为「${pack.label}」，已套该类要点。正文不对题则忽略该条，勿按错类强改。`
        : `律师未点选类型。按文件名或指令判断为「${pack.label}」，已套该类要点。正文不对题则忽略该条，勿按错类强改。`;
  const stanceNote =
    resolved.stanceSource === "none"
      ? "立场未确认：两侧「改」都列出，能确定的才落改，其余缓办。"
      : resolved.stance === "中立"
        ? "中立：以「看」和「停」为主，不单边落改，争点写入 deferred。"
        : `己方立场：${resolved.stance}（${resolved.stanceSource === "explicit" ? "律师选定" : "从指令推断"}）。只按该侧「改」落改。`;

  const reviewNote =
    purpose === "review" ? "本回合是审查意见：下列要点用于对照写意见，不是必须逐条改合同。" : "";

  const lines = [
    title,
    head,
    ...(reviewNote ? [reviewNote] : []),
    stanceNote,
    WORD_REVISION_FAMILY_ROLE_NOTE[resolved.family],
    WORD_REVISION_AUTHORITY_NOTE,
    "",
  ];
  for (const item of pack.items) {
    lines.push(`### ${item.id}`);
    lines.push(`- 看：${item.look}`);
    if (resolved.stance === "甲方") {
      lines.push(`- 改：${item.editA}`);
    } else if (resolved.stance === "乙方") {
      lines.push(`- 改：${item.editB}`);
    } else if (resolved.stance === "中立") {
      lines.push(`- 对照：甲方侧 ${item.editA} ／ 乙方侧 ${item.editB}`);
    } else {
      lines.push(`- 改·甲方：${item.editA}`);
      lines.push(`- 改·乙方：${item.editB}`);
    }
    lines.push(`- 停：${item.stop}`);
    lines.push(`- 透：${item.lens}`);
    lines.push("");
  }
  lines.push(
    "纪律：检查单不是必须全改。必要性优先。停项与未经确认的数字写入 craft_check.deferred。不要读 playbooks/ 文件。",
  );
  return lines.join("\n");
}
