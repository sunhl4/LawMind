/**
 * 判据分级三态门控（G0）。
 *
 * | mode     | 行为 |
 * | -------- | ---------------------------------------------------------------------------------------------- |
 * | `off`    | 全部项按 `judge` 走（等价于改造前）。**不是**回退到模型下 verdict——那个口径已废弃 |
 * | `shadow` | machine 与 judge **双跑**，只记录一致率，`verdict` 仍按 judge（行为不变，零风险） |
 * | `on`     | machine 项由代码判、**不进提示词**；judge 项照旧 |
 *
 * 默认 `shadow`。为什么：`shadow` 阶段不改变任何律师可见行为，因此「默认开」不构成风险；
 * 而它产出的**逐项一致率**正是转 `on` 的唯一依据（一致率 <90% 的项禁止转，见计划 §3.8）。
 *
 * 解析顺序：policy 显式 → env 显式 → 缺省。**未知取值按缺省处理**，不把写错的配置当成硬墙或免检。
 */

import { MACHINE_VERIFIERS } from "../guardian/machine-verifiers.js";
import { resolveEdition } from "./edition.js";
import type { LawMindWorkspacePolicy } from "./workspace-policy.js";

export type JudgmentTieringMode = "off" | "shadow" | "on";

export const JUDGMENT_TIERING_MODES: readonly JudgmentTieringMode[] = ["off", "shadow", "on"];

function parseMode(raw: unknown): JudgmentTieringMode | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const v = raw.trim().toLowerCase();
  if (v === "off" || v === "0" || v === "false" || v === "no") {
    return "off";
  }
  if (v === "on" || v === "1" || v === "true" || v === "escalate") {
    return "on";
  }
  if (v === "shadow") {
    return "shadow";
  }
  return undefined;
}

export function resolveJudgmentTieringMode(opts?: {
  policy?: { judgmentTiering?: unknown } | null;
  env?: NodeJS.ProcessEnv;
}): JudgmentTieringMode {
  const fromPolicy = parseMode(opts?.policy?.judgmentTiering);
  if (fromPolicy) {
    return fromPolicy;
  }
  const env = opts?.env ?? process.env;
  return parseMode(env.LAWMIND_JUDGMENT_TIERING) ?? "shadow";
}

/**
 * 被停用的验证器集合（自动回滚用）。
 *
 * 触发场景：某验证器的不可用率超阈、或它产生的 blocker 出现误报。停用后其项
 * **自动降回 `judge`**（不是失效放行）——这是 fail-closed 方向，所以无需审批即可生效。
 *
 * 取值：policy `judgmentDisabledVerifiers: string[]`，或 env
 * `LAWMIND_JUDGMENT_DISABLED_VERIFIERS=a,b`。未知 id 静默忽略（无害：它本就没跑）。
 */
export function resolveDisabledVerifiers(opts?: {
  policy?: { judgmentDisabledVerifiers?: unknown } | null;
  env?: NodeJS.ProcessEnv;
}): ReadonlySet<string> {
  const known = new Set(MACHINE_VERIFIERS.map((v) => v.id));
  const collected: string[] = [];

  const fromPolicy = opts?.policy?.judgmentDisabledVerifiers;
  if (Array.isArray(fromPolicy)) {
    for (const row of fromPolicy) {
      if (typeof row === "string") {
        collected.push(row);
      }
    }
  }
  const env = opts?.env ?? process.env;
  const raw = env.LAWMIND_JUDGMENT_DISABLED_VERIFIERS;
  if (typeof raw === "string" && raw.trim()) {
    collected.push(...raw.split(","));
  }

  return new Set(collected.map((s) => s.trim()).filter((s) => s.length > 0 && known.has(s)));
}

/** machine 段是否要跑（`shadow` 与 `on` 都跑，`off` 不跑）。 */
export function shouldRunMachineStage(mode: JudgmentTieringMode): boolean {
  return mode !== "off";
}

/**
 * machine 结论是否参与 `verdict`。
 *
 * 只有 `on` 才参与；`shadow` 只记录（因此 shadow 期行为与改造前完全一致——
 * 这是"默认开 shadow 零风险"的技术依据）。
 */
export function machineVerdictsAffectOutcome(mode: JudgmentTieringMode): boolean {
  return mode === "on";
}

