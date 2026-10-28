/**
 * Machine-checkable 交件契约对照 (synthetic).
 * Does not replace real-file comparison vs panrui / copilot binaries.
 */

import { describe, expect, it } from "vitest";
import { calculateLegal } from "../agent/tools/legal/calculate-lib.js";
import { getDeliverableSpec } from "../deliverables/registry.js";
import {
  newReviewTable,
  reviewTableAcceptanceProblems,
  reviewTableToMarkdown,
  reviewTableToXlsxRows,
  REVIEW_TABLE_TEMPLATES,
} from "../deliverables/review-table.js";
import { explainSurgicalSpanViolation } from "../drafts/surgical-span-gate.js";
import {
  formatComplaintFactsBlock,
  emptyComplaintFillPlan,
} from "../litigation/complaint-fill-plan.js";
import { MAIL_CONTRACT_DENY_TOOL_NAMES } from "../platform/mail-contract-short-path-instruction.js";
import { resolvePlaybookToolLock } from "../platform/playbook-tool-lock.js";
import { WORD_REVISION_DENY_TOOL_NAMES } from "../platform/word-revision-instruction.js";
import { buildDraft } from "../reasoning/keyword-draft.js";
import { route } from "../router/index.js";
import { bindLawyerCapability } from "../skills/lawyer-capabilities.js";
import { planLeanSkillPrompt } from "../skills/skill-prompt-budget.js";
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
  it("keeps the mail short path on layers/citation skills and mail tools", () => {
    const mail = bindLawyerCapability({
      instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\nmatterId=`m1`",
    });
    expect(mail?.id).toBe("mail.contract");
    expect(mail?.skillIds).toEqual([
      "contract-review-layers",
      "contract-redline-craft",
      "citation-grounding",
      "delivery-language",
    ]);
    expect(mail?.skillIds).toContain("contract-review-layers");
    const lock = resolvePlaybookToolLock(
      "【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=`cases/m/a.docx`",
    );
    expect(lock?.denyNames).toEqual([...MAIL_CONTRACT_DENY_TOOL_NAMES]);
    expect(lock?.denyNames).toContain("render_document");
    expect(lock?.denyNames).not.toContain("render_tracked_draft");
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
    // 前两份是本轮主阶段；其余是合同审查目录，改稿时不整表换掉。
    expect(bound?.skillIds).toEqual([
      "contract-review-layers",
      "contract-redline-craft",
      "contract-playbook-review",
      "practice-defaults",
      "legal-element-extraction",
      "norm-validity",
      "citation-grounding",
      "delivery-language",
    ]);
    expect(bound?.pipelineHint).toContain("render_tracked_draft");
    const lock = resolvePlaybookToolLock(
      [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `合作协议.docx`",
        "修改合同",
      ].join("\n"),
    );
    expect(lock?.id).toBe("word-revision");
    expect(lock?.denyNames).toEqual([...WORD_REVISION_DENY_TOOL_NAMES]);
    expect(lock?.denyNames).toContain("render_document");
    expect(lock?.denyNames).not.toContain("render_tracked_draft");
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

  it("review.table deliverable type is registered with 结论 + 审查表 sections", () => {
    const spec = getDeliverableSpec("review.table");
    expect(spec).toBeDefined();
    expect(spec?.displayName).toBe("审查表");
    const keywords = (spec?.requiredSections ?? []).flatMap((s) => s.headingKeywords);
    expect(keywords.some((k) => k.includes("结论"))).toBe(true);
    expect(keywords.some((k) => k.includes("审查表") || k.includes("表格"))).toBe(true);
  });

  it("review table acceptance requires rows with sources (no空表交付)", () => {
    const empty = newReviewTable("t", "due_diligence");
    expect(reviewTableAcceptanceProblems(empty)).toEqual(["审查表为空"]);
    const filled: ReturnType<typeof newReviewTable> = {
      ...empty,
      rows: [{ id: "r1", cells: { item: "股权结构", source: "cases/m/materials/a.pdf" } }],
    };
    expect(reviewTableAcceptanceProblems(filled)).toEqual([]);
    // 三类模板都带来源列，律师可直接核验。
    for (const template of Object.keys(REVIEW_TABLE_TEMPLATES) as Array<
      keyof typeof REVIEW_TABLE_TEMPLATES
    >) {
      expect(REVIEW_TABLE_TEMPLATES[template].columns.some((c) => c.key === "source")).toBe(true);
    }
  });

  it("review table exports the same rows to xlsx and to the draft markdown preview", () => {
    const table: ReturnType<typeof newReviewTable> = {
      ...newReviewTable("t", "clause_matrix"),
      rows: [
        {
          id: "r1",
          cells: {
            clause: "第12条 责任上限",
            our_text: "以已付费用为限",
            their_text: "不设上限",
            risk: "高",
            suggestion: "坚持上限",
            source: "cases/m/materials/合同.pdf",
          },
        },
      ],
    };
    // 分析列后带 `_依据`；文件名列/来源列不带（MeWork 分析表同构）。
    const header = reviewTableToXlsxRows(table)[0] as string[];
    expect(header).toContain("我方文本_依据");
    expect(header).toContain("来源");
    expect(header.filter((h) => h.endsWith("_依据")).length).toBeGreaterThan(0);
    expect(reviewTableToXlsxRows(table, { includeEvidenceColumns: false })[0]?.length).toBe(
      table.columns.length,
    );
    expect(reviewTableToXlsxRows(table)[1]?.[0]).toBe("第12条 责任上限");
    const md = reviewTableToMarkdown(table);
    expect(md).toContain("第12条 责任上限");
    expect(md).toContain("cases/m/materials/合同.pdf");
  });

  it("合同审查带上 playbook 三档 skill 与档位口径", () => {
    const review = bindLawyerCapability({ instruction: "请审查这份采购合同" });
    expect(review?.id).toBe("contract.review");
    expect(review?.skillIds).toContain("contract-playbook-review");
    // 档位口径写进 pipelineHint，而不是只存在于 skill 正文。
    expect(review?.pipelineHint).toContain("可接受回退");
    expect(review?.pipelineHint).toContain("永不接受");
    expect(review?.pipelineHint).toContain("冲突");
    expect(review?.pipelineHint).toContain("未见");
  });

  it("时间轴同一轮交正式件，不先停下来等确认", () => {
    const timeline = bindLawyerCapability({ instruction: "把这些材料做成时间轴" });
    expect(timeline?.id).toBe("chronology.timeline");
    expect(timeline?.skillIds).toContain("chronology-two-stage");
    expect(timeline?.pipelineHint).toContain("正式时间轴");
    expect(timeline?.pipelineHint).not.toContain("确认后才出正式件");
  });

  it("办案周报带上范围变更与预算对照 skill", () => {
    const status = bindLawyerCapability({ instruction: "写本案办案周报" });
    expect(status?.id).toBe("matter.status");
    expect(status?.skillIds).toContain("matter-status-scope-budget");
    expect(status?.pipelineHint).toContain("范围变更");
    expect(status?.pipelineHint).toContain("预算");
  });

  it("labor.calc binds termination triage and N+1 adds exactly one month", () => {
    const bound = bindLawyerCapability({
      instruction: "工作 3 年月薪 10000，公司提前通知解除，计算经济补偿",
    });
    expect(bound?.id).toBe("labor.calc");
    expect(bound?.skillIds).toContain("labor-termination-triage");
    const n = calculateLegal("economic_compensation", {
      yearsOfService: 3,
      monthlyWageYuan: 10_000,
      kind: "N+1",
    });
    expect(n.ok && n.result.value).toBe(40_000);
  });

  it("letter drafting binds audience tiers", () => {
    const letter = bindLawyerCapability({ instruction: "写一封催款律师函" });
    expect(letter?.id).toBe("letter.draft");
    expect(letter?.skillIds).toContain("role-audience-tiers");
  });

  it("matter intake binds the scope baseline skill", () => {
    const intake = bindLawyerCapability({ instruction: "整理这个案件材料并建立目录" });
    expect(intake?.id).toBe("matter.intake");
    expect(intake?.skillIds).toContain("matter-intake-scope");
  });

  it("本期三个消化 skill 的正文与出处都在 builtin 目录里", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(import.meta.dirname, "../skills/builtin");
    const expected = [
      ["labor-termination-triage", "MIT"],
      ["role-audience-tiers", "Apache-2.0"],
      ["matter-intake-scope", "Apache-2.0"],
    ] as const;
    for (const [id, license] of expected) {
      const body = await fs.readFile(path.join(dir, `${id}.md`), "utf8");
      expect(body).toContain(license);
      expect(body.length).toBeGreaterThan(800);
    }
  });

  it("三个内化 skill 的正文都在 builtin 目录里（不是索引指针）", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(import.meta.dirname, "../skills/builtin");
    for (const id of [
      "contract-playbook-review",
      "chronology-two-stage",
      "matter-status-scope-budget",
    ]) {
      const body = await fs.readFile(path.join(dir, `${id}.md`), "utf8");
      // 有出处记录（Apache-2.0 方法吸收），且有可执行步骤而非只有一句人设。
      expect(body).toContain("Apache-2.0");
      expect(body.length).toBeGreaterThan(800);
    }
  });

  it("内化 skill 即使不是 primary 正文，也必须在 skill 索引里对模型可见", () => {
    // 合同审查：playbook 与分层都在能力里；索引行披露名称与 description。
    const review = bindLawyerCapability({ instruction: "请审查这份采购合同" })!;
    const reviewPlan = planLeanSkillPrompt(review, "请审查这份采购合同");
    const reviewDisclosed = [...reviewPlan.primaryIds, ...reviewPlan.indexLines].join("\n");
    expect(reviewPlan.primaryIds).toContain("contract-review-layers");
    expect(reviewPlan.primaryIds).toContain("contract-playbook-review");
    expect(reviewDisclosed).toContain("contract-playbook-review");
    const redlineLine = reviewPlan.indexLines.find((l) => l.startsWith("contract-redline-craft"));
    expect(redlineLine).toBeTruthy();
    expect(redlineLine).toMatch(/[:：]\s*\S/);
    expect(reviewPlan.indexIds).toContain("contract-redline-craft");

    const timeline = bindLawyerCapability({ instruction: "把这些材料做成时间轴" })!;
    const timelinePlan = planLeanSkillPrompt(timeline, "把这些材料做成时间轴");
    expect(timelinePlan.primaryIds).toEqual(["chronology-two-stage", "chronology-from-materials"]);

    const status = bindLawyerCapability({ instruction: "写本案办案周报" })!;
    const statusPlan = planLeanSkillPrompt(status, "写本案办案周报");
    expect(statusPlan.primaryIds).toEqual(["matter-status-report", "matter-status-scope-budget"]);
  });
});
