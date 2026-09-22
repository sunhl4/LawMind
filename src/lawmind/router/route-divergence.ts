/**
 * 三路径分歧记录（P2.3）——shadow-only。
 *
 * 核心命题：**不需要概率，也不需要新供应商，就能拿到「这次判断可能不可靠」的信号。**
 * 不确定性 = 多个**便宜且相互独立**的判定路径**彼此不一致**。
 *
 * LawMind 天然有三条路，且都不需要额外调用：
 *   1. `keyword` —— `router/keyword-route.ts` 的正则表（同步、零成本）
 *   2. `model`   —— `router/model-route.ts` 的 LLM 分类（已经在跑，不额外花钱）
 *   3. `triage`  —— `triage/rules.ts` 的规则分诊（同步、零成本）
 *
 * 为什么这比「接一个概率模型」更贴合 LawMind：
 *   - **不需要阈值**：分歧就升级、一致就用。阈值是要维护、要调参、会被人忘掉的东西。
 *   - **不需要训练**：三条路径都已存在。
 *   - **不需要供应商**：零新增依赖、零新增出网。
 *   - **分歧样本本身就是审计证据**：向律师解释「正则说是合同审查，模型说是法律检索」
 *     是可读的；解释「模型给了 0.73」不是。
 *   - **fail-closed 是结构性的**：不一致 → 升级，不需要额外规则。
 *
 * 安全性：本模块**纯记录**。`recordRouteDivergence` 的返回值不参与 `routeAsync` 的决策，
 * 唯一副作用是往 `workspace/lawmind/decision/route-divergence.jsonl` 追加一行。
 * 关闭时（policy / env）整个模块不动。
 */

import fs from "node:fs";
import path from "node:path";

export type RoutePathId = "keyword" | "model" | "triage";

/** 单条路径给出的意见。只保留**可比**的维度（kind / riskLevel）。 */
export type RouteOpinion = {
  path: RoutePathId;
  kind?: string;
  riskLevel?: string;
};

export type RouteDivergenceRecord = {
  ts: string;
  /** 原话前 120 字（不含全文——分歧记录不是语料，够定位即可）。 */
  instructionHead: string;
  matterId?: string;
  opinions: RouteOpinion[];
  /** 出现过的 kind 去重集合（>1 即 kind 分歧）。 */
  kinds: string[];
  /** 出现过的 riskLevel 去重集合（>1 即风险档分歧）。 */
  riskLevels: string[];
  kindAgreement: boolean;
  riskAgreement: boolean;
  /** 是否有路径完全没给意见（缺答也算一种不稳定）。 */
  missingOpinions: RoutePathId[];
  /**
   * 分歧的稳定指纹：只由 kinds / riskLevels 的**排序集合**决定，
   * 便于聚合「同一类分歧出现了多少次」，而不是每条原话各算一次。
   */
  divergenceKey: string;
};

export const ROUTE_DIVERGENCE_REL = "lawmind/decision/route-divergence.jsonl";

export function routeDivergencePath(workspaceDir: string): string {
  return path.join(workspaceDir, ROUTE_DIVERGENCE_REL);
}

/**
 * 是否记录分歧。
 * - policy `routeDivergenceShadow === false` → 关
 * - env `LAWMIND_ROUTE_DIVERGENCE=0|false|off` → 关
 * - 默认**开**（纯记录、零行为影响、零网络）。所以「默认开」不构成风险。
 */
export function isRouteDivergenceShadowEnabled(opts?: {
  policy?: { routeDivergenceShadow?: boolean } | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = opts?.env ?? process.env;
  const raw = (env.LAWMIND_ROUTE_DIVERGENCE ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  if (opts?.policy && opts.policy.routeDivergenceShadow === false) {
    return false;
  }
  return true;
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v))),
  ].toSorted();
}

/**
 * 纯函数：把三条路径的意见折成一条分歧记录（或 undefined 表示无可比信息）。
 *
 * 判定口径（**刻意不做加权、不设阈值**）：
 *   - `kindAgreement`：所有**给了 kind** 的路径一致；给 0 或 1 条意见时视为一致（无从分歧）。
 *   - `riskAgreement`：同理。
 *   - `missingOpinions`：没给出 kind 的路径。缺答**不算**分歧，但记下来——
 *     某条路径长期缺答本身就是「它对该类输入不可用」的证据。
 */
