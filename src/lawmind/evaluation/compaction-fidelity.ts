/**
 * 压缩保真度基准（compaction fidelity）——回答一个具体问题：
 *
 * > **连续压缩之后，模型还能不能读到关键事实？丢在哪一类、第几轮丢？**
 *
 * ## 为什么需要它
 *
 * 「压缩后不丢关键信息」此前只有**单次**压缩的断言，而且是我自己写的那几条。
 * 长任务不是压一次：连续压三轮时，第二、三轮的输入是上一轮的产物，任何「只保一层」
 * 的实现都会在后面静默丢掉东西。更糟的是**这类失败是静默的**——律师看不到、
 * 测试不报错，直到某次交付里引用了不在案卷里的条文，或者把期限写错。
 *
 * ## 证据等级（同 `evaluation/README.md` 的纪律：必须说清「哪层不是证据」）
 *
 * - 本基准是 **synthetic-authored**：语料与金标都由我自撰（见
 *   `compaction-fidelity-cases.ts` 的头注释）。结论**只能用于机制回归**，
 *   不能当现场证据。真实案卷的金标需要律师在真案上标一遍。
 * - 路径是**确定性**的：走真实 `autoCompactSessionHistory` + 真实重注，
 *   不调模型（所以能进 CI）。模型摘要通道是**另一个**可选开关，见下。
 *
 * ## 口径纪律（与 `metrics/README.md` 一致）
 *
 * 1. **critical 全存活才算 pass**；非 critical 只**测量**、不据此判失败——
 *    测量值本身就是诊断信息（它指出下一步该加固哪一类事实）。
 * 2. **首丢轮次**比最终存活数更有诊断价值：它告诉你「什么时候开始丢」。
 * 3. **留存体积一并报出**：不靠「囤着不放」取胜（留着不放会把模型看瞎）。
 * 4. 缺样本 → `null` / 空数组，**绝不产出 0** 冒充「没有漏网」。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyCompactReinjectionToSession } from "../agent/compact-reinjection.js";
import { autoCompactSessionHistory } from "../agent/compact.js";
import type { AgentMessage, AgentSession } from "../agent/types.js";
import type { FidelityCase, FidelityFactKind } from "./compaction-fidelity-cases.js";
import { FIDELITY_CASES } from "./compaction-fidelity-cases.js";

export type FidelityRoundReport = {
  round: number;
  droppedMessageCount: number;
  retainedMessages: number;
  retainedChars: number;
  /** 本轮结束后仍能读到的 fact id。 */
  survived: string[];
  /** 本轮**首次**丢失的 fact id（最有诊断价值的一列）。 */
  lostThisRound: string[];
};

export type FidelityKindStat = {
  kind: FidelityFactKind;
  total: number;
  survivedAllRounds: number;
};

export type FidelityReport = {
  caseId: string;
  caseTitle: string;
  /** 自证：合成语料 + 自撰金标，不得当现场证据。 */
  provenance: "synthetic-authored";
  isSynthetic: true;
  rounds: FidelityRoundReport[];
  /** fact id → 首次丢失轮次；`null` = 全程存活。 */
  firstLossRound: Record<string, number | null>;
  byKind: FidelityKindStat[];
  critical: {
    total: number;
    survivedAllRounds: number;
    /** 丢过的 critical fact id（空 = 达标）。 */
    lost: string[];
  };
  nonCritical: {
    measured: number;
    survivedAllRounds: number;
    /** 丢过的非 critical fact id：诊断用，不据此判失败。 */
    lost: string[];
  };
  /** critical 全存活 = pass。 */
  passes: boolean;
  warnings: string[];
};

export type CompactionFidelityOptions = {
  /** 连压几轮。默认 4（覆盖「第 2–4 轮输入是上一轮产物」这条链）。 */
  rounds?: number;
  /** 压缩保留条数；小值让压力更真实。默认 8。 */
  maxHistoryMessages?: number;
  /** 每轮追加的律师推进条数（用于把「末 N 条」窗口推走）。默认 12。 */
  fillerTurns?: number;
  /**
   * 可选：模型摘要增强（非确定性通道）。给了就走它，报告会标 `usedModelDigest`。
   * CI 不传，因此默认路径是确定性的。
   */
  enhanceDigest?: (input: {
    extractiveDigest: string;
    dropped: AgentMessage[];
  }) => Promise<string | undefined> | string | undefined;
};

