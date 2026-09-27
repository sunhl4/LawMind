/**
 * 外部决策模型端口（P5）——**默认关闭，且离线模式必须不可用**。
 *
 * ## 为什么是「端口」而不是「接入 Jev」
 *
 * 计划 §8 给的引入理由只有一条：作为 P2.3 分歧驱动的**第三条独立判定器**。
 * 而分歧驱动的价值来自**独立性**——Jev 是另一家厂商、另一种训练目标（RLCD vs RLHF）、
 * 另一种模态（不生成），所以它的分歧信号信息量最大。
 *
 * 但这也意味着：**LawMind 需要的是「一个足够异质的第三方判定者」这个能力，
 * 不是 TypeSafe 这个供应商。** 所以本模块定义端口，`JevAdapter` 只是第一个实现。
 * 一旦有本地/自持的等价物（见计划 §10 方案 C），换适配器即可，不动调用方。
 *
 * ## 四条硬约束（全部有测试锁定）
 *
 * 1. **默认 `off`。** 三态 `off | shadow | on`，默认 `off`——未显式开启时
 *    `resolveDecisionModel()` 返回 `null`，调用方拿不到任何东西。
 * 2. **`egressMode: offline` 时不可用。** 这条**优先于一切**：即使显式配了
 *    `decisionModelMode: "on"`，离线模式下仍返回 `null`。
 *    注意 `LAWMIND-EGRESS-POLICY.md` §4 明确「模型 API 不受 egressMode 约束」——
 *    那是既有口径，而本模块**刻意不沿用**它：外部判定器是新引入的出站通道，
 *    没有理由让它搭上「离线仍出网」的豁免。
 * 3. **必须显式同意。** 内容会发给第三方，所以要求显式开启，不能默认打开。
 *    `lawmind.policy.json` 不接受 `decisionModel*`（策略合同会拒绝）。开关是环境变量
 *    `LAWMIND_DECISION_MODEL_*`。函数参数里的 policy 只给进程内调用，不从那份文件读出来。
 * 4. **不可用时不许编造。** 端口返回 `undefined` 而不是某个默认判定
 *    ——与 `firm-calibrator.ts` 的「不返回大概 0.5」同一条原则。
 *
 * ## 为什么现在不接进任何判定路径
 *
 * 计划 §8 的前置条件是「P0–P4 已完成，资产已攒起来；已确认缺的是异质独立性」。
 * 前者已达成，**后者尚未确认**——因为 P2.3 的分歧数据还没有（工作区零记录）。
 * 在拿到分歧数据之前接入，等于把一个可测量的缺口换成一个不可测量的第三方承诺。
 * 所以本模块只提供**端口 + 门禁 + 适配器**，由调用方在条件满足后显式接。
 */

import { createOutboundProxy } from "../platform/outbound-proxy.js";
import { readWorkspacePolicyFile, resolveEgressMode } from "../policy/workspace-policy.js";

// ─────────────────────────────────────────────
// 问句原语与端口
// ─────────────────────────────────────────────

/**
 * 三个问句原语（对齐 Jev 的 `Noul` / `Choice` / `Score`）。
 *
 * LawMind 只暴露**类型化**的问句形状——判定器不能自由生成文本，
 * 这是这个端口存在的意义（它不是又一个聊天模型）。
 */
export type DecisionQuestion =
  | {
      /** 是/否概率 */
      type: "noul";
      id: string;
      instructions: string;
    }
  | {
      /** 从给定选项集中选一个 */
      type: "choice";
      id: string;
      instructions: string;
      options: readonly string[];
    }
  | {
      /** 按给定 rubric 打分 */
      type: "score";
      id: string;
      instructions: string;
      /** 打分区间（含两端） */
      scale: { min: number; max: number };
    };

export type DecisionAnswer =
  | { id: string; type: "noul"; probability: number; confidence: number }
  | {
      id: string;
      type: "choice";
      choice: string;
      /** 完整分布：option → 概率 */
      distribution: Record<string, number>;
      confidence: number;
    }
  | {
      id: string;
      type: "score";
      score: number;
      distribution: Record<string, number>;
      confidence: number;
    };

/**
 * 判定端口。实现者只需要 `decide`；`id` 用于审计与分歧记录（「这票来自谁」）。
 */
