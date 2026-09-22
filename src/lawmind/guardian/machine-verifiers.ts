/**
 * 机器验证器（G0）——把「本该由代码判的项」从 LLM 手里拿回来。
 *
 * 设计原则（全部是已有实现的**薄适配层**：零新依赖、零出网、零模型调用）：
 *   1. 验证器是**纯函数**：只读证据包与上下文，不写盘、不出网、不调模型。
 *   2. 验证器**不发明判据**——每个都指向既有 lint 规则 / 门禁字段 / 条款检查。
 *      `ruleIds` 就是"编译产物"：可读、可 diff、可回归。
 *   3. **fail-closed**：依赖的规则执行失败、输入畸形、验证器抛错 → `status: "unavailable"`，
 *      由聚合层判 fail —— **绝不返回 `supported: true`**。
 *      这条最容易漏，后果是「验证器坏了被当成通过」。
 *   4. 一个验证器只服务**一组同语义的条项**（`itemIds`）。规则集不同就必须拆开——
 *      否则「定金超限」会误伤「租赁期限」。
 *
 * 覆盖诚实：本文件只登记**有真实规则支撑**的项。没有规则支撑的项一律留 `judge`，
 * 不为了凑覆盖率发明规则（新规则要走 G4 的法律顾问验收）。
 */

import { runLegalLint } from "../lint/run-lint.js";
import type { LegalLintFinding, LegalLintReport } from "../lint/types.js";
import { verificationKey } from "./judgment-tier.js";
import type { GuardianEvidencePack } from "./types.js";

/** 超出证据包之外的上下文：正文与本次 lint 结果。 */
export type MachineVerifyContext = {
  /** 正文全文。**不进给模型的证据包**，只在 machine 段使用。 */
  documentText: string;
  deliverableType?: string;
  /** 本次 lint 结果（machine 段只跑一次，各验证器共享）。 */
  lintReport?: LegalLintReport;
  /** 检索图谱事实（来自 ReasoningSnapshot）。 */
  graphIssues?: ReadonlyArray<{
    issue: string;
    authorityIds: readonly string[];
    openQuestions: readonly string[];
  }>;
};

export type MachineVerdict = {
  /** 判定表键。 */
  itemId: string;
  supported: boolean;
  /** 律师可读的判定依据。**禁止工程师语言**。 */
  reason: string;
  /** 可追溯引用：确定性 finding 的 ruleId / 门禁字段名。 */
  evidenceRef?: string;
  /** 验证器自身可用性。`unavailable` 必须由聚合层 fail-closed。 */
  status: "ok" | "unavailable";
};

export type MachineVerifier = {
  id: string;
  /** 依赖的既有 lint 规则 id（可审计）。包证据类验证器为空数组。 */
  ruleIds: readonly string[];
  /** 本验证器负责的判定表键。**必须与判定表一致**（`machine-verifiers.test.ts` 断言）。 */
  itemIds: readonly string[];
  /** 返回 `itemIds` 中**每一项**的结论，数量与次序须与 `itemIds` 一致。 */
  run: (pack: GuardianEvidencePack, ctx: MachineVerifyContext) => MachineVerdict[];
};

function verdict(
  itemId: string,
  supported: boolean,
  reason: string,
  evidenceRef?: string,
  status: "ok" | "unavailable" = "ok",
): MachineVerdict {
  return { itemId, supported, reason, status, ...(evidenceRef ? { evidenceRef } : {}) };
}

function lintFindings(ctx: MachineVerifyContext): LegalLintFinding[] {
  return ctx.lintReport?.findings ?? [];
}

function failedRules(ctx: MachineVerifyContext): ReadonlySet<string> {
  return new Set(ctx.lintReport?.failedRules ?? []);
}

/**
 * lint 规则支撑的验证器工厂：把「哪些 ruleId 命中 = 未覆盖」这段逻辑**只写一次**，
 * 避免 10 个验证器各写一遍、也就避免了各写错一遍。
 */
