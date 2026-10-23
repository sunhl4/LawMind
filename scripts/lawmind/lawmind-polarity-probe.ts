/**
 * Polarity probe: does the model answer a positive question and its negative
 * twin consistently?
 *
 * Background: the 2026-10-22 atomic-criteria experiment scored 0% all-pass on a
 * fixture whose defects are all absent, because the model answered "yes" to
 * every defect question. That suggested a polarity bias rather than a reasoning
 * failure. This probe isolates it: same contract, same fact, two phrasings.
 *
 * Design:
 *   - positive phrasing asks whether a PROTECTION is present  (expected: yes)
 *   - negative phrasing asks whether a DEFECT is present     (expected: no)
 *   - one question per call, so the two phrasings cannot influence each other
 *   - no tools, no system prompt beyond "answer one word"
 *
 * A model that actually reads the contract answers positive=true and
 * negative=false on a clean clause. A model with a "yes" bias answers
 * positive=true AND negative=true.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node --import tsx scripts/lawmind/lawmind-polarity-probe.ts
 *   ... --model deepseek-flash --trials 2 --cases s01,s02
 */

import { callModelWithRetry } from "../../src/lawmind/agent/runtime-model-call.js";
import type { AgentModelConfig } from "../../src/lawmind/agent/types.js";
import { loadRuleAllPassFixtures } from "../../src/lawmind/evaluation/rule-allpass.js";
import { getProviderDefinition } from "../../src/lawmind/models/providers.js";

/** One fact, asked two ways. `expectPositive` is the answer a careful reader gives. */
type PolarityPair = {
  id: string;
  /** Why this fact is what it is; kept for the report. */
  fact: string;
  /** True when the protection is present in the reference clauses. */
  protectionPresent: Record<string, boolean>;
  askPositive: string;
  askNegative: string;
};

/**
 * Facts chosen so the answer is decidable from the contract text alone.
 * Keyed by fixture case id: s01 has no defects at all, s02 has an asymmetric
 * liability cap, s05 has no acceptance fallback, s10 has no termination clause.
 */
const PAIRS: PolarityPair[] = [
  {
    id: "liability.cap",
    fact: "双方是否都受同一金额上限约束",
    protectionPresent: { s01: true, s02: false, s05: true, s10: true },
    askPositive: "本合同是否对双方都约定了金额一致的赔偿上限？",
    askNegative: "本合同是否存在一方不设赔偿上限的情形？",
  },
  {
    id: "dispute.forum",
    fact: "是否只约定一种争议解决方式",
    protectionPresent: { s01: true, s02: true, s05: true, s10: true },
    askPositive: "本合同是否只约定了一种争议解决方式（诉讼与仲裁不并存）？",
    askNegative: "本合同是否同时约定了诉讼与仲裁两种争议解决方式？",
  },
  {
    id: "termination.symmetry",
    fact: "是否约定了解除条款及对等解除权",
    protectionPresent: { s01: true, s02: true, s05: true, s10: false },
    askPositive: "本合同是否约定了合同解除的条款？",
    askNegative: "本合同是否完全没有约定合同解除的任何内容？",
  },
  {
    id: "ip.data",
    fact: "是否明确排除知识产权权属转让",
    protectionPresent: { s01: true, s02: true, s05: false, s10: true },
    askPositive: "本合同是否明确声明不构成知识产权权属转让？",
    askNegative: "本合同是否将一方的知识产权权属转让给另一方？",
  },
  {
    id: "payment.acceptance",
    fact: "验收是否由双方共同确认",
    protectionPresent: { s01: true, s02: true, s05: true, s10: true },
    askPositive: "本合同是否约定由双方共同确认验收？",
    askNegative: "本合同是否由对方单方决定验收结果？",
  },
  {
    id: "confidentiality.noncompete",
    fact: "保密范围是否限于商业秘密",
    protectionPresent: { s01: true, s02: true, s05: true, s10: false },
    askPositive: "本合同是否把保密范围限定为商业秘密？",
    askNegative: "本合同是否把已经公开的信息也纳入保密范围？",
  },
];

const argv = process.argv.slice(2);
function argValue(flag: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1].trim() : "";
}

const modelId = argValue("--model") || "deepseek-flash";
const trials = Math.max(1, Number.parseInt(argValue("--trials") || "2", 10) || 2);
const caseFilter = argValue("--cases")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function resolveModel(): AgentModelConfig {
  const provider = getProviderDefinition("deepseek");
  let apiKey = "";
  for (const key of provider.apiKeyEnvKeys) {
    const value = process.env[key]?.trim();
    if (value) {
      apiKey = value;
      break;
    }
  }
  if (!apiKey) {
    console.error(`未配置 DeepSeek key。设置其中之一：${provider.apiKeyEnvKeys.join(" / ")}`);
    process.exit(2);
  }
  return {
    provider: "openai-compatible",
    baseUrl: provider.defaultBaseUrl,
    apiKey,
    model: modelId,
    temperature: 0,
    maxRetries: 1,
    timeoutMs: 60_000,
  };
}