/** 把语料铺成一条会话：开场交办 + 逐轮推进。 */
function buildSession(caseFile: FidelityCase, fillerTurns: number): AgentSession {
  const now = Date.now();
  const ts = (i: number): string => new Date(now + i * 1000).toISOString();
  const history: AgentMessage[] = [
    { role: "system", content: "sys", timestamp: ts(0) },
    { role: "user", content: caseFile.openingInstruction, timestamp: ts(1) },
  ];
  let i = 2;
  for (const turn of caseFile.turns) {
    history.push({ role: "user", content: turn.user, timestamp: ts(i++) });
    history.push({ role: "assistant", content: turn.assistant, timestamp: ts(i++) });
    // 每轮之间插填充：把「末 N 条」要点窗口彻底推走，避免关键事实靠搭车存活（假绿）。
    for (let f = 0; f < fillerTurns; f += 1) {
      history.push({
        role: "user",
        content: `（推进 ${f + 1}）请继续按前述要求推进，并逐条核对期限与金额。`,
        timestamp: ts(i++),
      });
      history.push({
        role: "assistant",
        content: `（推进 ${f + 1}）已核对，按前述标准继续，偏差处已标注来源条款。`,
        timestamp: ts(i++),
      });
    }
  }
  return {
    sessionId: `s-fidelity-${caseFile.id}`,
    actorId: "lawyer",
    turns: [],
    matterId: caseFile.matterId,
    conversationHistory: history,
    createdAt: ts(0),
    updatedAt: ts(0),
  };
}

const ARCHIVE_PATH_RE = /sessions\/[A-Za-z0-9._-]+\.drops\/[A-Za-z0-9._-]+\.json/g;

/**
 * 提示正文，加上提示里点名的归档（以及归档里再点到的归档）。
 * 归档正文不注入提示；模型按路径用工具回读。原串被改写了、文件里也没有，才算丢。
 */
function readableText(session: AgentSession, workspaceDir: string): string {
  const chunks = [session.conversationHistory.map((m) => m.content ?? "").join("\n")];
  const seen = new Set<string>();
  let guard = 0;
  for (let i = 0; i < chunks.length && guard < 8; i += 1) {
    guard += 1;
    for (const match of chunks[i]?.matchAll(new RegExp(ARCHIVE_PATH_RE.source, "g")) ?? []) {
      const rel = match[0];
      if (!rel || seen.has(rel)) {
        continue;
      }
      seen.add(rel);
      try {
        chunks.push(fs.readFileSync(path.join(workspaceDir, rel), "utf8"));
      } catch {
        /* 路径写了但文件没落成，这条事实就不算可回读 */
      }
    }
  }
  return chunks.join("\n");
}

/** 留存历史或归档里能读到的 fact（**原串子串匹配**——被改写了一样算丢）。 */
function survivedIds(
  session: AgentSession,
  caseFile: FidelityCase,
  workspaceDir: string,
): string[] {
  const text = readableText(session, workspaceDir);
  return caseFile.facts.filter((f) => text.includes(f.text)).map((f) => f.id);
}

function retainedChars(session: AgentSession): number {
  return session.conversationHistory.reduce((n, m) => n + (m.content?.length ?? 0), 0);
}

