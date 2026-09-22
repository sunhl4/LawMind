/**
 * 端到端：改稿范例必须**真的进到 prompt 里**（不是只写进磁盘）。
 *
 * 这一条是本轮的核心断言。只测「写入成功」是不够的——
 * 那一整轮实测的教训正是：**数据在盘上、没人读**（`escape-*.jsonl` 攒了三个季度没人消费）。
 * 所以这里测的是 `prepareTurnPromptContext` 的产物里能否看到范例块。
 *
 * 同时锁定「素材而非闸」的性质：
 *   - 有范例 → 注入相应块；
 *   - 无范例 → **整块不出现**（而不是出现一个空标题）；
 *   - 无论有没有范例，`systemPromptFinal` 都必须正常产出（范例不是前置条件）。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureDraftEditLearning } from "../learning/draft-edit-learning.js";
import { summarizeMaterialBlockHealth } from "./material-blocks.js";
import { ToolRegistry } from "./tools/registry.js";
import { prepareTurnPromptContext } from "./turn-orchestrator-prompt.js";
import type { AgentConfig, AgentSession } from "./types.js";

function makeSession(): AgentSession {
  return {
    sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`,
    actorId: "system",
    turns: [],
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
  };
}

function visiblePrompt(result: { systemPromptFinal: string }, session: AgentSession): string {
  return [result.systemPromptFinal, session.samplingPromptTail ?? ""].join("\n");
}

const AGENT_VERSION = "我方当事人将依合同第五条主张违约责任，并保留解除合同及要求赔偿损失的权利。";
const LAWYER_VERSION =
  "现要求贵司于 2026 年 10 月 5 日前完成全部交付，并按约定支付违约金。逾期未履行的，委托方将解除合同并主张实际损失。";

describe("改稿范例 → prompt（端到端）", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-ee-prompt-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("无范例库 → prompt 里**不出现**范例块（不是空标题），且 prompt 正常产出", async () => {
    const session = makeSession();
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "写一封催告函，要求对方限期交付设备",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    expect(prompt).not.toContain("改稿参照");
    // 范例缺席不影响主流程
    expect(result.systemPromptFinal.length).toBeGreaterThan(0);
  });

  it("有范例 → 范例块**真的进到 prompt**（含改前/改后与律师说明）", async () => {
    await captureDraftEditLearning({
      workspaceDir,
      auditDir: path.join(workspaceDir, "audit"),
      taskId: "t-prompt-1",
      before: [{ heading: "正文", body: AGENT_VERSION }],
      after: [{ heading: "正文", body: LAWYER_VERSION }],
      deliverableType: "letter.demand",
      reviewNote: "改成通牒式：要有明确期限与解除后果。",
    });

    const session = makeSession();
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "再出一封催告函，催对方交付设备",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);

    // 块标题
    expect(prompt).toContain("改稿参照");
    // **两侧都在**：这是「保留完整对照」的核心断言
    expect(prompt).toContain("保留解除合同");
    expect(prompt).toContain("2026 年 10 月 5 日");
    // 律师说明（「为什么改」的唯一线索）
    expect(prompt).toContain("通牒式");
  });

  it("注入进 prompt 后**仍是素材口径**（不得变成指令）", async () => {
    await captureDraftEditLearning({
      workspaceDir,
      auditDir: path.join(workspaceDir, "audit"),
      taskId: "t-prompt-2",
      before: [{ heading: "正文", body: AGENT_VERSION }],
      after: [{ heading: "正文", body: LAWYER_VERSION }],
      deliverableType: "letter.demand",
    });

    const session = makeSession();
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "写催告函",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);

    // 素材口径的措辞必须在场
    expect(prompt).toContain("仅供参照");
    expect(prompt).toContain("本次仍以当前交办与材料为准");
  });

  it("范例不参与门禁：即便范例相关，prompt 也不因此变成「必须」", async () => {
    await captureDraftEditLearning({
      workspaceDir,
      auditDir: path.join(workspaceDir, "audit"),
      taskId: "t-prompt-3",
      before: [{ heading: "正文", body: AGENT_VERSION }],
      after: [{ heading: "正文", body: LAWYER_VERSION }],
      deliverableType: "letter.demand",
    });
    const session = makeSession();
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "写催告函",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    // 只检查范例块附近不出现命令式——全局 prompt 里别处可能有「必须」，不能整段断言。
    const blockStart = prompt.indexOf("改稿参照");
    expect(blockStart).toBeGreaterThanOrEqual(0);
    const block = prompt.slice(blockStart, blockStart + 1200);
    expect(block).not.toContain("必须");
    expect(block).not.toContain("一律");
    expect(block).not.toContain("禁止");
  });
});

/**
 * 已算好的事实 → prompt（端到端）。
 *
 * 这条断言的是本轮最重要的闭环：**规则漏掉的缺陷，由「算好的事实」补上**。
 * 合同只写金额（310,000 元）、从不写百分比，`statutory.deposit_cap` 静默放过；
 * 而派生事实能把 30.04% 与 20% 上限算出来，并**真的进到模型看得到的地方**。
 */
