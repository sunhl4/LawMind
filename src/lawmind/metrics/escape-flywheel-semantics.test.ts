/**
 * 逃逸飞轮的真实口径 —— 反漂移测试（2026-09-21 由一轮真实办件实测得出）。
 *
 * 这一组测试锁的是**语义**，不是实现细节。起因：`decision-samples.ts` 的初版注释把
 * `outcome: "lawyer_edit"` 说成「编译器漏网」，并据此把空 `ruleIds` 映射成
 * `rule_miss` = 「编译器漏掉了实体缺陷」。跑一轮真实办件后发现**这个说法是错的**：
 *
 * `engine/reviewing.ts` lint 的是**审核时传入的 draft**，也就是律师改完提交的那一版文本。
 * 所以：
 *   - `lint_findings` = 最终稿仍有命中
 *   - `lawyer_edit`   = 最终稿机械干净 **且** 有改稿幅度（`rewriteAmplitude`）
 *
 * 由此的推论（本测试锁定）：**飞轮看不见「agent 原稿有缺陷、律师在提交前改掉」**
 * ——因为 lint 读的是改后文本，缺陷已被改掉。
 *
 * 若将来有人把 lint 改成读原稿（那会是个改进），这些测试会红——**那是对的**，
 * 因为它会改变 `rule_miss` 的含义，必须同步改掉所有下游推断。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "../drafts/index.js";
import { buildEngineContext } from "../engine/context.js";
import { reviewDraft } from "../engine/reviewing.js";
import type { ArtifactDraft } from "../types.js";
import { readLintEscapeFiles } from "./lint-escape-candidates.js";
import { readProductMetricEvents } from "./product-metrics.js";

const dirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sem-"));
  dirs.push(ws);
  await fs.promises.mkdir(path.join(ws, "memory"), { recursive: true });
  await fs.promises.mkdir(path.join(ws, "audit"), { recursive: true });
  await fs.promises.mkdir(path.join(ws, "cases", "m-sem"), { recursive: true });
  await fs.promises.writeFile(path.join(ws, "cases", "m-sem", "CASE.md"), "# Case\n", "utf8");
  return ws;
}

afterEach(async () => {
  for (const dir of dirs) {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  dirs.length = 0;
});

function makeDraft(over: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: `t-${Math.random().toString(36).slice(2, 10)}`,
    matterId: "m-sem",
    title: "催告函",
    summary: "致对方的履约催告",
    sections: [{ heading: "正文", body: "贵司应于十日内完成交付。", citations: [] }],
    reviewNotes: [],
    reviewStatus: "pending",
    output: "docx",
    templateId: "letter-demand-default",
    deliverableType: "letter.demand",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/**
 * 机械干净的正文（`letter.demand` 上实测零命中）。
 *
 * 含「合同」是刻意的：`consistency.party_pair` 在文本不含「合同/协议」时提前返回，
 * 所以要复现「摘要写乙方 → 命中」必须让正文提到合同——这也是催告函的真实写法。
 */
const CLEAN_LETTER =
  "就贵司与我方之间设备采购合同项下的交付义务，贵司应于收到本函之日起十日内完成全部设备的交付。";

function lintOutcomes(ws: string): string[] {
  return readProductMetricEvents(ws)
    .events.filter((e) => e.kind === "lint_escape")
    .map((e) => e.outcome);
}