const ANSWER_SYSTEM =
  "只回答 true 或 false，不要解释，不要加标点以外的任何内容。true 表示「是」，false 表示「否」。";

/**
 * Second axis under test: the role frame. The production review worker runs
 * under "审查子工：只交回这一争点可落改的补丁" — a find-defects job. If that
 * frame alone flips a clean clause to "defect present", the problem is the
 * frame, not the model's ability to read polarity.
 */
const REVIEWER_SYSTEM = [
  "你是合同审查子工。你的职责是找出这份合同条款里需要修改的问题，并交回可落改的补丁。",
  "只回答 true 或 false，不要解释。true 表示「是」，false 表示「否」。",
].join("");

const frameArg = argValue("--frame") || "neutral";
const SYSTEM_PROMPT = frameArg === "reviewer" ? REVIEWER_SYSTEM : ANSWER_SYSTEM;

/**
 * Third axis: are the failures caused by my criterion wording, or by answering
 * many questions in one shot? `--use-criteria` asks the production criteria
 * text, one question per call, so batch effects are removed.
 */
const useCriteria = argv.includes("--use-criteria");

async function ask(
  config: AgentModelConfig,
  contract: string,
  question: string,
): Promise<boolean | undefined> {
  const response = await callModelWithRetry(
    config,
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `【合同】\n${contract}\n\n【问题】${question}\n\n只答 true 或 false。`,
      },
    ],
    [],
  );
  const text = (
    (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message
      ?.content ?? ""
  )
    .trim()
    .toLowerCase();
  if (text.startsWith("true")) {
    return true;
  }
  if (text.startsWith("false")) {
    return false;
  }
  return undefined;
}

type Row = {
  caseId: string;
  pairId: string;
  trial: number;
  positive: boolean | undefined;
  negative: boolean | undefined;
  /** A careful reader: positive should equal protectionPresent, negative its negation. */
  positiveCorrect: boolean;
  negativeCorrect: boolean;
  /** Both answers say the same thing about the fact -> the pair is consistent. */
  consistent: boolean;
};

const config = resolveModel();
const loaded = loadRuleAllPassFixtures();
const cases = loaded.cases.filter((c) =>
  caseFilter.length === 0 ? true : caseFilter.includes(c.caseId),
);

if (cases.length === 0) {
  console.error("没有匹配的用例。可用 --cases s01,s02");
  process.exit(2);
}

const rows: Row[] = [];
let calls = 0;

/** Production criteria, one question per call. */
if (useCriteria) {
  const { CN_SALES_RULES } = await import("../../src/lawmind/review/playbooks/cn-sales.js");
  const plan = cases.length * CN_SALES_RULES.filter((r) => r.paper !== "own").length;
  let done = 0;
  const detail: Array<{ caseId: string; ruleId: string; q: string; answer: boolean | undefined }> =
    [];
  for (const testCase of cases) {
    const rules = CN_SALES_RULES.filter((r) => r.paper === testCase.paper || r.paper === "either");
    for (const rule of rules) {
      for (const criterion of rule.criteria) {
        const answer = await ask(config, testCase.contract, criterion.question);
        done += 1;
        process.stderr.write(`\r[${done}/${plan}] ${testCase.caseId} ${rule.ruleId}   `);
        detail.push({
          caseId: testCase.caseId,
          ruleId: rule.ruleId,
          q: criterion.question,
          answer,
        });
      }
    }
  }
  process.stderr.write("\n");
  console.log("## 生产 criteria 单选题结果");
  console.log("");
  console.log(`- 模型：${modelId}　用例：${cases.map((c) => c.caseId).join(", ")}`);
  console.log(`- 每题单独一次调用，不带批量上下文`);
  console.log("");
  console.log("| 用例 | 规则 | 题面 | 答 |");
  console.log("| --- | --- | --- | --- |");
  for (const d of detail) {
    console.log(`| ${d.caseId} | ${d.ruleId} | ${d.q} | ${d.answer} |`);
  }
  console.log("");
  const yes = detail.filter((d) => d.answer === true).length;
  console.log(`- 答 true 的题：${yes}/${detail.length}`);

  // Does one-question-per-call actually restore the fixture verdicts?
  // This is the decisive check: answers -> decideVerdict -> expected.
  const { decideVerdict } = await import("../../src/lawmind/review/verdict.js");
  console.log("");
  console.log("### 单题答案经 decideVerdict 还原");
  console.log("");
  console.log("| 用例 | 规则 | 期望 | 实得 | 一致 |");
  console.log("| --- | --- | --- | --- | --- |");
  let agree = 0;
  let total = 0;
  for (const testCase of cases) {
    const rules = CN_SALES_RULES.filter((r) => r.paper === testCase.paper || r.paper === "either");
    for (const rule of rules) {
      const expected = testCase.expected[rule.ruleId];
      if (!expected) {
        continue;
      }
      const answers = rule.criteria.map((criterion) => {
        const hit = detail.find(
          (d) =>
            d.caseId === testCase.caseId && d.ruleId === rule.ruleId && d.q === criterion.question,
        );
        const met: boolean | "unknown" = hit?.answer ?? "unknown";
        return { criterionId: criterion.id, met };
      });
      const got = decideVerdict(rule, { clausePresent: true, answers }).kind;
      const same = got === expected;
      total += 1;
      if (same) {
        agree += 1;
      }
      console.log(
        `| ${testCase.caseId} | ${rule.ruleId} | ${expected} | ${got} | ${same ? "✓" : "✗"} |`,
      );
    }
  }
  console.log("");
  console.log(`- 档位一致：${agree}/${total}`);
  process.exit(0);
}
const totalCalls = cases.length * PAIRS.length * trials * 2;