function lintBacked(spec: {
  id: string;
  itemIds: readonly string[];
  ruleIds: readonly string[];
  unsupported: string;
  supported: string;
}): MachineVerifier {
  return {
    id: spec.id,
    ruleIds: spec.ruleIds,
    itemIds: spec.itemIds,
    run: (_pack, ctx) => {
      const broken = spec.ruleIds.filter((id) => failedRules(ctx).has(id));
      if (broken.length > 0) {
        // 依赖的规则本次执行失败 → 覆盖不完整，必须 fail-closed。
        return spec.itemIds.map((itemId) =>
          verdict(
            itemId,
            false,
            "本次未能完成该项目核对（核对规则执行失败），需人工确认或重跑。",
            `failedRules:${broken.join(",")}`,
            "unavailable",
          ),
        );
      }
      const wanted = new Set(spec.ruleIds);
      const found = lintFindings(ctx).filter((f) => wanted.has(f.ruleId));
      if (found.length === 0) {
        return spec.itemIds.map((itemId) =>
          verdict(itemId, true, spec.supported, spec.ruleIds.join(",")),
        );
      }
      const refs = [...new Set(found.map((f) => f.ruleId))].join(",");
      const first = found[0]?.message?.trim();
      const reason = first ? `${spec.unsupported}（${first}）` : spec.unsupported;
      return spec.itemIds.map((itemId) => verdict(itemId, false, reason, refs));
    },
  };
}

/**
 * 争议解决条款形式验证器。
 *
 * **只用形式规则，不用 `clause.dispute_missing`**——实测（2026-09-21，`tsx` 直接调用）：
 *
 * | 输入 | 结果 |
 * | ----------------------------------------------------- | ----------------------------- |
 * | `runClauseLint(含「提交北京仲裁委员会仲裁」的合同)` | **命中** `clause.dispute_missing` |
 * | `runClauseLint(合同, defaultClausePatterns())` | 同上（**不传 patterns 就是走默认表**） |
 * | `runClauseLint(合同, [])` | 同上（空数组才是"没有 patterns"） |
 *
 * 也就是说：**不是"没注入 patterns 导致识别不出"，而是识别器本身会把写在同一行里的
 * 争议解决条款判成「义务」条款**。根因有两处，都在 `clause/dsl.ts` +
 * `clause/extract.ts` 的 `classifyClause`：
 *   1. `obligations()` 的触发词含单字 **「应」**，而中文合同的争议解决条款几乎必然写成
 *      「双方**应**提交…仲裁」；
 *   2. `classifyClause` 按 patterns 数组顺序取**第一个**命中，而 `dispute()` 排在
 *      `obligations()` **之后**。
 *
 * 于是 `doc.clauses` 里没有 type 为 `dispute` 的条款 → `disputePresence` 报
 * 「未识别到争议解决条款」。把它接进来会让这类合同**每一条都误报**——正是路线图 R2
 * 说的「误报伤害信任」。真实语料（`fixtures/lawmind-round/purchase-contract.md`）与
 * 内联写法的短合同都能复现；写法带小标题（「第二条 争议解决」）时才不误报。
 *
 * 重现与守卫见 `clause/lint.test.ts` 的「已知误报」用例；等 `dispute()` 的触发词/顺序
 * 经法律顾问复核调整后再考虑接入。
 */
function disputeFormVerifier(): MachineVerifier {
  const lintRuleIds = ["form.jurisdiction", "form.or_arbitrate_or_sue"] as const;
  return {
    id: "forum.form_valid",
    ruleIds: lintRuleIds,
    itemIds: DISPUTE_ITEMS,
    run: (_pack, ctx) => {
      const broken = lintRuleIds.filter((id) => failedRules(ctx).has(id));
      if (broken.length > 0) {
        return DISPUTE_ITEMS.map((itemId) =>
          verdict(
            itemId,
            false,
            "本次未能完成争议解决条款的形式核对（核对规则执行失败），需人工确认或重跑。",
            `failedRules:${broken.join(",")}`,
            "unavailable",
          ),
        );
      }
      const wanted = new Set<string>(lintRuleIds);
      const found = lintFindings(ctx).filter((f) => wanted.has(f.ruleId));
      if (found.length === 0) {
        return DISPUTE_ITEMS.map((itemId) =>
          verdict(
            itemId,
            true,
            "已核对争议解决条款的形式有效性（未同时约定仲裁与诉讼）。",
            lintRuleIds.join(","),
          ),
        );
      }
      const refs = [...new Set(found.map((f) => f.ruleId))].join(",");
      const first = found[0]?.message?.trim();
      const reason =
        "争议解决约定形式存在问题（同时约定仲裁与诉讼），该约定可能无效。" +
        (first ? `（${first}）` : "");
      return DISPUTE_ITEMS.map((itemId) => verdict(itemId, false, reason, refs));
    },
  };
}

// ─────────────────────────────────────────────
// 证据包直接支撑的验证器
// ─────────────────────────────────────────────

const CITATION_ITEMS = [
  verificationKey("contract-review-v1", "citations"),
  verificationKey("learning-brief-v1", "citations"),
  verificationKey("general-v1", "citations"),
] as const;

