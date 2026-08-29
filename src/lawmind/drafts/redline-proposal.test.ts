import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { persistDraft } from "./index.js";
import { readDraft } from "./index.js";
import {
  generateRedlineAfterWrite,
  generateRedlineProposal,
  prepareRedlineBaselineBeforeWrite,
  readRedlineProposal,
  resetRedlineBaselineFromDraft,
  resolveAllRedlineHunks,
  resolveRedlineHunk,
  writeRedlineProposal,
} from "./redline-proposal.js";

describe("redline-proposal", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("baseline then edit then generate produces hunks and accept applies", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-2",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [{ heading: "Intro", body: "Version A" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    const baseline = resetRedlineBaselineFromDraft(ws, draft.taskId);
    expect(baseline.ok).toBe(true);
    draft.sections[0].body = "Version B";
    persistDraft(ws, draft);
    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    expect(gen.proposal.hunks.length).toBe(1);
    const hunkId = gen.proposal.hunks[0].hunkId;
    const resolved = resolveRedlineHunk(ws, draft.taskId, hunkId, "accept");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || !resolved.draft) {
      return;
    }
    expect(resolved.draft.sections[0]?.body).toBe("Version B");
  });

  it("generates hunks when section body changes and accept applies to draft", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-1",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [{ heading: "Intro", body: "Original text" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    resetBaseline(ws, draft);
    draft.sections[0].body = "Revised text";
    persistDraft(ws, draft);

    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    expect(gen.proposal.hunks.length).toBe(1);
    const hunkId = gen.proposal.hunks[0].hunkId;

    const resolved = resolveRedlineHunk(ws, draft.taskId, hunkId, "accept");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || !resolved.draft) {
      return;
    }
    expect(resolved.draft.sections[0]?.body).toBe("Revised text");
    const stored = readRedlineProposal(ws, draft.taskId);
    expect(stored?.hunks[0]?.status).toBe("accepted");
  });

  it("reject reverts draft body to before", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-reject",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [{ heading: "Intro", body: "Original" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    resetRedlineBaselineFromDraft(ws, draft.taskId);
    draft.sections[0].body = "Changed by agent";
    persistDraft(ws, draft);
    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    const hunkId = gen.proposal.hunks[0].hunkId;
    const rejected = resolveRedlineHunk(ws, draft.taskId, hunkId, "reject");
    expect(rejected.ok).toBe(true);
    const after = readDraft(ws, draft.taskId);
    expect(after?.sections[0]?.body).toBe("Original");
    expect(readRedlineProposal(ws, draft.taskId)?.hunks[0]?.status).toBe("rejected");
  });

  it("surgical mode emits minimal span hunk for two-character edit", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-surgical-1",
      title: "合同",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "s",
      sections: [{ heading: "付款", body: "甲方应在三十日内支付全部价款。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: { baselineRelativePath: "contracts/a.docx", mode: "surgical" },
    };
    persistDraft(ws, draft);
    resetRedlineBaselineFromDraft(ws, draft.taskId);
    draft.sections[0].body = "甲方应在十五日内支付全部价款。";
    persistDraft(ws, draft);
    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    expect(gen.proposal.hunks.length).toBe(1);
    expect(gen.proposal.hunks[0].granularity).toBe("surgical");
    expect(gen.proposal.hunks[0].before).toBe("三十");
    expect(gen.proposal.hunks[0].after).toBe("十五");
    const rejected = resolveRedlineHunk(ws, draft.taskId, gen.proposal.hunks[0].hunkId, "reject");
    expect(rejected.ok).toBe(true);
    expect(readDraft(ws, draft.taskId)?.sections[0]?.body).toBe("甲方应在三十日内支付全部价款。");
  });

  it("accept-all with multiple surgical hunks in one section keeps spans aligned (delta shift)", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    // 同段两处编辑，间隔 >80 字未变文本（含干扰子串「五」），触发句级多 span。
    const filler =
      "本合同自双方签字盖章之日起生效。试用期五个月，自入职之日起算。任何一方不得擅自变更或解除本合同。本合同一式两份，双方各执一份，具有同等法律效力。";
    const baselineBody = `甲方应在三十日内支付全部价款。${filler}乙方应在收到货物后五日内完成验收。`;
    const afterBody = `甲方应在十五日内支付全部价款及逾期利息。${filler}乙方应在收到货物后十日内完成验收。`;
    const draft: ArtifactDraft = {
      taskId: "task-surgical-multi",
      title: "合同",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "s",
      sections: [{ heading: "付款与验收", body: baselineBody }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: { baselineRelativePath: "contracts/a.docx", mode: "surgical" },
    };
    persistDraft(ws, draft);
    resetRedlineBaselineFromDraft(ws, draft.taskId);
    draft.sections[0].body = afterBody;
    persistDraft(ws, draft);

    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    const surgicalHunks = gen.proposal.hunks.filter((h) => h.granularity === "surgical");
    expect(surgicalHunks.length).toBe(2);

    const all = resolveAllRedlineHunks(ws, draft.taskId, "accept");
    expect(all.ok).toBe(true);
    // 关键断言：accept-all 后 baseline 必须精确等于编辑后正文（修复前第二个 hunk
    // 会因 span 偏移回退到 indexOf，命中干扰子串「五个月」而污染 baseline）。
    const stored = readRedlineProposal(ws, draft.taskId);
    expect(stored?.baselineSections[0]?.body).toBe(afterBody);
    expect(readDraft(ws, draft.taskId)?.sections[0]?.body).toBe(afterBody);
  });

  it("accepting a later surgical hunk first does not disturb earlier pending hunk spans", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const filler =
      "本合同自双方签字盖章之日起生效。试用期五个月，自入职之日起算。任何一方不得擅自变更或解除本合同。本合同一式两份，双方各执一份，具有同等法律效力。";
    const baselineBody = `甲方应在三十日内支付全部价款。${filler}乙方应在收到货物后五日内完成验收。`;
    const afterBody = `甲方应在十五日内支付全部价款及逾期利息。${filler}乙方应在收到货物后十日内完成验收。`;
    const draft: ArtifactDraft = {
      taskId: "task-surgical-reverse",
      title: "合同",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "s",
      sections: [{ heading: "付款与验收", body: baselineBody }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: { baselineRelativePath: "contracts/a.docx", mode: "surgical" },
    };
    persistDraft(ws, draft);
    resetRedlineBaselineFromDraft(ws, draft.taskId);
    draft.sections[0].body = afterBody;
    persistDraft(ws, draft);

    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    const [first, second] = gen.proposal.hunks;
    expect(first.granularity).toBe("surgical");
    expect(second.granularity).toBe("surgical");

    // 先接受靠后的 hunk：其编辑区域在靠前 hunk 之后，不应平移靠前 hunk 的 span。
    const r2 = resolveRedlineHunk(ws, draft.taskId, second.hunkId, "accept");
    expect(r2.ok).toBe(true);
    const r1 = resolveRedlineHunk(ws, draft.taskId, first.hunkId, "accept");
    expect(r1.ok).toBe(true);

    const stored = readRedlineProposal(ws, draft.taskId);
    expect(stored?.baselineSections[0]?.body).toBe(afterBody);
  });

  it("multi-call generateRedlineAfterWrite keeps accumulated edits vs locked baseline", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-multi",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [
        {
          heading: "五",
          body: "乙方应赔偿甲方因此而造成的实际损失。本条款永久有效。",
        },
        {
          heading: "十一",
          body: "争议提交甲方所在地人民法院管辖。",
        },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    // Call 1: lock baseline, edit art.5, regenerate.
    expect(prepareRedlineBaselineBeforeWrite(ws, draft.taskId).ok).toBe(true);
    draft.sections[0].body =
      "乙方应赔偿甲方因此而造成的实际损失，但累计赔偿总额不超过该项目已付软件费用。本条款永久有效。";
    persistDraft(ws, draft);
    const r1 = generateRedlineAfterWrite(ws, draft.taskId);
    expect(r1.ok).toBe(true);
    if (!r1.ok) {
      return;
    }
    const firstPending = r1.proposal.hunks.filter((h) => h.status === "pending").length;
    expect(firstPending).toBeGreaterThanOrEqual(1);

    // Call 2: baseline stays locked; second edit accumulates — must not drop call-1 hunks.
    expect(prepareRedlineBaselineBeforeWrite(ws, draft.taskId).ok).toBe(true);
    draft.sections[1].body = "争议提交上海仲裁委员会管辖。";
    persistDraft(ws, draft);
    const r2 = generateRedlineAfterWrite(ws, draft.taskId);
    expect(r2.ok).toBe(true);
    if (!r2.ok) {
      return;
    }
    const pending = r2.proposal.hunks.filter((h) => h.status === "pending");
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const joined = pending.map((h) => `${h.before}->${h.after}`).join("\n");
    expect(joined).toMatch(/实际损失|累计|软件费用/);
    expect(joined).toMatch(/人民法院|仲裁/);
    expect(r2.proposal.baselineSections[0]?.body).toContain("实际损失。本条款");
    expect(r2.proposal.baselineSections[1]?.body).toContain("人民法院");
  });

  it("resolveAll accept applies every pending hunk", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-all",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [
        { heading: "A", body: "a0" },
        { heading: "B", body: "b0" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    resetRedlineBaselineFromDraft(ws, draft.taskId);
    draft.sections[0].body = "a1";
    draft.sections[1].body = "b1";
    persistDraft(ws, draft);
    expect(generateRedlineProposal(ws, draft.taskId).ok).toBe(true);
    const all = resolveAllRedlineHunks(ws, draft.taskId, "accept");
    expect(all.ok).toBe(true);
    if (!all.ok) {
      return;
    }
    expect(all.resolved).toBe(2);
    expect(readDraft(ws, draft.taskId)?.sections.map((s) => s.body)).toEqual(["a1", "b1"]);
  });
});

function resetBaseline(ws: string, draft: ArtifactDraft): void {
  writeRedlineProposal(ws, {
    taskId: draft.taskId,
    baselineSections: draft.sections.map((s) => ({ ...s })),
    hunks: [],
    updatedAt: new Date().toISOString(),
  });
}