for (const testCase of cases) {
  for (const pair of PAIRS) {
    const protectionPresent = pair.protectionPresent[testCase.caseId];
    if (protectionPresent === undefined) {
      continue;
    }
    for (let t = 0; t < trials; t += 1) {
      const [positive, negative] = await Promise.all([
        ask(config, testCase.contract, pair.askPositive),
        ask(config, testCase.contract, pair.askNegative),
      ]);
      calls += 2;
      process.stderr.write(`\r[${calls}/${totalCalls}] ${testCase.caseId} ${pair.id}   `);
      if (positive === undefined || negative === undefined) {
        continue;
      }
      rows.push({
        caseId: testCase.caseId,
        pairId: pair.id,
        trial: t + 1,
        positive,
        negative,
        positiveCorrect: positive === protectionPresent,
        negativeCorrect: negative === !protectionPresent,
        // Two phrasings agree when one says "yes, the thing is there" and the
        // other says "no, the opposite thing is not".
        consistent: positive === protectionPresent && negative === !protectionPresent,
      });
    }
  }
}
process.stderr.write("\n");

function rate(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`;
}

const answered = rows.length;
const positives = rows.filter((r) => r.positive === true).length;
const negativesOfPositive = rows.filter((r) => r.positive === true && r.negative === true).length;
const posCorrect = rows.filter((r) => r.positiveCorrect).length;
const negCorrect = rows.filter((r) => r.negativeCorrect).length;

console.log("## 极性探针结果");
console.log("");
console.log(`- 模型：${modelId}　采样：${trials}　用例：${cases.map((c) => c.caseId).join(", ")}`);
console.log(`- 角色框架：${frameArg === "reviewer" ? "审查子工（找问题）" : "中性（只判真假）"}`);
console.log(`- 有效成对样本：${answered}（每次采样问两遍同一事实）`);
console.log("");
console.log("| 指标 | 值 |");
console.log("| --- | --- |");
console.log(`| 正向题作答为 true | ${positives}/${answered}（${rate(positives, answered)}） |`);
console.log(`| 正向题判对 | ${posCorrect}/${answered}（${rate(posCorrect, answered)}） |`);
console.log(`| 反向题判对 | ${negCorrect}/${answered}（${rate(negCorrect, answered)}） |`);
console.log(
  `| **两种问法互相矛盾** | ${answered - rows.filter((r) => r.consistent).length}/${answered}（${rate(answered - rows.filter((r) => r.consistent).length, answered)}） |`,
);
console.log(
  `| 正向答 true 且反向也答 true | ${negativesOfPositive}/${positives || 1}（${rate(negativesOfPositive, positives)}） |`,
);
console.log("");
console.log("### 逐对明细");
console.log("");
console.log("| 用例 | 事实 | 保护本应存在 | 正向答 | 反向答 | 一致 |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const r of rows) {
  const present = PAIRS.find((p) => p.id === r.pairId)?.protectionPresent[r.caseId];
  console.log(
    `| ${r.caseId} | ${r.pairId} | ${present ? "是" : "否"} | ${r.positive} | ${r.negative} | ${
      r.consistent ? "✓" : "✗"
    } |`,
  );
}

const contradictRatio =
  answered === 0 ? 0 : (answered - rows.filter((r) => r.consistent).length) / answered;
console.log("");
console.log("### 判读");
console.log("");
if (contradictRatio >= 0.3) {
  console.log(
    `矛盾率 ${rate(answered - rows.filter((r) => r.consistent).length, answered)} ≥ 30%：` +
      "模型不能稳定区分同一事实的正反问法。用原子题定档的前提不成立，应先修问法或换模型。",
  );
} else {
  console.log(
    `矛盾率 ${rate(answered - rows.filter((r) => r.consistent).length, answered)} < 30%：` +
      "模型能区分正反问法，原子题路线可行，可继续把 criteria 改为正向极性。",
  );
}
console.log("");
console.log(`> 本次未使用工具、未改生产默认值；每次调用只问一个问题。`);