const citationsSubset: MachineVerifier = {
  id: "citations.subset",
  ruleIds: [],
  itemIds: CITATION_ITEMS,
  run: (pack) => {
    const gates = pack.gates;
    if (gates.citationIntegrityOk === undefined) {
      return CITATION_ITEMS.map((itemId) =>
        verdict(
          itemId,
          false,
          "本次没有可核对的引用快照，无法确认引用能否溯源，需人工确认。",
          "gates.citationIntegrityOk",
          "unavailable",
        ),
      );
    }
    const missing = gates.citationMissingIds ?? [];
    if (!gates.citationIntegrityOk && missing.length > 0) {
      return CITATION_ITEMS.map((itemId) =>
        verdict(
          itemId,
          false,
          `正文引用的条目有 ${missing.length} 处不在本次检索快照中，无法溯源。`,
          "gates.citationMissingIds",
        ),
      );
    }
    return CITATION_ITEMS.map((itemId) =>
      verdict(itemId, true, "正文引用均可在本次检索快照中溯源。", "gates.citationIntegrityOk"),
    );
  },
};

const SOURCE_ITEMS = [
  verificationKey("compliance-dossier-v1", "sources"),
  verificationKey("training-ppt-v1", "sources"),
] as const;

const citationsUsed: MachineVerifier = {
  id: "citations.used",
  ruleIds: [],
  itemIds: SOURCE_ITEMS,
  run: (pack) => {
    if (pack.citations.length === 0) {
      return SOURCE_ITEMS.map((itemId) =>
        verdict(
          itemId,
          false,
          "本次没有检索来源记录，无法确认来源可否回溯，需人工确认。",
          "pack.citations",
          "unavailable",
        ),
      );
    }
    const unused = pack.citations.filter((c) => c.usedInHeadings.length === 0);
    if (unused.length > 0) {
      return SOURCE_ITEMS.map((itemId) =>
        verdict(
          itemId,
          false,
          `有 ${unused.length} 条检索来源在正文中未被引用，来源附录与实际依据不对应。`,
          "pack.citations[].usedInHeadings",
        ),
      );
    }
    return SOURCE_ITEMS.map((itemId) =>
      verdict(
        itemId,
        true,
        `检索来源共 ${pack.citations.length} 条，均已在正文引用。`,
        "pack.citations",
      ),
    );
  },
};

/** 权威被争点引用（防装饰性分析）。 */
const AUTHORITY_ITEMS = [verificationKey("demand-letter-v1", "facts")] as const;

const graphAuthorityUsed: MachineVerifier = {
  id: "graph.authority_used",
  ruleIds: [],
  itemIds: AUTHORITY_ITEMS,
  run: (_pack, ctx) => {
    const issues = ctx.graphIssues;
    if (!issues || issues.length === 0) {
      return AUTHORITY_ITEMS.map((itemId) =>
        verdict(
          itemId,
          false,
          "本次没有法律分析图谱，无法核对事实与依据的指向关系，需人工确认。",
          "graphIssues",
          "unavailable",
        ),
      );
    }
    const orphans = issues.filter((i) => i.authorityIds.length === 0);
    if (orphans.length > 0) {
      return AUTHORITY_ITEMS.map((itemId) =>
        verdict(
          itemId,
          false,
          `有 ${orphans.length} 个争点未引用任何依据，事实主张缺少支撑。`,
          "graphIssues[].authorityIds",
        ),
      );
    }
    return AUTHORITY_ITEMS.map((itemId) =>
      verdict(itemId, true, `全部 ${issues.length} 个争点均引用了依据。`, "graphIssues"),
    );
  },
};

// ─────────────────────────────────────────────
// 注册表
// ─────────────────────────────────────────────

const DISPUTE_ITEMS = [
  "eq.dispute",
  "ma.dispute",
  "pr.dispute",
  "constr.dispute",
  "loan.dispute",
  "lease.dispute",
  "em.dispute",
] as const;

/** 保证形式要件：方式是否写明「连带」+ 保证期间。 */
const GUARANTEE_ITEMS = ["loan.guarantee", "loan.period"] as const;

