/**
 * Contract redline craft — span-local surgical edits (not whole-sentence/paragraph rewrites).
 * Soft coaching complements hard span gate in surgical-span-gate.ts / apply_surgical_edits.
 */

import { estimateChangedChars } from "./surgical-edit-gate.js";
import {
  commonAffixLength,
  SURGICAL_MAX_FIND_CHARS,
  SURGICAL_MAX_FIND_WITH_TERMINATOR,
} from "./surgical-span-gate.js";

export { commonAffixLength };

/** Injected into agent context for contract tracked-edit work. */
export const CONTRACT_REDLINE_CRAFT_SKILL = [
  "# Skill · 合同审阅改稿手艺（Craft）",
  "",
  "你以资深诉讼/交易律师助手的标准审阅对方稿。落改纪律是**锚定最短替换**（surgical patch）。",
  "",
  "## 最小修改（跨度硬门禁 · 条数不限）",
  "1. **能改几个字就只改几个字**：`find` 只锚定必须改的字/词/短短语，禁止整句删除再重写。",
  "2. **段内有问题只改有问题的句子**：禁止整段 `find`；一段多争点 → 多组最短替换。",
  "3. **硬门禁（`apply_surgical_edits` 会拒绝/跳过违规条）**：",
  `   - 含句读（。！？；）的 find ≤ ${SURGICAL_MAX_FIND_WITH_TERMINATOR} 字（正例句末加词：\`实际损失。\`→\`实际损失，但累计…。\`）`,
  `   - 无句读的 find ≤ ${SURGICAL_MAX_FIND_CHARS} 字`,
  "   - 禁止 find 含多个句末标点（整段）",
  "4. **全文可有非常多处修改**：不设改点条数上限；每一处都必须最短锚定。",
  "5. **正例**：`甲方所在地人民法院`→`上海仲裁委员会`；`胜诉方`→`胜裁方`。",
  "6. **反例**：整句「并赔偿甲方因此而造成的实际损失。」整句替换加上限——应改为只锚定 `实际损失。`。",
  "",
  "## 原则",
  "1. **先通读再动手**：全文 + 邮件要求 + 批注/对方修订痕迹，形成争点清单后再改。",
  "2. **必要性**：只改对己方实质风险、立场或邮件要求真正必要的点。",
  "3. **覆盖完整**：已判定实质必要的点，应处理或明确缓办并写明理由——不要无声漏掉。",
  "4. **缓办诚实**：立场不明、需客户拍板、或无法用精确原文定位时，写入 summary 的 deferred，勿瞎改。",
  "",
  "## 工作流",
  "1. 列出实质争点（来源：邮件 / 批注 / 对方修订 / 风险扫描）。",
  "2. 逐项决定：落改 | 缓办+理由。",
  "3. 落改用 `apply_surgical_edits`：每组 find=最短锚定；被硬门禁跳过的条收窄后重交。",
  "4. 调用时附上 `craft_check`（自评），再 `render_tracked_draft`。",
  "",
  "## 自评量规（写入 craft_check / summary）",
  "- **coverage**：实质争点是否均已落改或缓办说明？",
  "- **restraint**：是否每处都守住字/词级跨度？",
  "- **fidelity**：是否保留句内未改文字？",
  "- **trace**：每处改动能否回溯到邮件、批注或明确风险？",
  "",
  "空修订不得导出；跨度违规不得落改。",
].join("\n");

export type SurgicalCraftSignal = {
  level: "info" | "warn";
  code: string;
  message: string;
  findPreview?: string;
};

export type CraftCheckInput = {
  coverage?: string;
  restraint?: string;
  deferred?: Array<{ issue?: string; reason?: string }>;
  notes?: string;
};

function sentenceTerminatorCount(text: string): number {
  return (text.match(/[。！？]/g) ?? []).length;
}

/**
 * Soft craft signals for borderline spans that still pass the hard gate.
 */
export function craftSignalsForEdit(find: string, replace: string): SurgicalCraftSignal[] {
  const signals: SurgicalCraftSignal[] = [];
  if (!find || find === replace) {
    return signals;
  }

  const terminators = sentenceTerminatorCount(find);
  if (terminators >= 1 || /[；]/.test(find)) {
    signals.push({
      level: "warn",
      code: "wide_span_sentence",
      message: "find 含句读。若还能再短，请继续收窄到争点字词（硬门禁已限制含句读 find 长度）。",
      findPreview: find.slice(0, 36),
    });
  }

  if ((find.match(/[，、]/g) ?? []).length >= 2 && terminators === 0) {
    signals.push({
      level: "warn",
      code: "wide_span_clause",
      message: "find 跨多处分句，请确认是否可用更短片段达到同一法律效果。",
      findPreview: find.slice(0, 36),
    });
  }

  const delta = estimateChangedChars(find, replace);
  if (delta > 40) {
    signals.push({
      level: "warn",
      code: "large_delta",
      message: `本条改动幅度较大（Δ≈${delta}）；确认 find 已是最短锚定。`,
      findPreview: find.slice(0, 36),
    });
  }

  const minLen = Math.min(find.length, replace.length);
  if (minLen >= 16) {
    const { prefix, suffix } = commonAffixLength(find, replace);
    const retained = prefix + suffix;
    if (retained / minLen < 0.35) {
      signals.push({
        level: "warn",
        code: "low_retention",
        message: "find/replace 共用原文较少；若可保留骨架只换争点词更佳。",
        findPreview: find.slice(0, 36),
      });
    }
  }
  return signals;
}

export function evaluateCraftCheck(check: CraftCheckInput | undefined): SurgicalCraftSignal[] {
  const signals: SurgicalCraftSignal[] = [];
  if (!check) {
    signals.push({
      level: "info",
      code: "craft_check_missing",
      message:
        "未附 craft_check。建议补充 coverage/restraint/deferred（不阻断已通过硬门禁的落改）。",
    });
    return signals;
  }
  const deferred = Array.isArray(check.deferred) ? check.deferred : [];
  const coverage = (check.coverage ?? "").toLowerCase();
  if (/partial|部分|未完|incomplete/.test(coverage) && deferred.length === 0) {
    signals.push({
      level: "warn",
      code: "partial_without_deferral",
      message: "coverage 显示未完成，但 deferred 为空——请补缓办理由，或继续落改实质争点。",
    });
  }
  return signals;
}

export function parseCraftCheckInput(value: unknown): CraftCheckInput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  const deferredRaw = Array.isArray(rec.deferred) ? rec.deferred : undefined;
  const deferred = deferredRaw?.map((item) => {
    if (!item || typeof item !== "object") {
      return {};
    }
    const row = item as Record<string, unknown>;
    return {
      ...(typeof row.issue === "string" ? { issue: row.issue } : {}),
      ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
    };
  });
  return {
    ...(typeof rec.coverage === "string" ? { coverage: rec.coverage } : {}),
    ...(typeof rec.restraint === "string" ? { restraint: rec.restraint } : {}),
    ...(typeof rec.notes === "string" ? { notes: rec.notes } : {}),
    ...(deferred ? { deferred } : {}),
  };
}
