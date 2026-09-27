/**
 * G1 cassette：**判定分级的「请求体」断言**。
 *
 * 契约（`AGENTS.md`）：断言**下一个请求体**里有什么，不断言提示词文案。
 * 这里断言的"请求体"是 Guardian 侧车调用的 user message —— 它由
 * `formatGuardianEvidenceUserMessage(pack)` 生成，而 `pack.checklist.items`
 * 就是「本次要模型判哪几项」的**唯一**真相。
 *
 * 为什么这组断言是准入证：
 * 判级改造的全部价值就是**改变模型看到什么**。如果只断言 verdict，那么
 * 「machine 项其实还在提示词里」这种错误永远测不出来——verdict 依然会是对的。
 *
 * 使用的样例族：`采购供货`（19 项）。核对项不再按条数截断，分级只决定谁来判。
 *   - machine：`pr.deposit`（定金上限）、`pr.dispute`（争议解决形式）
 *   - lawyer ：`pr.inspect`（检验期限）、`pr.cap`（责任上限）
 *   - 其余为 judge
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../agent/types.js";
import { persistDraft } from "../drafts/index.js";
import { writeRedlineProposal } from "../drafts/redline-proposal.js";
import type { ArtifactDraft } from "../types.js";
import { buildGuardianEvidencePack } from "./legal-guardian.js";
import { runLegalGuardian, runLegalGuardianForTrackedDraft } from "./run.js";

const tmp: string[] = [];
const ENV_KEY = "LAWMIND_JUDGMENT_TIERING";
const ESCALATION_KEY = "LAWMIND_JUDGMENT_ESCALATION";
const DISABLED_KEY = "LAWMIND_JUDGMENT_DISABLED_VERIFIERS";
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {
    [ENV_KEY]: process.env[ENV_KEY],
    [ESCALATION_KEY]: process.env[ESCALATION_KEY],
    [DISABLED_KEY]: process.env[DISABLED_KEY],
  };
  delete process.env[ENV_KEY];
  delete process.env[ESCALATION_KEY];
  delete process.env[DISABLED_KEY];
});

afterEach(() => {
  for (const key of [ENV_KEY, ESCALATION_KEY, DISABLED_KEY]) {
    const prev = savedEnv[key];
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
  for (const d of tmp) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmp.length = 0;
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-tier-cassette-"));
  tmp.push(ws);
  return ws;
}

/** 采购供货族的稿子：`改稿类型` / `己方立场` 标记由 `resolveWordRevisionChecklist` 解析。 */
function procurementDraft(): ArtifactDraft {
  return {
    taskId: "t-tier",
    title: "改稿类型：采购供货\n己方立场：甲方",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.review",
    summary: "采购合同改稿",
    sections: [{ heading: "争议解决", body: "由上海仲裁委员会仲裁解决。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: "2026-09-21T00:00:00.000Z",
    contractEdit: { baselineRelativePath: "cases/m1/a.docx", mode: "surgical" },
  };
}

const HUNKS = [
  {
    hunkId: "h1",
    sectionIndex: 0,
    sectionHeading: "争议解决",
    before: "由甲方所在地人民法院诉讼解决。",
    after: "由上海仲裁委员会仲裁解决。",
    status: "pending" as const,
    granularity: "surgical" as const,
  },
];

/** 捕获送给审稿员的 user message（= 证据包 JSON），并回一个全部通过的逐项答案。 */
function capturingCaller(captured: { user: string; calls: number }) {
  return async ({ user }: { system: string; user: string }): Promise<string> => {
    captured.calls += 1;
    captured.user = user;
    return JSON.stringify({ items: [], summaryGaps: [] });
  };
}

/** 证据包 JSON 里是否出现了某一检查项（`"id": "<itemId>"`）。 */
function packHasItem(userMessage: string, itemId: string): boolean {
  return userMessage.includes(`"id": "${itemId}"`);
}

async function runTracked(
  ws: string,
  captured: { user: string; calls: number },
): Promise<{ calls: number; user: string }> {
  const draft = procurementDraft();
  persistDraft(ws, draft);
  writeRedlineProposal(ws, {
    taskId: "t-tier",
    baselineSections: [{ heading: "争议解决", body: "由甲方所在地人民法院诉讼解决。" }],
    hunks: HUNKS,
    updatedAt: new Date().toISOString(),
  });
  const ctx: AgentContext = {
    workspaceDir: ws,
    sessionId: "s",
    actorId: "tier-cassette",
    guardianCaller: capturingCaller(captured),
  };
  await runLegalGuardianForTrackedDraft({
    workspaceDir: ws,
    draft,
    hunks: HUNKS,
    allowEmptyRedline: false,
    ctx,
  });
  return captured;
}

describe("G1 cassette：判定分级改变模型看到什么", () => {
  it("off：machine 项**仍在**提示词里（等价于改造前，零行为变化）", async () => {
    process.env[ENV_KEY] = "off";
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    expect(captured.calls).toBe(1);
    // off = 全部按 judge 走 → machine 项与 judge 项一样进提示词。
    expect(packHasItem(captured.user, "pr.deposit")).toBe(true);
    expect(packHasItem(captured.user, "pr.pay")).toBe(true);
  });

  it("shadow（默认）：machine 项**仍在**提示词里 —— 否则测不出一致率", async () => {
    // 不设 env，走缺省 shadow。
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    expect(captured.calls).toBe(1);
    expect(packHasItem(captured.user, "pr.deposit")).toBe(true);
    expect(packHasItem(captured.user, "pr.pay")).toBe(true);
  });

  it("on：machine 项**不在**提示词里；judge 项仍在", async () => {
    process.env[ENV_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    expect(captured.calls).toBe(1);
    // machine 项由代码判 → 不占用提示词。
    expect(packHasItem(captured.user, "pr.deposit")).toBe(false);
    expect(packHasItem(captured.user, "pr.dispute")).toBe(false);
    // judge 项照旧交给模型。
    expect(packHasItem(captured.user, "pr.pay")).toBe(true);
    expect(packHasItem(captured.user, "pr.subject")).toBe(true);
  });

  it("核对项不按条数截断：尾部 judge 项在 off 和 on 都进提示词", async () => {
    const wsOff = tmpWs();
    const offCaptured = { user: "", calls: 0 };
    process.env[ENV_KEY] = "off";
    await runTracked(wsOff, offCaptured);
    expect(packHasItem(offCaptured.user, "pr.force")).toBe(true);
    expect(packHasItem(offCaptured.user, "pr.license")).toBe(true);

    const wsOn = tmpWs();
    const onCaptured = { user: "", calls: 0 };
    process.env[ENV_KEY] = "on";
    await runTracked(wsOn, onCaptured);
    expect(packHasItem(onCaptured.user, "pr.force")).toBe(true);
  });

  it("on + 升级通道未开启：lawyer 项**仍留在**提示词里（不得静默消失）", async () => {
    process.env[ENV_KEY] = "on";
    // 不设 LAWMIND_JUDGMENT_ESCALATION → 升级卡尚未上线。
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    // lawyer 项既不被 machine 判、又没有升级卡承接 → 必须继续问模型。
    expect(packHasItem(captured.user, "pr.inspect")).toBe(true);
    expect(packHasItem(captured.user, "pr.cap")).toBe(true);
  });

  it("on + 升级通道开启：lawyer 项**移出**提示词（交给升级卡）", async () => {
    process.env[ENV_KEY] = "on";
    process.env[ESCALATION_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    expect(packHasItem(captured.user, "pr.inspect")).toBe(false);
    expect(packHasItem(captured.user, "pr.cap")).toBe(false);
    // machine / judge 的行为不受升级通道影响。
    expect(packHasItem(captured.user, "pr.deposit")).toBe(false);
    expect(packHasItem(captured.user, "pr.pay")).toBe(true);
  });

  it("on + 验证器被停用：该项**降回 judge 并重新进提示词**（fail-closed 方向）", async () => {
    process.env[ENV_KEY] = "on";
    process.env[DISABLED_KEY] = "statute.deposit_cap";
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    // 停用后不再由代码判，但**必须**回到模型手里——不是失效放行。
    expect(packHasItem(captured.user, "pr.deposit")).toBe(true);
    // 未停用的 machine 项照旧不进提示词。
    expect(packHasItem(captured.user, "pr.dispute")).toBe(false);
  });

  it("**回归**：shadow + 升级通道开 → lawyer 项**不得**被偷走（shadow 零行为变化）", async () => {
    process.env[ENV_KEY] = "shadow";
    process.env[ESCALATION_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    // shadow 只记录一致率，绝不改变模型看到的东西——哪怕升级通道已接通。
    expect(packHasItem(captured.user, "pr.inspect")).toBe(true);
    expect(packHasItem(captured.user, "pr.cap")).toBe(true);
    // shadow 下 machine 项也照常在提示词里。
    expect(packHasItem(captured.user, "pr.deposit")).toBe(true);
  });

  it("**回归**：off + 升级通道开 → 与改造前逐字一致（lawyer 项仍在提示词）", async () => {
    process.env[ENV_KEY] = "off";
    process.env[ESCALATION_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    expect(packHasItem(captured.user, "pr.inspect")).toBe(true);
    expect(packHasItem(captured.user, "pr.deposit")).toBe(true);
  });

  it("off / shadow / on：checklist 里的项全部带上了 tier（模型能看见每项由谁判）", async () => {
    process.env[ENV_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(tmpWs(), captured);
    expect(captured.user).toContain('"tier": "judge"');
  });

  /**
   * 策略文件那一档（`policy` 显式 → env → 缺省 的第一档）。
   *
   * 这里与 `agent/judgment-escalation-cassette.test.ts` 的「策略文件档」是一对：
   * 收尾侧决定**卡片上不上**，Guardian 侧决定**项摘不摘**。两者必须读同一份输入，
   * 否则会出现「按策略通道算开 → 项被摘走，但另一侧按 env 算关 → 不产卡」，
   * 主观项既不进提示词也不上卡，静默消失。
   */
  function writePolicy(ws: string, policy: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, ...policy }, null, 2),
      "utf8",
    );
  }

  it("策略文件里的 judgmentTiering 不再生效，以环境变量为准", async () => {
    const ws = tmpWs();
    writePolicy(ws, { judgmentTiering: "off" });
    process.env[ENV_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(ws, captured);
    expect(captured.calls).toBe(1);
    expect(packHasItem(captured.user, "pr.deposit")).toBe(false);
    expect(packHasItem(captured.user, "pr.pay")).toBe(true);
  });

  it("环境变量 judgmentTiering=on 时 machine 项不进提示词", async () => {
    const ws = tmpWs();
    process.env[ENV_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(ws, captured);
    expect(packHasItem(captured.user, "pr.deposit")).toBe(false);
    expect(packHasItem(captured.user, "pr.pay")).toBe(true);
  });

  it("环境变量通道 on + tiering on → lawyer 项移出提示词", async () => {
    const ws = tmpWs();
    process.env[ENV_KEY] = "on";
    process.env[ESCALATION_KEY] = "on";
    const captured = { user: "", calls: 0 };
    await runTracked(ws, captured);
    expect(packHasItem(captured.user, "pr.inspect")).toBe(false);
    expect(packHasItem(captured.user, "pr.cap")).toBe(false);
    expect(packHasItem(captured.user, "pr.pay")).toBe(true);
  });

  it("环境变量停用验证器后该项降回 judge 并回到提示词", async () => {
    const ws = tmpWs();
    process.env[ENV_KEY] = "on";
    process.env[DISABLED_KEY] = "statute.deposit_cap";
    const captured = { user: "", calls: 0 };
    await runTracked(ws, captured);
    expect(packHasItem(captured.user, "pr.deposit")).toBe(true);
    expect(packHasItem(captured.user, "pr.dispute")).toBe(false);
  });
});

describe("G1 cassette：没有 judge 项时**不调用模型**（成本兑现点）", () => {
  it("全部项由 machine 判 + 全部通过 → 不调模型，verdict 直接 pass", async () => {
    const ws = tmpWs();
    let reviewerCalls = 0;
    const pack = buildGuardianEvidencePack({
      draft: procurementDraft(),
      hunks: HUNKS,
      allowEmptyRedline: false,
      // 空检查单 = 没有 judge 项要问。
      checklist: { family: "采购供货", items: [] },
    });
    const record = await runLegalGuardian({
      pack,
      taskId: "t-no-judge",
      workspaceDir: ws,
      callReviewer: async () => {
        reviewerCalls += 1;
        return JSON.stringify({ items: [], summaryGaps: [] });
      },
      machine: {
        verdicts: [
          { itemId: "pr.deposit", supported: true, reason: "未超过法定上限", status: "ok" },
        ],
        affectsOutcome: true,
      },
    });
    expect(reviewerCalls).toBe(0);
    expect(record.verdict).toBe("pass");
  });

  it("全部项由 machine 判 + 其中一项未覆盖 → 不调模型，verdict 直接 fail", async () => {
    const ws = tmpWs();
    let reviewerCalls = 0;
    const pack = buildGuardianEvidencePack({
      draft: procurementDraft(),
      hunks: HUNKS,
      allowEmptyRedline: false,
      checklist: { family: "采购供货", items: [] },
    });
    const record = await runLegalGuardian({
      pack,
      taskId: "t-no-judge-fail",
      workspaceDir: ws,
      callReviewer: async () => {
        reviewerCalls += 1;
        return JSON.stringify({ items: [], summaryGaps: [] });
      },
      machine: {
        verdicts: [
          { itemId: "pr.deposit", supported: false, reason: "定金比例超过法定上限", status: "ok" },
        ],
        affectsOutcome: true,
      },
    });
    expect(reviewerCalls).toBe(0);
    expect(record.verdict).toBe("fail");
    expect(record.gaps.map((g) => g.code)).toContain("machine_not_covered");
  });
});
