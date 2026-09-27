/**
 * Contract redline craft — span-local surgical edits (not whole-sentence/paragraph rewrites).
 * Soft coaching complements hard span gate in surgical-span-gate.ts / apply_surgical_edits.
 */

import { MINIMAL_EDIT_MAX_UNCHANGED_RUN, MINIMAL_EDIT_RULE_LINE } from "./minimal-edit-script.js";
import { estimateChangedChars } from "./surgical-edit-gate.js";
import { commonAffixLength } from "./surgical-span-gate.js";

export { commonAffixLength };

/** Injected into agent context for contract tracked-edit work. */
export const CONTRACT_REDLINE_CRAFT_SKILL = [
  "# Skill · 合同审阅改稿手艺（Craft）",
  "",
  "你以资深诉讼/交易律师助手的标准审阅对方稿。落改纪律是**锚定最短替换**（surgical patch）。",
  "",
  "## 最小修改（硬约束 · 条数不限）",
  "1. **只标真正变动的字**：一处改动里，没动的字必须留在修订轨之外——同事要能逐处接受你的修改。",
  "2. **一句话里改几个字，就只改那几个字**：禁止整句删除再整句新增（哪怕只是句末加几个字）。",
  "3. **引擎会重算**：`apply_surgical_edits` 不照抄 find 的粒度，会把每处改成最短改动后落槌；一处输入可能落成多处。你仍应按最短写，减少无谓拆分。",
  "4. **长度不是罪名**：整句确实换成另一句、两侧没有任何共有片段时，那本身就是一处合法改动。",
  "5. **自查，不是字数上限**：find 里若夹着没动的字，拆开再交。含句读时优先锚住改动旁边的短原文（正例：`实际损失。`→`实际损失，但累计…。`）。整句确实换成另一句时照交，引擎会落槌，不要为了凑短而少改。",
  "   - 不要把多个句末标点包进同一个 find（那是整段）",
  "6. **全文可有非常多处修改**：不设改点条数上限；每一处都必须最短锚定。",
  "7. **正例**：`甲方所在地人民法院`→`上海仲裁委员会`；`十日内`→`五个工作日内`（共有的「日内」不标）。",
  "8. **反例**：把「并赔偿甲方因此而造成的实际损失。」整句删掉再加新句——应只动真正变动的字。",
  "",
  "## 原则",
  "1. **先通读再动手**：全文 + 邮件要求 + 批注/对方修订痕迹，形成争点清单后再改。",
  "2. **必要性**：只改对己方实质风险、立场或邮件要求真正必要的点。",
  "3. **覆盖完整**：已判定实质必要的点，应处理或明确缓办并写明理由——不要无声漏掉。",
  "4. **缓办诚实**：立场不明、需客户拍板、或无法用精确原文定位时，写入 `craft_check.deferred`，勿瞎改。",
  "",
  "## 工作流",
  "1. 列出实质争点（来源：邮件 / 批注 / 对方修订 / 风险扫描）。",
  "2. 逐项决定：落改 | 缓办+理由。",
  "3. 落改用 `apply_surgical_edits`：每组 find=最短锚定；被硬门禁跳过的条收窄后重交。",
  "4. `craft_check` 只填 `deferred`（缓办+理由），不要给自己打覆盖率。交卷时独立审稿员只看 hunk/清单/引用证据。",
  "5. 再 `render_tracked_draft`。审稿未过会把缺口作为工具结果打回；按缺口补改，不要改审稿措辞。",
  "",
  "## 缓办（写入 craft_check.deferred）",
  "- 立场不明、需客户拍板、或无法用精确原文定位时写入 deferred，勿瞎改。",
  "- 覆盖是否完整由交卷审稿员根据证据判断，不看写者自评。",
  "",
  "空修订不得导出。未最小化的改动会被引擎自动拆分（不接受整句删写）。",
  MINIMAL_EDIT_RULE_LINE,
  `判定门槛与引擎常量一致：一处改动内若夹了 ≥${MINIMAL_EDIT_MAX_UNCHANGED_RUN} 个连续未改文字，即自动拆分。同一 find 在正文里出现多次时，缺省整条跳过；统一替换传 occurrences: "all"。`,
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
        "未附 craft_check。请在同一调用中附 deferred（无缓办则 []）后重交；缺失会作为工具错误打回，本回合不得结束。",
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