export type DecisionModel = {
  /** 稳定标识，进审计与分歧记录。例：`typesafe.jev-1.13.0`。 */
  id: string;
  /**
   * 对同一份 state 回答一组问句。
   *
   * 契约：
   *   - 不可用时返回 `undefined`（**不抛、不返回默认值**）；
   *   - 部分问句无答案时，缺失的项不出现在数组里（不编造）。
   */
  decide(input: {
    state: string;
    questions: readonly DecisionQuestion[];
    signal?: AbortSignal;
  }): Promise<readonly DecisionAnswer[] | undefined>;
};

// ─────────────────────────────────────────────
// 配置解析与门禁
// ─────────────────────────────────────────────

export type DecisionModelMode = "off" | "shadow" | "on";

export type DecisionModelConfig = {
  kind: "typesafe";
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export type DecisionModelResolution =
  | { mode: "off"; reason: string }
  | { mode: "shadow" | "on"; config: DecisionModelConfig };

/**
 * 三态解析。**默认 `off`**。
 *
 * `egressMode: offline` 一律 `off`——这是本模块最重要的单条规则，
 * 且**优先级最高**（在读取任何其他配置之前判定）。
 *
 * `shadow` 与 `on` 的区别由**调用方**体现：`shadow` 只记录判定结果作对照，
 * `on` 才允许结果参与决策。端口本身不区分二者——它只负责「可用 / 不可用」，
 * 因为这是配置问题而不是传输问题。
 */
export function resolveDecisionModel(opts: {
  workspaceDir: string;
  env?: NodeJS.ProcessEnv;
}): DecisionModelResolution {
  const env = opts.env ?? process.env;

  // ① 离线模式：优先于一切。连配置都不读——避免「配了 key 就以为能用」。
  const policy = readWorkspacePolicyFile(opts.workspaceDir);
  if (resolveEgressMode(policy) === "offline") {
    return { mode: "off", reason: "egress_offline" };
  }

  // ② 三态开关。默认 off —— 不存在「配了 key 就自动开」。
  const raw = (policy?.decisionModelMode ?? env.LAWMIND_DECISION_MODEL_MODE ?? "")
    .trim()
    .toLowerCase();
  if (raw === "" || raw === "off" || raw === "0" || raw === "false" || raw === "no") {
    return { mode: "off", reason: "disabled_by_default" };
  }
  const mode: DecisionModelMode = raw === "on" || raw === "1" || raw === "true" ? "on" : "shadow";

  // ③ 凭据。缺任一项即不可用 —— 不产出半配置的端口。
  const baseUrl = (
    policy?.decisionModelBaseUrl ??
    env.LAWMIND_DECISION_MODEL_BASE_URL ??
    ""
  ).trim();
  const apiKey = (policy?.decisionModelApiKey ?? env.LAWMIND_DECISION_MODEL_API_KEY ?? "").trim();
  const model = (policy?.decisionModelId ?? env.LAWMIND_DECISION_MODEL_ID ?? "").trim();
  if (!baseUrl || !apiKey || !model) {
    return { mode: "off", reason: "missing_credentials" };
  }

  const timeoutMsRaw = env.LAWMIND_DECISION_MODEL_TIMEOUT_MS?.trim();
  const timeoutMs =
    timeoutMsRaw && Number.isFinite(Number(timeoutMsRaw)) && Number(timeoutMsRaw) > 0
      ? Math.floor(Number(timeoutMsRaw))
      : 8_000;

  return {
    mode,
    config: { kind: "typesafe", baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, timeoutMs },
  };
}

/**
 * 便捷入口：拿到端口，或 `undefined`。
 *
 * 调用方**必须**能处理 `undefined`。这不是防御性编程——它是本模块的核心语义：
 * 「这个环境下没有第三方判定者」是一个正常、预期的状态。
 */
export function getDecisionModel(opts: { workspaceDir: string; env?: NodeJS.ProcessEnv }): {
  model: DecisionModel | undefined;
  mode: DecisionModelMode;
  reason: string;
} {
  const resolved = resolveDecisionModel(opts);
  if (resolved.mode === "off") {
    return { model: undefined, mode: "off", reason: resolved.reason };
  }
  return {
    model: createTypesafeDecisionModel(resolved.config),
    mode: resolved.mode,
    reason: resolved.mode === "on" ? "enabled" : "shadow",
  };
}

// ─────────────────────────────────────────────
// Typesafe（Jev）适配器
// ─────────────────────────────────────────────

const decisionProxy = createOutboundProxy({ requestTag: "decision-model" });

/** Jev 的响应形状（只声明我们要读的部分）。 */
type SystemOneResponse = {
  answers?: Array<{
    id?: unknown;
    type?: unknown;
    probability?: unknown;
    confidence?: unknown;
    choice?: unknown;
    score?: unknown;
    distribution?: unknown;
  }>;
};

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asDistribution(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = asNumber(v);
    if (n !== undefined) {
      out[k] = n;
    }
  }
  return out;
}

