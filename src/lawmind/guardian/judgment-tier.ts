/**
 * 检查单项判据分级（G0）——「谁来判断这一项」的唯一真相源。
 *
 * > **命名注意**：本文件与同域多数文件用美式拼写 `judgment-*`，而
 * > `delivery/judgement-ratchet.ts` 是英式 `judgement`（历史原因）。**grep 时两个拼写都要搜。**
 *
 * 背景：`GuardianChecklistItem` 此前只有 `{ id, look, edit, stop }`，没有「判定主体」这一栏。
 * 后果是**一个「有没有同时约定管辖与仲裁」的形式判断，和一个「这版措辞妥不妥」的裁量判断，
 * 走同一条最贵的路径**——都把项塞进提示词，由模型逐项下布尔。
 *
 * 本模块把判定主体显式化，分三级：
 *   - `machine`：答案由「正文 + 检索快照 + 门禁事实」确定性推出，由代码判，**不进提示词**。
 *   - `judge`  ：需要阅读语义，但判据可逐条枚举、且在证据包里能找到支撑痕迹，由模型逐项判。
 *   - `lawyer` ：涉及商业取舍 / 价值权衡 / 办案策略，**不同律师会给出不同答案**——不判，只升级。
 *
 * 三条 fail-closed 纪律（违反即回归，见 `judgment-tier.test.ts`）：
 *   1. 未显式声明 → 落 `judge`（**保守方向**：宁可多问模型，不可少判）。
 *   2. 声明 `machine` 但验证器不存在 / 未实现 → 降回 `judge` 并记 warning，**不得静默跳过**。
 *   3. `lawyer` 项**不得**出现在任何 machine 验证器里（主观项永不编译）。
 */

/** 判定主体。顺序即严格程度：machine < judge < lawyer。 */
export type JudgmentTier = "machine" | "judge" | "lawyer";

/**
 * G3：被移出提示词、需要律师定夺的主观项。
 *
 * 它存在的意义是**让「不判」有一个去处**。`lawyer` 项的定义是「不判，只升级」，
 * 但如果升级卡不存在，把它们移出提示词就等于**安静地丢掉**——
 * 那比继续问模型更糟（见 `policy/judgment-tiering.ts` 的 `isLawyerEscalationAvailable`）。
 */
export type JudgmentEscalationItem = {
  /** 判定表键。**不进程律师可见面**（UI 只显示 label / reason）。 */
  itemKey: string;
  /** 律师可读的定夺事项。 */
  label: string;
  /** 为什么必须由人判。 */
  reason: string;
};

export type ChecklistItemJudgment = {
  tier: JudgmentTier;
  /** `tier === "machine"` 时必填：machine registry 的验证器 id。 */
  verifier?: string;
  /** `tier === "lawyer"` 时必填：为什么必须由人判（**律师可见面文案**）。 */
  lawyerReason?: string;
  /** 定级依据（写给人看：为什么它不是模型判的 / 为什么它不能编译）。 */
  rationale: string;
};

/** 检查单项的来源。两类来源的 id 空间不同，必须区分。 */
export type ChecklistItemSource = "word_revision" | "verification";

/**
 * 判定表键。
 *
 * - `word_revision`：直接用条项 id（`eq.price` / `pr.pay` …）——这些 id 自带族前缀，全局唯一。
 * - `verification` ：`<specId>/<itemId>`——**必须带 specId**，因为 `citations`、`sources`
 *   在多个 spec 里重复出现，裸 id 有歧义（实测：`citations` 出现于 contract-review-v1 /
 *   learning-brief-v1 / general-v1，`sources` 出现于 compliance-dossier-v1 / training-ppt-v1）。
 */
export function wordRevisionKey(itemId: string): string {
  return itemId.trim();
}

export function verificationKey(specId: string, itemId: string): string {
  return `${specId.trim()}/${itemId.trim()}`;
}

/** 判定表：键 → 定级。全量表在 `item-judgments.ts`。 */
export type JudgmentTable = Readonly<Record<string, ChecklistItemJudgment>>;

export type ResolveJudgmentInput = {
  /** 判定表键（见 `wordRevisionKey` / `verificationKey`）。 */
  key: string;
  table: JudgmentTable;
  /** 该键对应的条目是否真的在清单里存在（调用方核对）。 */
  knownItem: boolean;
};

export type ResolveJudgmentResult = {
  key: string;
  judgment: ChecklistItemJudgment;
  /** 非空即代表本次定级被降级或有异常——调用方应把它记进审计/指标，不得丢弃。 */
  warnings: string[];
};

/**
 * 解析单项判定主体。**纯函数**，便于测试与审计复算。
 *
 * 降级规则（顺序即优先级）：
 *   1. 键不在表里 → `judge` + warning（新增条项忘了定级时，宁可多问模型）。
 *   2. 表里是 `machine` 但缺 `verifier` → `judge` + warning。
 *   3. 表里是 `lawyer` 但缺 `lawyerReason` → **保留 `lawyer`**（安全方向），但记 warning
 *      ——因为「不判」永远比「误判」安全，缺的是文案不是结论。
 */
export function resolveJudgmentTier(input: ResolveJudgmentInput): ResolveJudgmentResult {
  const warnings: string[] = [];
  const declared = input.table[input.key];

  if (!declared) {
    warnings.push(
      input.knownItem
        ? `条项「${input.key}」未在判定表中分级——已按 judge 处理。请在 item-judgments.ts 补一行。`
        : `条项「${input.key}」不在任何清单中——已按 judge 处理。若清单已删除该项，请从判定表移除。`,
    );
    return {
      key: input.key,
      judgment: {
        tier: "judge",
        rationale: "未分级：保守落 judge。",
      },
      warnings,
    };
  }

  if (declared.tier === "machine" && !declared.verifier?.trim()) {
    warnings.push(
      `条项「${input.key}」声明为 machine 但未给 verifier——已降回 judge。machine 项必须有可执行的确定性验证器。`,
    );
    return {
      key: input.key,
      judgment: { ...declared, tier: "judge" },
      warnings,
    };
  }

  if (declared.tier === "lawyer" && !declared.lawyerReason?.trim()) {
    warnings.push(
      `条项「${input.key}」为 lawyer 项但缺 lawyerReason——定级保留（不判比误判安全），请补律师可见的理由文案。`,
    );
  }

  return { key: input.key, judgment: declared, warnings };
}

/** 把判定表折成「项 → 判定主体」，供运行期与指标共用。 */
export function buildTierIndex(table: JudgmentTable): ReadonlyMap<string, JudgmentTier> {
  return new Map(Object.entries(table).map(([key, j]) => [key, j.tier]));
}

/** 主观项集合——machine 验证器**不得**覆盖其中任何一项。 */
export function lawyerOnlyKeys(table: JudgmentTable): ReadonlySet<string> {
  return new Set(
    Object.entries(table)
      .filter(([, j]) => j.tier === "lawyer")
      .map(([key]) => key),
  );
}

/** 按验证器 id 归拢 machine 项（供运行期跑验证器）。 */
export function machineItemsByVerifier(table: JudgmentTable): ReadonlyMap<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [key, j] of Object.entries(table)) {
    if (j.tier !== "machine" || !j.verifier) {
      continue;
    }
    const list = out.get(j.verifier) ?? [];
    list.push(key);
    out.set(j.verifier, list);
  }
  return out;
}
