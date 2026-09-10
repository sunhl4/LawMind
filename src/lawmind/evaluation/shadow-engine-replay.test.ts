/**
 * 真影子回放（engine-scripted-model）机制测试：
 *   - 引擎真实执行：断言工具被真实调用、草稿来自 persisted draft 而非 fixture 静态串；
 *   - 报告数字反映引擎产出：召回允许 <1，不被构造锁死；
 *   - 真模型通道保持在 env/flag 门后。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isShadowRealModelEnabled,
  runEngineShadowReplay,
  runEngineShadowReplayCase,
} from "./shadow-engine-replay.js";
import {
  BUILTIN_SHADOW_FIXTURES,
  defaultShadowModelScript,
  type ShadowReplayFixture,
} from "./shadow-replay.js";

beforeEach(() => {
  // 检索/真模型相关 env 一律置空：回放测试必须离线确定（CI 不依赖真模型）。
  for (const key of [
    "LAWMIND_SHADOW_REAL_MODEL",
    "LAWMIND_AGENT_BASE_URL",
    "LAWMIND_AGENT_API_KEY",
    "LAWMIND_AGENT_MODEL",
    "LAWMIND_QWEN_BASE_URL",
    "LAWMIND_QWEN_API_KEY",
    "LAWMIND_QWEN_MODEL",
    "QWEN_BASE_URL",
    "QWEN_API_KEY",
    "QWEN_MODEL",
  ]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("engine shadow replay (engine-scripted-model)", () => {
  it("runs every builtin fixture through the real runTurn pipeline", async () => {
    const report = await runEngineShadowReplay(BUILTIN_SHADOW_FIXTURES);
    expect(report.summary.draftSource).toBe("engine-scripted-model");
    expect(report.summary.modelMode).toBe("scripted");
    expect(report.summary.failed).toBe(0);
    expect(report.summary.cases).toBe(BUILTIN_SHADOW_FIXTURES.length);
    expect(report.summary.reportZh).toContain("engine-scripted-model");
    expect(report.summary.reportZh).toContain("非 fixture 静态串");

    for (const row of report.results) {
      // 机制断言：工具被真实调用，草稿来自持久化 draft。
      expect(row.status).toBe("ok");
      expect(row.toolCallsExecuted).toBeGreaterThanOrEqual(2);
      expect(row.toolsCalled).toContain("draft_document");
      expect(row.toolsCalled).toContain("update_draft");
      expect(row.draftChannel).toBe("persisted-draft");
      expect(row.draftTaskId).toBeTruthy();
      expect(row.engineDraftText.length).toBeGreaterThan(0);
    }

    // 真实澄清门禁至少在一个案子里被触发并按流程放行。
    expect(report.results.some((row) => row.clarificationTurns > 0)).toBe(true);

    // 真实数字：基于引擎产出的召回（本批 cassette 均写入植入缺陷文本 → 1；
    // 该数字由真实 lint 计算，不是构造保证——见下方反向用例）。
    const deposit = report.results.find((row) => row.id === "shadow-deposit-30");
    expect(deposit?.plantedDefectRecall).toBe(1);
    expect(deposit?.hitRuleIds).toContain("statutory.deposit_cap");
    expect(deposit?.engineDraftText).toContain("30%");
    const arb = report.results.find((row) => row.id === "shadow-or-arbitrate");
    expect(arb?.plantedDefectRecall).toBe(1);
    expect(arb?.hitRuleIds).toContain("form.or_arbitrate_or_sue");
    const clean = report.results.find((row) => row.id === "shadow-clean-nda");
    expect(clean?.plantedDefectRecall).toBeNull();
    expect(report.summary.defectRecall).toBeGreaterThanOrEqual(0);
    expect(report.summary.defectRecall).toBeLessThanOrEqual(1);
  }, 180_000);

  it("report reflects engine output, not the fixture static string", async () => {
    const fixture: ShadowReplayFixture = {
      id: "engine-vs-static",
      instruction: "请审查买卖合同定金条款。",
      lawyerFinalText: "第一条 定金为本合同标的额的百分之十。",
      engineDraftText: "STATIC_MARKER_静态串不应进入报告",
      plantedDefectRuleIds: ["statutory.deposit_cap"],
      modelScript: [
        { tool: "draft_document", args: { instruction: "$instruction" } },
        {
          tool: "update_draft",
          args: {
            task_id: "$lastDraftTaskId",
            sections: [{ heading: "回放草稿", body: "第一条 定金为本合同标的额的 30%。" }],
          },
        },
      ],
    };
    const row = await runEngineShadowReplayCase(fixture);
    expect(row.status).toBe("ok");
    expect(row.engineDraftText).toContain("30%");
    expect(row.engineDraftText).not.toContain("STATIC_MARKER");
    expect(row.plantedDefectRecall).toBe(1);
  }, 60_000);

  it("recall is not constructor-guaranteed: clean cassette text or unknown rule yields 0", async () => {
    const cleanCassette: ShadowReplayFixture = {
      id: "engine-clean-miss",
      instruction: "请审查买卖合同定金条款。",
      lawyerFinalText: "第一条 定金为本合同标的额的百分之十。",
      // cassette 写入合规文本：植入规则不在引擎产出里 → 召回必须为 0。
      engineDraftText: "第一条 定金为本合同标的额的百分之十。",
      plantedDefectRuleIds: ["statutory.deposit_cap"],
      modelScript: defaultShadowModelScript(),
    };
    const unknownRule: ShadowReplayFixture = {
      id: "engine-unknown-rule",
      instruction: "请审查买卖合同定金条款。",
      lawyerFinalText: "第一条 定金为本合同标的额的百分之十。",
      engineDraftText: "第一条 定金为本合同标的额的 30%。",
      // 规则集里不存在该 id：召回必须反映真实规则集而非 fixture 声明。
      plantedDefectRuleIds: ["rule.does_not_exist"],
      modelScript: defaultShadowModelScript(),
    };
    const report = await runEngineShadowReplay([cleanCassette, unknownRule]);
    const miss = report.results.find((row) => row.id === "engine-clean-miss");
    const unknown = report.results.find((row) => row.id === "engine-unknown-rule");
    expect(miss?.status).toBe("ok");
    expect(miss?.plantedDefectRecall).toBe(0);
    expect(unknown?.status).toBe("ok");
    expect(unknown?.plantedDefectRecall).toBe(0);
    // 汇总召回为真实均值（0），不再恒 1。
    expect(report.summary.defectRecall).toBe(0);
  }, 120_000);

  it("skips fixtures without a modelScript (no fabricated draft source)", async () => {
    const noScript: ShadowReplayFixture = {
      id: "no-script",
      instruction: "请审查买卖合同。",
      lawyerFinalText: "买卖合同。",
      engineDraftText: "买卖合同。",
    };
    const report = await runEngineShadowReplay([noScript]);
    expect(report.results[0]?.status).toBe("no-script");
    expect(report.summary.cases).toBe(0);
    expect(report.summary.skipped).toBe(1);
    expect(report.summary.draftSource).toBe("engine-scripted-model");
  });

  it("keeps the real channel behind the env/flag gate", async () => {
    expect(isShadowRealModelEnabled()).toBe(false);
    const fixture: ShadowReplayFixture = {
      id: "real-gated",
      instruction: "请审查买卖合同定金条款。",
      lawyerFinalText: "第一条 定金为本合同标的额的百分之十。",
      engineDraftText: "第一条 定金为本合同标的额的 30%。",
      modelScript: defaultShadowModelScript(),
    };
    // realModel 打开但模型 env 缺失：显式报错，不静默退回 cassette、不伪造产出。
    const row = await runEngineShadowReplayCase(fixture, { realModel: true });
    expect(row.status).toBe("error");
    expect(row.error).toContain("LAWMIND_AGENT");
    expect(row.engineDraftText).toBe("");
  });
});