export const MACHINE_VERIFIERS: readonly MachineVerifier[] = [
  citationsSubset,
  citationsUsed,
  graphAuthorityUsed,
  lintBacked({
    id: "parties.consistent",
    itemIds: [verificationKey("contract-review-v1", "parties")],
    ruleIds: ["consistency.party_pair"],
    unsupported: "当事人名称前后不一致，需核对签约主体。",
    supported: "已核对当事人名称与签约主体的一致性。",
  }),
  lintBacked({
    id: "amounts.case_consistent",
    itemIds: [verificationKey("demand-letter-v1", "claim")],
    ruleIds: ["consistency.amount_case"],
    unsupported: "金额大写与小写不一致，主张金额需核对后统一。",
    supported: "已核对主张金额的大写与小写一致性。",
  }),
  lintBacked({
    id: "dates.ordered",
    itemIds: [verificationKey("demand-letter-v1", "deadline")],
    ruleIds: ["consistency.date_order"],
    unsupported: "日期顺序前后矛盾，履行期限表述需核对。",
    supported: "已核对履行期限与日期的自洽性。",
  }),
  lintBacked({
    id: "placeholders.closed",
    itemIds: [verificationKey("general-v1", "placeholders")],
    ruleIds: ["placeholder.open"],
    unsupported: "正文仍有未处理的占位符。",
    supported: "本次核对未发现未处理的占位符。",
  }),
  lintBacked({
    id: "statute.lpr_multiple",
    itemIds: ["loan.rate"],
    ruleIds: ["statutory.lpr_multiple", "statutory.lpr_legacy_rate"],
    unsupported: "利率、逾期利率与其他费用合计可能超过司法保护上限。",
    supported: "本次核对未发现利率合计触及司法保护上限。",
  }),
  lintBacked({
    id: "statute.deposit_cap",
    itemIds: ["pr.deposit"],
    ruleIds: ["statutory.deposit_cap"],
    unsupported: "定金比例超过主合同标的额的百分之二十，超出部分不产生定金效力。",
    supported: "已核对定金比例未超过法定上限。",
  }),
  lintBacked({
    id: "guarantee.form_valid",
    itemIds: GUARANTEE_ITEMS,
    ruleIds: ["form.guarantee_form_default", "form.guarantee_period"],
    unsupported: "保证担保的形式要件存在问题（保证方式或保证期间未写明）。",
    supported: "已核对保证方式与保证期间的形式要件。",
  }),
  disputeFormVerifier(),
];

export function machineVerifierIndex(): ReadonlyMap<string, MachineVerifier> {
  return new Map(MACHINE_VERIFIERS.map((v) => [v.id, v]));
}

export function hasMachineVerifier(id: string): boolean {
  return machineVerifierIndex().has(id);
}

/** machine 段只跑一次 lint，供各验证器共享。 */
export function buildMachineVerifyContext(input: {
  documentText: string;
  deliverableType?: string;
  graphIssues?: MachineVerifyContext["graphIssues"];
}): MachineVerifyContext {
  const report = runLegalLint(input.documentText, undefined, undefined, undefined, {
    deliverableType: input.deliverableType,
  });
  return {
    documentText: input.documentText,
    deliverableType: input.deliverableType,
    lintReport: report,
    graphIssues: input.graphIssues,
  };
}

/**
 * 跑全部机器验证器。
 *
 * 未知验证器 / 抛错 → 该项 `unavailable`（fail-closed），**不静默丢弃**。
 * 返回 Map 便于聚合层按键查。
 */
export function runMachineVerifiers(input: {
  pack: GuardianEvidencePack;
  ctx: MachineVerifyContext;
  /** 只跑判定表里实际登记为 machine 的验证器 id。 */
  verifierIds?: readonly string[];
}): Map<string, MachineVerdict> {
  const index = machineVerifierIndex();
  const wanted = input.verifierIds ? new Set(input.verifierIds) : undefined;
  const out = new Map<string, MachineVerdict>();
  for (const verifier of MACHINE_VERIFIERS) {
    if (wanted && !wanted.has(verifier.id)) {
      continue;
    }
    let verdicts: MachineVerdict[];
    try {
      verdicts = verifier.run(input.pack, input.ctx);
    } catch {
      for (const itemId of verifier.itemIds) {
        out.set(
          itemId,
          verdict(
            itemId,
            false,
            "自动核对程序执行异常，需人工确认。",
            `verifier_error:${verifier.id}`,
            "unavailable",
          ),
        );
      }
      continue;
    }
    for (const v of verdicts) {
      out.set(v.itemId, v);
    }
    // 验证器少答的项按不可用处理，绝不当作通过。
    for (const itemId of verifier.itemIds) {
      if (!out.has(itemId)) {
        out.set(
          itemId,
          verdict(
            itemId,
            false,
            "自动核对程序未给出结论，需人工确认。",
            `verifier_incomplete:${verifier.id}`,
            "unavailable",
          ),
        );
      }
    }
  }
  if (!wanted) {
    return out;
  }
  // 声明了 machine 但注册表里没有的验证器 → 对应项不可用（fail-closed）。
  for (const id of wanted) {
    if (!index.has(id)) {
      out.set(
        id,
        verdict(
          id,
          false,
          "该项的自动核对程序未安装，需人工确认。",
          `missing_verifier:${id}`,
          "unavailable",
        ),
      );
    }
  }
  return out;
}