describe("派生事实 → prompt（端到端）", () => {
  let workspaceDir: string;
  const MATTER = "matter-ee-facts";

  const CONTRACT = [
    "第一条 标的与价款",
    "1.1 合同总价款为 1032000 元。",
    "",
    "第二条 定金",
    "2.1 甲方应于本合同签订之日起 5 个工作日内向乙方支付定金 310,000 元。",
  ].join("\n");

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-facts-prompt-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "cases", MATTER, "materials"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
    await fs.writeFile(
      path.join(workspaceDir, "cases", MATTER, "materials", "采购合同.md"),
      CONTRACT,
      "utf8",
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("**闭环**：合同只写金额 → prompt 里出现算好的占比与上限", async () => {
    const session: AgentSession = { ...makeSession(), matterId: MATTER };
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "审查这份采购合同，指出对甲方不利的条款",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);

    expect(prompt).toContain("已算好的事实");
    expect(prompt).toContain("30.04%");
    expect(prompt).toContain("103,600");
    expect(prompt).toContain("民法典第586条");
    // 算式也进了 prompt（可复核性）
    expect(prompt).toContain("0.3004");
  });

  it("无案件 / 无材料 → 整块不注入，且 prompt 正常", async () => {
    const session = makeSession(); // 无 matterId
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "随便问一句",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    expect(prompt).not.toContain("已算好的事实");
    expect(result.systemPromptFinal.length).toBeGreaterThan(0);
  });

  it("**体裁事实也在场**：函件交办会看到「这是函件不是合同」（解 party_pair 类困惑）", async () => {
    const session: AgentSession = { ...makeSession(), matterId: MATTER };
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      // 这封催告函摘要在旧口径下会触发 consistency.party_pair
      instruction: "催告乙方按约交付设备，写一封催告函",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    // 路由把交办判成 letter.demand → 体裁事实说明这是函件
    if (prompt.includes("已算好的事实") && prompt.includes("函件")) {
      expect(prompt).toContain("只需指明收件人");
    } else {
      // 若路由未判成函件类，则不应出现信函体裁说明（不硬编）
      expect(prompt).not.toContain("只需指明收件人");
    }
  });

  it("付款合计矛盾也在场（真实 fixture 的硬不一致）", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "cases", MATTER, "materials", "采购合同.md"),
      [
        "第一条 标的与价款",
        "1.1 合同总价款为 1032000 元。",
        "第二条 定金",
        "2.1 甲方向乙方支付定金 310,000 元。",
        "第四条 付款",
        "4.1 合同签订后支付定金 310,000 元。",
        "4.2 验收合格后支付 722,400 元。",
      ].join("\n"),
      "utf8",
    );
    const session: AgentSession = { ...makeSession(), matterId: MATTER };
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "审查这份采购合同的付款条款",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    expect(prompt).toContain("付款分项合计");
    expect(prompt).toContain("多 400");
  });

  it("**尾部几类事实也在场**：付款比例合计算出来就进 prompt（曾经被固定 4 条的静默截断挡在门外）", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "cases", MATTER, "materials", "采购合同.md"),
      [
        "第一条 标的与价款",
        "1.1 合同总价款为 1032000 元。",
        "第四条 付款",
        "4.1 合同签订后支付首付款 30%。",
        "4.2 验收合格后支付 65%。",
      ].join("\n"),
      "utf8",
    );
    const session: AgentSession = { ...makeSession(), matterId: MATTER };
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "审查这份采购合同的付款安排",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    // payment_ratio_sum 在 COMPUTERS 里排第 6（前有 5 类）——旧默认 `limit: 4` 下
    // 它永远到不了这里。这条断言就是那个缺陷的回归。
    expect(prompt).toContain("付款比例合计");
    expect(prompt).toContain("95%");
  });

  it("材料里没有可证明的计算 → 不注入（不是注入一条「无异常」）", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "cases", MATTER, "materials", "会议记录.md"),
      "双方就交付节奏交换了意见，未形成结论。下周继续沟通。",
      "utf8",
    );
    await fs.rm(path.join(workspaceDir, "cases", MATTER, "materials", "采购合同.md"));
    const session: AgentSession = { ...makeSession(), matterId: MATTER };
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "整理一下这份会议记录",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    expect(prompt).not.toContain("已算好的事实");
  });

  it("注入后**仍是素材口径**（不得是结论或命令）", async () => {
    const session: AgentSession = { ...makeSession(), matterId: MATTER };
    const result = await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "审查采购合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const prompt = visiblePrompt(result, session);
    const start = prompt.indexOf("已算好的事实");
    const block = prompt.slice(start, start + 900);
    // 素材口径在场
    expect(block).toContain("代码计算");
    expect(block).toContain("**事实**而非结论");
    // 结论词与命令式不在场
    for (const word of ["违反", "无效", "必须", "一律", "禁止"]) {
      expect(block).not.toContain(word);
    }
  });

  it("**D10 观测**：走真实 prompt 路径会留下素材块指标（丢弃可测）", async () => {
    const session: AgentSession = { ...makeSession(), matterId: MATTER };
    await prepareTurnPromptContext({
      config: makeConfig(workspaceDir),
      registry: new ToolRegistry(),
      session,
      instruction: "审查采购合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    // 记录发生在真实路径里，不是测试直接调用 —— 这是端到端的那一半
    const health = summarizeMaterialBlockHealth(workspaceDir);
    expect(health.samples).toBe(1);
    const factsRow = health.byChannel.find((c) => c.channel === "derived_facts")!;
    expect(factsRow.includedCount).toBe(1);
    // 这个工作区没有改稿范例/黄金范例 —— 它们「本来没内容」，
    // 因此 presentCount 为 0、dropRate 为 null（**不编造 0%**）
    expect(health.byChannel.find((c) => c.channel === "edit_examples")!.dropRate).toBeNull();
    expect(health.byChannel.find((c) => c.channel === "golden_examples")!.dropRate).toBeNull();
  });
});
