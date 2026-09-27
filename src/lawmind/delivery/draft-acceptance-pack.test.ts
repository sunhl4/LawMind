import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistResearchSnapshot } from "../drafts/research-snapshot.js";
import { DEMO_CORPUS_RISK_FLAG } from "../retrieval/authority-gap.js";
import type { ArtifactDraft } from "../types.js";
import { buildDraftAcceptancePackMarkdown } from "./draft-acceptance-pack.js";

describe("buildDraftAcceptancePackMarkdown", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  function rentalDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
    return {
      taskId: "task-rental-1",
      title: "房屋租赁合同（朝阳区·示例）",
      output: "docx",
      templateId: "contract-rental-default",
      deliverableType: "contract.rental",
      summary: "出租方与承租方就朝阳区某房屋达成的租赁合同。",
      sections: [
        {
          heading: "一、合同主体",
          body: "出租人：【待补充：出租方姓名】\n承租人：【待补充：承租方姓名】",
        },
        { heading: "二、房屋情况", body: "房屋坐落于朝阳区示例小区。" },
        { heading: "三、租期", body: "租期 12 个月，自示例日期起。" },
        { heading: "四、租金与押金", body: "租金每月 5000 元，押金 5000 元。" },
        { heading: "五、违约责任", body: "任一方违约应赔偿对方损失。" },
        { heading: "六、签署", body: "甲方：_____ 乙方：_____" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("renders all required sections including acceptance + audit + signoff", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-draft-pack-"));
    const md = await buildDraftAcceptancePackMarkdown(tmp, rentalDraft(), {
      generatedAt: "2026-04-17T00:00:00.000Z",
    });
    expect(md).toContain("LawMind 交付验收包");
    expect(md).toContain("`task-rental-1`");
    expect(md).toContain("## 1. 出稿检查");
    expect(md).toContain("## 2. 引用完整性");
    expect(md).toContain("## 3. 草稿章节速览");
    expect(md).toContain("## 4. 与本任务相关的审计事件");
    expect(md).toContain("## 5. 律师签收");
    expect(md).toContain("2026-04-17T00:00:00.000Z");
  });

  it("flags missing sections as warnings, not blockers (缺节只警告，不挡交付)", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-draft-pack-"));
    const draft = rentalDraft({ sections: [{ heading: "一、备注", body: "随便写写" }] });
    const md = await buildDraftAcceptancePackMarkdown(tmp, draft);
    // 铁律 5：缺章节降级为提示项——总体结论仍是通过，阻断项为 0。
    expect(md).toContain("✅ 已通过（可交付）");
    expect(md).toContain("阻断项: 0");
    expect(md).toMatch(/提示项: [1-9]/);
    expect(md).toContain("⚠️");
  });

  it("flags unready drafts with blocker icon when placeholders remain unresolved", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-draft-pack-"));
    // rentalDraft() 默认带【待补充：出租方姓名/承租方姓名】——contract.rental 的
    // placeholderRule.mustResolveBeforeRender=true，未填项仍是硬阻断。
    const md = await buildDraftAcceptancePackMarkdown(tmp, rentalDraft());
    expect(md).toContain("⛔ 未通过（仍有阻断项）");
    expect(md).toMatch(/阻断项: [1-9]/);
    expect(md).toContain("⛔");
  });

  it("notes when research snapshot is missing in citation section", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-draft-pack-"));
    const md = await buildDraftAcceptancePackMarkdown(tmp, rentalDraft());
    expect(md).toContain("no_research_snapshot");
  });

  it("lists placeholder samples when present", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-draft-pack-"));
    const md = await buildDraftAcceptancePackMarkdown(tmp, rentalDraft());
    expect(md).toMatch(/【待补充[:：]出租方姓名】/);
  });

  it("watermarks pack when research snapshot is demo corpus", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-draft-pack-"));
    const draft = rentalDraft();
    persistResearchSnapshot(tmp, {
      taskId: draft.taskId,
      query: "demo",
      sources: [{ id: "s1", title: "演示条文", kind: "statute", demo: true }],
      claims: [
        { text: "演示摘录", sourceIds: ["s1"], confidence: 0.5, model: "legal", demo: true },
      ],
      riskFlags: [DEMO_CORPUS_RISK_FLAG],
      missingItems: [],
      requiresReview: true,
      completedAt: "2026-07-28T00:00:00.000Z",
    });
    const md = await buildDraftAcceptancePackMarkdown(tmp, draft);
    expect(md).toContain("演示语料水印");
    expect(md).toContain(DEMO_CORPUS_RISK_FLAG);
    expect(md).toContain("权威语料**: 演示语料");
  });
});
