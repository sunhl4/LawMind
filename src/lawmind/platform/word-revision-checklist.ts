/**
 * Lawyer-authored Word-revision checklists — inject into the existing
 * tracked-export turn. Not a second pipeline. Items are 看/改/停, not mandatory rewrites.
 *
 * Browser-safe surface: import from word-revision-core.ts (no node:fs).
 * This module adds workspace overlay I/O for the engine / local API.
 */

import fs from "node:fs";
import path from "node:path";
import type { ComposeContextPin } from "./compose-context-pin.js";
import {
  WORD_REVISION_AUTHORITY_NOTE,
  WORD_REVISION_FAMILY_ROLE_NOTE,
  WORD_REVISION_PACK_VERSION,
  loadBuiltinWordRevisionPack,
  parseChecklistMarkdown,
  resolveWordRevisionChecklist,
  type WordRevisionFamilyId,
  type WordRevisionPack,
} from "./word-revision-core.js";

export * from "./word-revision-core.js";

const PACK_VERSION_RE = /<!--\s*word-revision-pack:v(\d+)\s*-->/;

export function loadWordRevisionPack(
  family: WordRevisionFamilyId,
  workspaceDir?: string,
): WordRevisionPack {
  const builtin = loadBuiltinWordRevisionPack(family);
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