/** 把端口问句翻成 Jev 的请求形状。导出以便测试。 */
export function buildSystemOneRequestBody(input: {
  model: string;
  state: string;
  questions: readonly DecisionQuestion[];
}): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  for (const q of input.questions) {
    if (q.type === "noul") {
      questions[q.id] = { type: "noul", instructions: q.instructions };
      continue;
    }
    if (q.type === "choice") {
      questions[q.id] = { type: "choice", instructions: q.instructions, options: [...q.options] };
      continue;
    }
    questions[q.id] = {
      type: "score",
      instructions: q.instructions,
      scale: { min: q.scale.min, max: q.scale.max },
    };
  }
  return { model: input.model, state: input.state, questions };
}

/**
 * 把 Jev 响应解析成端口答案。**只收合法值**：
 *   - `noul` 的概率夹到 [0,1]；
 *   - `choice` 的选项必须在该问句的 `options` 内（防「编一个选项」）；
 *   - `score` 必须落在 `scale` 内。
 * 不合格的答案**丢弃**，不猜——与 `guardian` 的 `checklist_unknown_item` 同一原则。
 */
export function parseSystemOneAnswers(
  raw: SystemOneResponse | undefined,
  questions: readonly DecisionQuestion[],
): DecisionAnswer[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: DecisionAnswer[] = [];
  const rows = Array.isArray(raw?.answers) ? raw.answers : [];
  for (const row of rows) {
    // 第三方响应的形状不可信：`[null]`、字符串、数组都可能出现。
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const question = byId.get(id);
    if (!question) {
      continue; // 编造的问句 id
    }
    const confidence = asNumber(row.confidence) ?? 0;
    if (question.type === "noul" && row.type === "noul") {
      const p = asNumber(row.probability);
      if (p === undefined) {
        continue;
      }
      out.push({
        id,
        type: "noul",
        probability: Math.min(1, Math.max(0, p)),
        confidence: Math.min(1, Math.max(0, confidence)),
      });
      continue;
    }
    if (question.type === "choice" && row.type === "choice") {
      const choice = typeof row.choice === "string" ? row.choice.trim() : "";
      // 选项必须在调用方给的集合里
      if (!choice || !question.options.includes(choice)) {
        continue;
      }
      out.push({
        id,
        type: "choice",
        choice,
        distribution: asDistribution(row.distribution) ?? { [choice]: 1 },
        confidence: Math.min(1, Math.max(0, confidence)),
      });
      continue;
    }
    if (question.type === "score" && row.type === "score") {
      const s = asNumber(row.score);
      if (s === undefined || s < question.scale.min || s > question.scale.max) {
        continue;
      }
      out.push({
        id,
        type: "score",
        score: s,
        distribution: asDistribution(row.distribution) ?? { [String(s)]: 1 },
        confidence: Math.min(1, Math.max(0, confidence)),
      });
    }
  }
  return out;
}

/**
 * 创建 Typesafe/Jev 端口。
 *
 * **必须走 `createOutboundProxy`** —— 与 `llm/openai-json.ts` 的 `jsonProxy` 同一理由：
 * 否则会绕过 SSRF 防护、网络白名单与出口审计。
 *
 * 任何失败（网络、超时、非 200、解析失败）都返回 `undefined`——
 * 第三方判定者不可用是**正常状态**，不是异常，绝不能让调用方因此崩溃或降级到假数据。
 */
export function createTypesafeDecisionModel(config: DecisionModelConfig): DecisionModel {
  const url = `${config.baseUrl}/v1/systemone`;
  return {
    id: `typesafe.${config.model}`,
    async decide(input) {
      if (input.questions.length === 0) {
        return [];
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const onAbort = () => controller.abort();
      input.signal?.addEventListener("abort", onAbort);
      try {
        const res = await decisionProxy.fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(
            buildSystemOneRequestBody({
              model: config.model,
              state: input.state,
              questions: input.questions,
            }),
          ),
          signal: controller.signal,
        });
        if (!res.ok) {
          return undefined;
        }
        const json = (await res.json()) as SystemOneResponse;
        return parseSystemOneAnswers(json, input.questions);
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