export function buildRouteDivergenceRecord(input: {
  instruction: string;
  matterId?: string;
  opinions: readonly RouteOpinion[];
  now?: Date;
}): RouteDivergenceRecord | undefined {
  const opinions = input.opinions.filter((o) => o && o.path);
  const withKind = opinions.filter((o) => o.kind?.trim());
  if (opinions.length === 0) {
    return undefined;
  }
  const kinds = uniqueSorted(withKind.map((o) => o.kind));
  const riskLevels = uniqueSorted(opinions.map((o) => o.riskLevel));
  const missingOpinions = opinions
    .filter((o) => !o.kind?.trim())
    .map((o) => o.path)
    .toSorted();

  return {
    ts: (input.now ?? new Date()).toISOString(),
    instructionHead: input.instruction.replace(/\s+/g, " ").trim().slice(0, 120),
    ...(input.matterId?.trim() ? { matterId: input.matterId.trim() } : {}),
    opinions: opinions.map((o) => ({
      path: o.path,
      ...(o.kind?.trim() ? { kind: o.kind.trim() } : {}),
      ...(o.riskLevel?.trim() ? { riskLevel: o.riskLevel.trim() } : {}),
    })),
    kinds,
    riskLevels,
    // 只有 0 或 1 条 kind 意见时无从分歧 → 视为一致（不是「通过」，是「不可判」）。
    kindAgreement: kinds.length <= 1,
    riskAgreement: riskLevels.length <= 1,
    missingOpinions,
    divergenceKey: `k:${kinds.join(",")}|r:${riskLevels.join(",")}`,
  };
}

/** 该记录是否构成需要升级的分歧。 */
export function isDivergent(record: RouteDivergenceRecord): boolean {
  return !record.kindAgreement || !record.riskAgreement;
}

/**
 * Shadow 记录：追加一行 JSONL。**永不抛**——记录失败不得影响路由。
 * 返回 true 表示确实写了（调用方一般不需要用它）。
 */
