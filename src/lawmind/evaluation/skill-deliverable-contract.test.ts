/**
 * Machine-checkable 交件契约对照 (synthetic).
 * Does not replace real-file comparison vs panrui / copilot binaries.
 */

import { describe, expect, it } from "vitest";
import { calculateLegal } from "../agent/tools/legal/calculate-lib.js";
import { explainSurgicalSpanViolation } from "../drafts/surgical-span-gate.js";
import {
  formatComplaintFactsBlock,
  emptyComplaintFillPlan,
} from "../litigation/complaint-fill-plan.js";
import { MAIL_CONTRACT_FAST_PATH_TOOL_NAMES } from "../platform/mail-contract-short-path-instruction.js";
import { resolvePlaybookToolLock } from "../platform/playbook-tool-lock.js";
import { WORD_REVISION_TOOL_NAMES } from "../platform/word-revision-instruction.js";
import { buildDraft } from "../reasoning/keyword-draft.js";
import { route } from "../router/index.js";
import { bindLawyerCapability } from "../skills/lawyer-capabilities.js";
import type { ResearchBundle } from "../types.js";

function emptyBundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "",
    claims: [],
    sources: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("skill deliverable contract (synthetic)", () => {
  it("keeps the mail short path on citation/delivery skills and mail tools", () => {
    const mail = bindLawyerCapability({
      instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\nmatterId=`m1`",
    });
    expect(mail?.id).toBe("mail.contract");
    expect(mail?.skillIds).toEqual(["citation-grounding", "delivery-language"]);
    expect(mail?.skillIds).not.toContain("contract-review-layers");
    const lock = resolvePlaybookToolLock(
      "【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=`cases/m/a.docx`",
    );
    expect(lock?.allowNames).toEqual([...MAIL_CONTRACT_FAST_PATH_TOOL_NAMES]);
    expect(lock?.allowNames).toContain("render_tracked_draft");
  });

  it("keeps file-page Word revision on redline craft + tracked render", () => {
    const bound = bindLawyerCapability({
      instruction: [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `合作协议.docx`",
        "修改合同",
      ].join("\n"),
    });
    expect(bound?.pipeline).toBe("tracked_redline");
    expect(bound?.skillIds).toEqual(["contract-redline-craft"]);
    expect(bound?.pipelineHint).toContain("render_tracked_draft");
    const lock = resolvePlaybookToolLock(
      [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `合作协议.docx`",
        "修改合同",
      ].join("\n"),
    );
    expect(lock?.id).toBe("word-revision");
    expect(lock?.allowNames).toEqual([...WORD_REVISION_TOOL_NAMES]);
    expect(lock?.allowNames).toContain("render_tracked_draft");
    expect(lock?.allowNames).not.toContain("render_document");
  });

  it("opinion scaffold has 宏观/中观/微观 and 推荐措辞", () => {
    const intent = route({ instruction: "请审查这份采购合同的违约责任" });
    expect(intent.deliverableType).toBe("contract.review");
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const headings = draft.sections.map((s) => s.heading).join(" ");
    expect(headings).toContain("宏观审查");
    expect(headings).toContain("中观审查");
    expect(headings).toContain("微观条款");
    expect(headings).toContain("纸侧与角色");
    expect(headings).toContain("要件事实");
    expect(headings).toContain("责任上限");
    expect(headings).toContain("改稿计划");
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("推荐措辞");
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("类型：买卖");
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("价款与交货");
    expect(draft.sections.map((s) => s.heading).join(" ")).toContain("来源边界");
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("结论待定");
  });

  it("complaint scaffold is linear elements without markdown tables", () => {
    const intent = route({ instruction: "写起诉状" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const joined = draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
    expect(joined).toContain("要件：");
    expect(joined).not.toMatch(/\| --- \|/);
    expect(formatComplaintFactsBlock(emptyComplaintFillPlan())).not.toMatch(/\| --- \|/);
  });

  it("labor 2N for 3 years × 10000 is 60000 via calculate", () => {
    const n = calculateLegal("economic_compensation", {
      yearsOfService: 3,
      monthlyWageYuan: 10_000,
      kind: "2N",
    });
    expect(n.ok && n.result.value).toBe(60_000);
    const draft = buildDraft({
      intent: route({ instruction: "工作3年月薪10000，计算违法解除的经济补偿" }),
      bundle: emptyBundle("t-labor-2n"),
    });
    expect(draft.sections.map((s) => s.body).join("\n")).toContain("60000");
  });

  it("surgical span gate allows short finds and rejects whole-sentence finds", () => {
    expect(explainSurgicalSpanViolation("甲方所在地人民法院", "上海仲裁委员会")).toBeUndefined();
    expect(
      explainSurgicalSpanViolation(
        "并赔偿甲方因此而造成的实际损失。",
        "并赔偿甲方因此而造成的实际损失，但累计赔偿总额不超过该项目已付软件费用。",
      ),
    ).toMatch(/跨度硬门禁/);
  });
});