/** 某项在当前 mode 下的**实际生效**判定主体。 */
export function effectiveTier(input: {
  declared: "machine" | "judge" | "lawyer";
  verifier?: string;
  mode: JudgmentTieringMode;
  disabledVerifiers: ReadonlySet<string>;
}): "machine" | "judge" | "lawyer" {
  if (input.declared !== "machine") {
    return input.declared;
  }
  if (input.mode === "off") {
    // off = 全部按 judge 走。
    return "judge";
  }
  if (!input.verifier || input.disabledVerifiers.has(input.verifier)) {
    // 验证器缺失或被停用 → 降回 judge（不是失效放行）。
    return "judge";
  }
  return "machine";
}

/**
 * 律师升级通道是否已可用。
 *
 * **G3 起通道已实现**（`platform/judgment-escalation.ts` + `buildJudgmentEscalationAction`），
 * 所以这里不再恒为 false；但**缺省仍是关**，理由见下。
 *
 * 这条开关原本存在的理由是一条**静默覆盖漏洞**：`lawyer` 项的定义是「不判，只升级」。
 * 如果升级卡片不存在就把 lawyer 项从提示词里摘掉，这些项**既不被任何判定器判、
 * 也不会出现在任何卡片上**——它们会安静地消失，而那恰恰是「主观裁量项最需要律师看见」
 * 的那一批。通道现已就绪，但**默认仍不开启**，因为：
 *
 *   1. 判据分级的 `shadow` 期还没攒到一致率数据（转 `on` 的前置，见计划 §3.8）；
 *   2. 升级通道只在 `mode === "on"` 时才真的摘项，所以两档必须一起开。
 *
 * 解析顺序：进程内 policy 对象 → 环境变量 `LAWMIND_JUDGMENT_ESCALATION` → 缺省 off。
 * `lawmind.policy.json` 写 `judgmentEscalation` 会被拒绝，不会从文件生效。
 * policy 参数留给测试和以后的内置接线。
 */
export function resolveLawyerEscalationPosture(opts?: {
  policy?: { judgmentEscalation?: unknown; edition?: unknown } | null;
  env?: NodeJS.ProcessEnv;
}): "off" | "on" {
  const fromPolicy = parseMode(opts?.policy?.judgmentEscalation);
  if (fromPolicy) {
    return fromPolicy === "on" ? "on" : "off";
  }
  const env = opts?.env ?? process.env;
  const fromEnv = parseMode(env.LAWMIND_JUDGMENT_ESCALATION);
  if (fromEnv) {
    return fromEnv === "on" ? "on" : "off";
  }
  // 缺省：**一律 off**。edition 差异体现在升级卡的**姿态**（advisory / block），
  // 而不是"通道开不开"——通道开不开是"判据分级成熟度"的问题，
  // 用 edition 去决定它会让同一个判断项在不同版本里有不同判定主体，
  // 那会让战绩序列无法跨 edition 比较（棘轮的维度是「族 × 项 × edition」，
  // 但**判定主体必须一致**，否则序列不是同一个东西）。
  return "off";
}

/** 兼容旧名（此前没有 edition 维度）。 */
export function isLawyerEscalationAvailable(opts?: {
  policy?: { judgmentEscalation?: unknown; edition?: unknown } | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return resolveLawyerEscalationPosture(opts) === "on";
}

/**
 * G3：升级卡的**姿态**（三 edition 分档）。
 *
 * - `solo`：`advisory` —— 单人执业，打断成本高；先让他**看见**系统的判断与定夺项。
 * - `firm` / `private_deploy`：`block` —— 多律师协作，「按哪种口径办理」是所内口径问题，
 *   不确认就可能把该核对的东西漏掉。
 *
 * 解析顺序：policy 显式 → env 显式 → edition 缺省。
 * **未知取值按所在 edition 缺省处理**，不把写错的配置当硬墙或免检。
 */
export function resolveEscalationPosture(opts?: {
  policy?: { judgmentEscalationPosture?: unknown; edition?: unknown } | null;
  env?: NodeJS.ProcessEnv;
}): "advisory" | "block" {
  const explicit = opts?.policy?.judgmentEscalationPosture;
  if (explicit === "advisory" || explicit === "block") {
    return explicit;
  }
  const env = opts?.env ?? process.env;
  const raw = env.LAWMIND_JUDGMENT_ESCALATION_POSTURE?.trim().toLowerCase();
  if (raw === "advisory" || raw === "block") {
    return raw;
  }
  // 调用方可能只带一个字段（测试 / 局部配置）——edition 解析只用到 `edition` 与 `features`。
  const editionPolicy = (opts?.policy ?? null) as LawMindWorkspacePolicy | null;
  return resolveEdition({ policy: editionPolicy, env: opts?.env }).edition === "solo"
    ? "advisory"
    : "block";
}