export function recordRouteDivergence(
  workspaceDir: string,
  record: RouteDivergenceRecord,
): boolean {
  try {
    const dest = routeDivergencePath(workspaceDir);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.appendFileSync(dest, `${JSON.stringify(record)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export type RouteDivergenceReadResult = {
  present: boolean;
  rows: RouteDivergenceRecord[];
  totalLines: number;
  skippedLines: number;
};

/** 读取端（与 `metrics/lint-escape-candidates.ts` 的 readJsonlTolerant 同口径）。 */
export function readRouteDivergenceRecords(workspaceDir: string): RouteDivergenceReadResult {
  const file = routeDivergencePath(workspaceDir);
  if (!fs.existsSync(file)) {
    return { present: false, rows: [], totalLines: 0, skippedLines: 0 };
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const rows: RouteDivergenceRecord[] = [];
  let totalLines = 0;
  let skippedLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    totalLines += 1;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        skippedLines += 1;
        continue;
      }
      const rec = parsed as Record<string, unknown>;
      const ts = typeof rec.ts === "string" ? rec.ts.trim() : "";
      const divergenceKey = typeof rec.divergenceKey === "string" ? rec.divergenceKey : "";
      if (!ts || !divergenceKey) {
        skippedLines += 1;
        continue;
      }
      rows.push(rec as unknown as RouteDivergenceRecord);
    } catch {
      skippedLines += 1;
    }
  }
  return { present: true, rows, totalLines, skippedLines };
}

/** 按 `divergenceKey` 聚合——回答「最常见的分歧是哪几类」。 */
export function summarizeRouteDivergence(workspaceDir: string): {
  present: boolean;
  total: number;
  divergent: number;
  byKey: Array<{ divergenceKey: string; count: number; example: string }>;
} {
  const read = readRouteDivergenceRecords(workspaceDir);
  if (!read.present) {
    return { present: false, total: 0, divergent: 0, byKey: [] };
  }
  const buckets = new Map<string, { count: number; example: string }>();
  let divergent = 0;
  for (const row of read.rows) {
    if (isDivergent(row)) {
      divergent += 1;
    }
    const prev = buckets.get(row.divergenceKey);
    if (prev) {
      prev.count += 1;
    } else {
      buckets.set(row.divergenceKey, {
        count: 1,
        example: row.instructionHead ?? "",
      });
    }
  }
  return {
    present: true,
    total: read.rows.length,
    divergent,
    byKey: [...buckets.entries()]
      .map(([divergenceKey, v]) => ({ divergenceKey, count: v.count, example: v.example }))
      .toSorted((a, b) => b.count - a.count),
  };
}

// ─────────────────────────────────────────────
// P2.4：分歧 → 升级
// ─────────────────────────────────────────────

/**
 * 分诊三档 → 风险档。与 `triage/rules.ts` 的 tier 语义对齐（red=必须先澄清）。
 *
 * 放在本模块而不是 `model-route.ts`：它是「让不同路径的结论变得可比」的适配逻辑，
 * 属于分歧判定的职责；路由层只负责提供原始意见。
 */
export function triageTierToRiskLevel(tier: string): string {
  if (tier === "red") {
    return "high";
  }
  if (tier === "yellow") {
    return "medium";
  }
  return "low";
}

/** 升级姿态。影子阶段只记录，不动律师界面。 */
export type RouteDivergencePosture = "off" | "shadow" | "escalate";

/**
 * 升级姿态（policy / env 决定，默认 `shadow`）：
 * - `off`：连记录都不做
 * - `shadow`（默认）：记录 + 计算「本该升级成什么」，但**不改任何行为**
 * - `escalate`：真的把分歧卡推给律师
 *
 * 为什么默认 `shadow`：P2.3 的契约是「只记录不改行为」，而 P2.4 要「真的升级」。
 * 两者不冲突——**先把升级路径算出来并记录，等分歧数据证明它不是噪声再开启**。
 * 直接默认升级会让律师在早期被大量「正则与模型打架」的卡片淹没。
 *
 * **主开关优先**：`isRouteDivergenceShadowEnabled()` 为假时这里一律返回 `off`，
 * 否则 `LAWMIND_ROUTE_DIVERGENCE=0` 会失效（它本该是「整套关掉」的出口）。
 */
export function resolveRouteDivergencePosture(opts?: {
  policy?: { routeDivergencePosture?: string; routeDivergenceShadow?: boolean } | null;
  env?: NodeJS.ProcessEnv;
}): RouteDivergencePosture {
  // 必须显式回落到 process.env —— 否则 `resolveRouteDivergencePosture()`（无参调用，
  // 生产路径就是这么调的）会让 `LAWMIND_ROUTE_DIVERGENCE_POSTURE` 完全失效。
  const env = opts?.env ?? process.env;
  if (!isRouteDivergenceShadowEnabled({ ...opts, env })) {
    return "off";
  }
  const raw = (opts?.policy?.routeDivergencePosture ?? env.LAWMIND_ROUTE_DIVERGENCE_POSTURE ?? "")
    .trim()
    .toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") {
    return "off";
  }
  if (raw === "escalate" || raw === "on" || raw === "1" || raw === "true") {
    return "escalate";
  }
  return "shadow";
}

/**
 * 分歧的升级描述符（纯函数，便于测试与 shadow 记录）。
 *
 * **不设阈值**：只要 `isDivergent` 为真就给出描述符。理由见模块头——
 * 阈值是要维护、要调参、会被人忘掉的东西；而分歧本身已经是可解释的证据。
 *
 * 返回 `undefined` 表示一致，无需升级。
 */
export type RouteDivergenceEscalation = {
  title: string;
  summary: string;
  /** 进 UI 时用；工程师语言不进律师可见面（见 `requires-action.ts` 的既有口径）。 */
  riskFlags: string[];
  recommendation: string;
  rationale: string;
  divergenceKey: string;
};

const ROUTE_KIND_LABELS_ZH: Record<string, string> = {
  "research.general": "通用检索整理",
  "research.legal": "法律专项检索",
  "research.hybrid": "联合检索整理",
  "draft.word": "生成文书",
  "draft.ppt": "生成汇报",
  "summarize.case": "案件摘要",
  "analyze.contract": "合同审查",
  "agent.instruction": "对话指令",
  unknown: "未能识别",
};

const ROUTE_RISK_LABELS_ZH: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const ROUTE_PATH_LABELS_ZH: Record<RoutePathId, string> = {
  keyword: "关键词判断",
  model: "模型判断",
  triage: "分诊规则",
};

/** 律师可读的 kind 名（未知就原样返回，不硬翻）。 */
export function routeKindLabelZh(kind: string): string {
  return ROUTE_KIND_LABELS_ZH[kind] ?? kind;
}

/**
 * 分歧 → 升级卡描述符。
 *
 * 只给「描述 + 建议」——**不替律师决定该听哪条路径**。
 * 三条路径谁对，只有律师知道；系统的职责是把不一致摆出来。
 */
export function buildRouteDivergenceEscalation(
  record: RouteDivergenceRecord,
): RouteDivergenceEscalation | undefined {
  if (!isDivergent(record)) {
    return undefined;
  }

  const lines: string[] = [];
  if (!record.kindAgreement) {
    lines.push(
      `任务类型判断不一致：${record.opinions
        .filter((o) => o.kind)
        .map((o) => `${ROUTE_PATH_LABELS_ZH[o.path]}→「${routeKindLabelZh(o.kind!)}」`)
        .join("；")}。`,
    );
  }
  if (!record.riskAgreement) {
    lines.push(
      `风险档判断不一致：${record.opinions
        .filter((o) => o.riskLevel)
        .map(
          (o) =>
            `${ROUTE_PATH_LABELS_ZH[o.path]}→${ROUTE_RISK_LABELS_ZH[o.riskLevel!] ?? o.riskLevel}`,
        )
        .join("；")}。`,
    );
  }

  const riskFlags: string[] = [];
  if (!record.kindAgreement) {
    riskFlags.push("route_kind_divergence");
  }
  if (!record.riskAgreement) {
    riskFlags.push("route_risk_divergence");
  }

  return {
    title: "本件的办理口径需要您确认",
    summary: [
      "系统用三种彼此独立的方式判断了这件的类型与风险，结论不一致：",
      ...lines.map((l) => `- ${l}`),
      "",
      "请确认按哪种口径办理；在此之前，系统不会替您选一条路继续。",
    ].join("\n"),
    riskFlags,
    recommendation: "请确认按哪种口径办理",
    rationale:
      "不同类型/风险档对应不同的核对清单与拍板姿态。口径不一致时按任一条继续，都可能把该核对的东西漏掉。",
    divergenceKey: record.divergenceKey,
  };
}
