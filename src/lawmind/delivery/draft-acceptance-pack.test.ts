import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(md).toContain("## 1. 验收门禁");
    expect(md).toContain("## 2. 引用完整性");
    expect(md).toContain("## 3. 草稿章节速览");
    expect(md).toContain("## 4. 与本任务相关的审计事件");
    expect(md).toContain("## 5. 律师签收");
    expect(md).toContain("2026-04-17T00:00:00.000Z");
  });

  it("flags unready drafts with blocker icon when required sections are missing", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-draft-pack-"));
    const draft = rentalDraft({ sections: [{ heading: "一、备注", body: "随便写写" }] });
    const md = await buildDraftAcceptancePackMarkdown(tmp, draft);
    expect(md).toContain("⛔ 未通过");
    expect(md).toContain("阻断项:");
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
});