describe("逃逸飞轮口径①：lint 读的是**审核时传入的文本**，不是 agent 原稿", () => {
  it("改后稿机械干净 + 有改稿幅度 → outcome=lawyer_edit", async () => {
    const ws = await makeWorkspace();
    const draft = makeDraft({
      sections: [{ heading: "正文", body: CLEAN_LETTER, citations: [] }],
      rewriteAmplitude: {
        absCharDelta: 40,
        absParagraphDelta: 1,
        at: new Date().toISOString(),
      },
    });
    persistDraft(ws, draft);
    const ctx = buildEngineContext({ workspaceDir: ws, adapters: [] });
    await reviewDraft(ctx, draft, { status: "modified", note: "改口径" });

    expect(lintOutcomes(ws)).toEqual(["lawyer_edit"]);
    // 零命中 ⟹ 老实现会在 ruleIds 里得到空数组
    const escape = readLintEscapeFiles(ws);
    expect(escape.candidates.rows[0]?.ruleIds).toEqual([]);
  });

  it("**关键推论**：agent 原稿有缺陷、但提交前已改掉 → 飞轮完全看不见（零记录）", async () => {
    const ws = await makeWorkspace();
    // 模拟：原稿含 placeholder（会被 lint 命中），律师在提交前把它删干净了，
    // 但**没有**留下 rewriteAmplitude（例如通过外部工具改的）。
    const draft = makeDraft({
      // 改后文本：干净
      sections: [{ heading: "正文", body: CLEAN_LETTER, citations: [] }],
      // 无 rewriteAmplitude
    });
    persistDraft(ws, draft);
    const ctx = buildEngineContext({ workspaceDir: ws, adapters: [] });
    await reviewDraft(ctx, draft, { status: "modified", note: "已改" });

    // 既没有 lint_findings（改后干净）也没有 lawyer_edit（无幅度）→ **什么都没记**
    expect(lintOutcomes(ws)).toEqual([]);
    const escape = readLintEscapeFiles(ws);
    expect(escape.candidates.present).toBe(false);
  });

  it("改后稿仍有命中 → lint_findings（哪怕原稿是干净的）", async () => {
    const ws = await makeWorkspace();
    // 律师改稿时**引入**了机械缺陷（例如顺手加了引用/裸百分比）
    const draft = makeDraft({
      sections: [
        {
          heading: "正文",
          body: "甲方应支付定金 30% 即 310,000 元，见第二条。",
          citations: [],
        },
      ],
    });
    persistDraft(ws, draft);
    const ctx = buildEngineContext({ workspaceDir: ws, adapters: [] });
    await reviewDraft(ctx, draft, { status: "modified", note: "补金额" });

    expect(lintOutcomes(ws)).toEqual(["lint_findings"]);
    const escape = readLintEscapeFiles(ws);
    expect(escape.candidates.rows[0]?.ruleIds.length ?? 0).toBeGreaterThan(0);
  });

  it("对照组：干净批准 → 零记录（needsLintForEscape=false）", async () => {
    const ws = await makeWorkspace();
    const draft = makeDraft();
    persistDraft(ws, draft);
    const ctx = buildEngineContext({ workspaceDir: ws, adapters: [] });
    await reviewDraft(ctx, draft, { status: "approved", note: "无误" });

    expect(lintOutcomes(ws)).toEqual([]);
    expect(readLintEscapeFiles(ws).candidates.present).toBe(false);
  });

  it("**linter 的输入含 title + summary**，不只是 sections 正文", async () => {
    const ws = await makeWorkspace();
    // 同一个干净正文，摘要里写「乙方」→ 触发 consistency.party_pair
    const withTrigger = makeDraft({
      title: "催告函",
      summary: "催告乙方按约交付设备",
      sections: [{ heading: "正文", body: CLEAN_LETTER, citations: [] }],
    });
    const withNeutral = makeDraft({
      title: "催告函",
      summary: "致对方的履约催告",
      sections: [{ heading: "正文", body: CLEAN_LETTER, citations: [] }],
    });
    persistDraft(ws, withTrigger);
    persistDraft(ws, withNeutral);
    const ctx = buildEngineContext({ workspaceDir: ws, adapters: [] });
    await reviewDraft(ctx, withTrigger, { status: "modified", note: "x" });
    await reviewDraft(ctx, withNeutral, { status: "modified", note: "x" });

    const escape = readLintEscapeFiles(ws);
    // 正文完全相同，只有 summary 措辞不同 —— 一个有记录、一个没有。
    // 这直接证明 **linter 读到了 title/summary**（`draftTextFromUnknown` 拼的是全文）。
    expect(escape.candidates.rows).toHaveLength(1);
    const triggered = escape.candidates.rows[0];
    expect(triggered.taskId).toBe(withTrigger.taskId);
    expect(triggered.ruleIds).toEqual(["consistency.party_pair"]);
    // 中性摘要那份零命中 → 连记录都不写（见口径②的第一条测试）
    expect(escape.candidates.rows.some((r) => r.taskId === withNeutral.taskId)).toBe(false);
  });
});

describe("逃逸飞轮口径②：契约级不变量", () => {
  it("免 lint 的条件是「改后零命中」**且**「有改稿幅度」——两者缺一即不记 lawyer_edit", async () => {
    const ws = await makeWorkspace();
    // 零命中但无幅度
    const noAmplitude = makeDraft({
      sections: [{ heading: "正文", body: CLEAN_LETTER, citations: [] }],
    });
    persistDraft(ws, noAmplitude);
    const ctx = buildEngineContext({ workspaceDir: ws, adapters: [] });
    await reviewDraft(ctx, noAmplitude, { status: "modified", note: "x" });
    expect(lintOutcomes(ws)).toEqual([]);
  });

  it("有幅度但改后仍有命中 → lint_findings（不是 lawyer_edit）", async () => {
    const ws = await makeWorkspace();
    const draft = makeDraft({
      sections: [{ heading: "正文", body: "定金 30% 见第二条。", citations: [] }],
      rewriteAmplitude: {
        absCharDelta: 10,
        absParagraphDelta: 1,
        at: new Date().toISOString(),
      },
    });
    persistDraft(ws, draft);
    const ctx = buildEngineContext({ workspaceDir: ws, adapters: [] });
    await reviewDraft(ctx, draft, { status: "modified", note: "x" });
    expect(lintOutcomes(ws)).toEqual(["lint_findings"]);
  });
});