export async function runCompactionFidelity(
  caseFile: FidelityCase,
  opts?: CompactionFidelityOptions,
): Promise<FidelityReport> {
  const rounds = Math.max(1, opts?.rounds ?? 4);
  const maxHistoryMessages = opts?.maxHistoryMessages ?? 8;
  const fillerTurns = opts?.fillerTurns ?? 12;
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fidelity-"));
  const warnings: string[] = [];
  const session = buildSession(caseFile, fillerTurns);
  // ── 装配自检（fail loudly）──────────────────────────────────────────
  // 金标串必须在初始历史里**真的出现**。否则基准在测空气：那条 fact 永远「丢」，
  // 而 `firstLossRound` 会因为「从未存活过」而留下 null，看起来像「全程存活」。
  // 实测踩过：原文写「第23条与第24条」而金标串是「《劳动合同法》第24条」，不构成子串。
  const initialSurvived = new Set(survivedIds(session, caseFile, workspaceDir));
  const missingFromFixture = caseFile.facts.filter((f) => !initialSurvived.has(f.id));
  if (missingFromFixture.length > 0) {
    throw new Error(
      `压缩保真度语料装配错误：下列金标串在初始历史里不存在，基准无法测量 —— ${missingFromFixture
        .map((f) => `${f.id}(${f.text})`)
        .join("、")}`,
    );
  }
  const roundsReport: FidelityRoundReport[] = [];
  const firstLossRound: Record<string, number | null> = Object.fromEntries(
    caseFile.facts.map((f) => [f.id, null]),
  );
  let everSurvived = new Set(survivedIds(session, caseFile, workspaceDir));

  try {
    for (let round = 1; round <= rounds; round += 1) {
      // 再推进一轮（保证每轮都有新内容可取，且把旧内容往外推）。
      for (let f = 0; f < fillerTurns; f += 1) {
        session.conversationHistory.push(
          {
            role: "user",
            content: `（第 ${round} 轮新增 ${f + 1}）继续核对并推进。`,
            timestamp: new Date().toISOString(),
          },
          {
            role: "assistant",
            content: `（第 ${round} 轮答复 ${f + 1}）已按前述标准核对。`,
            timestamp: new Date().toISOString(),
          },
        );
      }

      const result = autoCompactSessionHistory(session, workspaceDir, {
        maxHistoryMessages,
      });
      if (!result.compacted) {
        warnings.push(`第 ${round} 轮没有触发压缩：基准退化（结果不可用）`);
      }
      session.conversationHistory = result.messages;
      // 生产序列：压缩 → 置重注标记 → 应用重注（回合开始走 turn-orchestrator，
      // 回合内走 mid-turn-compact）。不变量必须断言在**生产序列**上。
      session.needsCompactReinjection = true;
      applyCompactReinjectionToSession(session, {
        mandatoryRulesActive: true,
        ...(opts?.enhanceDigest ? {} : {}),
      });

      if (opts?.enhanceDigest && result.droppedDigest && result.droppedSpan?.length) {
        const digest = (
          await opts.enhanceDigest({
            extractiveDigest: result.droppedDigest,
            dropped: result.droppedSpan,
          })
        )?.trim();
        if (digest) {
          const { replaceDroppedDigestInMessages } = await import("../agent/compact-llm-digest.js");
          session.conversationHistory = replaceDroppedDigestInMessages(
            session.conversationHistory,
            digest,
          );
        }
      }

      const nowSurvived = new Set(survivedIds(session, caseFile, workspaceDir));
      const lostThisRound = [...everSurvived].filter((id) => !nowSurvived.has(id));
      for (const id of lostThisRound) {
        if (firstLossRound[id] === null) {
          firstLossRound[id] = round;
        }
      }
      everSurvived = nowSurvived;
      roundsReport.push({
        round,
        droppedMessageCount: result.droppedMessageCount ?? 0,
        retainedMessages: session.conversationHistory.length,
        retainedChars: retainedChars(session),
        survived: [...nowSurvived].toSorted(),
        lostThisRound: lostThisRound.toSorted(),
      });
    }
  } finally {
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  const finalSurvived = new Set(roundsReport[roundsReport.length - 1]?.survived ?? []);
  const kinds = [...new Set(caseFile.facts.map((f) => f.kind))];
  const byKind: FidelityKindStat[] = kinds
    .map((kind) => {
      const ofKind = caseFile.facts.filter((f) => f.kind === kind);
      return {
        kind,
        total: ofKind.length,
        survivedAllRounds: ofKind.filter((f) => finalSurvived.has(f.id)).length,
      };
    })
    .toSorted((a, b) => a.kind.localeCompare(b.kind));

  const criticalFacts = caseFile.facts.filter((f) => f.critical);
  const nonCriticalFacts = caseFile.facts.filter((f) => !f.critical);
  const criticalLost = criticalFacts.filter((f) => !finalSurvived.has(f.id)).map((f) => f.id);
  const nonCriticalLost = nonCriticalFacts.filter((f) => !finalSurvived.has(f.id)).map((f) => f.id);

  warnings.push(
    "合成语料 + 自撰金标：结论只用于机制回归，不能当现场证据（真实评测集需律师在真案上标注）。",
  );

  return {
    caseId: caseFile.id,
    caseTitle: caseFile.title,
    provenance: caseFile.provenance,
    isSynthetic: true,
    rounds: roundsReport,
    firstLossRound,
    byKind,
    critical: {
      total: criticalFacts.length,
      survivedAllRounds: criticalFacts.length - criticalLost.length,
      lost: criticalLost,
    },
    nonCritical: {
      measured: nonCriticalFacts.length,
      survivedAllRounds: nonCriticalFacts.length - nonCriticalLost.length,
      lost: nonCriticalLost,
    },
    passes: criticalLost.length === 0 && !warnings.some((w) => w.includes("基准退化")),
    warnings,
  };
}

/** 遍历全部语料。 */
export async function runAllCompactionFidelity(
  opts?: CompactionFidelityOptions,
): Promise<FidelityReport[]> {
  const out: FidelityReport[] = [];
  for (const c of FIDELITY_CASES) {
    out.push(await runCompactionFidelity(c, opts));
  }
  return out;
}

/** 给律师 / 运维读的一页纸。 */
export function buildFidelityReportMarkdown(reports: readonly FidelityReport[]): string {
  const lines: string[] = [
    "# 压缩保真度报告（合成语料）",
    "",
    "> **这不是现场证据。** 语料与金标均为自撰合成，仅用于机制回归；真实评测集需律师在真案上标注关键事实。",
    "",
  ];
  for (const r of reports) {
    lines.push(
      `## ${r.caseTitle}（\`${r.caseId}\`）`,
      "",
      `- 结论：**${r.passes ? "通过" : "未通过"}**（critical 存活 ${r.critical.survivedAllRounds}/${r.critical.total}）`,
      `- 非关键事实（仅测量）：存活 ${r.nonCritical.survivedAllRounds}/${r.nonCritical.measured}`,
      "",
      "| 轮 | 丢弃 | 留存消息 | 留存字符 | 本轮首丢 |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const round of r.rounds) {
      lines.push(
        `| ${round.round} | ${round.droppedMessageCount} | ${round.retainedMessages} | ${round.retainedChars} | ${
          round.lostThisRound.length > 0 ? round.lostThisRound.join("、") : "—"
        } |`,
      );
    }
    if (r.critical.lost.length > 0) {
      lines.push("", `**丢失的关键事实**：${r.critical.lost.join("、")}`);
    }
    if (r.nonCritical.lost.length > 0) {
      lines.push("", `待加固（非关键，仅诊断）：${r.nonCritical.lost.join("、")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
