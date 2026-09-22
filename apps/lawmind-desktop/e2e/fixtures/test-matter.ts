import { createDraft, createMatter, type CreateDraftInput } from "../helpers/contract-api.js";

export const TEST_MATTER_ID = "e2e-journey-matter";

export const TEST_DRAFT_SECTIONS = [
  { heading: "审查结论", body: "整体可签，E2E_JOURNEY_EXPECTED_CONTENT 已落盘。" },
  { heading: "主要风险", body: "第 8 条违约金约定偏低，建议调高。" },
  { heading: "修改建议", body: "建议提高违约金并写明解除触发条件。" },
];

export type SeededMatterAndDraft = {
  matterId: string;
  taskId: string;
  title: string;
};

/**
 * 通过本地 API 创建 E2E 专用案件，用于后续旅程测试。
 */
export async function seedTestMatter(
  apiBase: string,
  apiAuthToken: string,
): Promise<{ matterId: string }> {
  return createMatter(apiBase, apiAuthToken, {
    matterId: TEST_MATTER_ID,
    displayName: "E2E 买卖合同审查案件",
    conflictCheckConfirmed: true,
    engagementAccepted: true,
  });
}

/**
 * 通过本地 API 创建 E2E 专用草稿，用于后续签批/导出旅程。
 */
export async function seedTestDraft(
  apiBase: string,
  apiAuthToken: string,
  matterId: string,
  overrides?: Partial<CreateDraftInput>,
): Promise<SeededMatterAndDraft> {
  const result = await createDraft(apiBase, apiAuthToken, {
    matterId,
    title: "E2E 买卖合同审查意见",
    summary: "E2E  journey 测试摘要：买卖合同审查。",
    sections: TEST_DRAFT_SECTIONS,
    output: "docx",
    deliverableType: "contract.review",
    ...overrides,
  });
  return { matterId: result.matterId, taskId: result.taskId, title: result.title };
}
