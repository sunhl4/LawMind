import { describe, expect, it } from "vitest";
import { taskIdForReviewFile } from "./lawmind-open-contract-revision";

describe("taskIdForReviewFile", () => {
  it("opens the draft bound to the original when the chat link is the exported copy", () => {
    const taskId = taskIdForReviewFile(
      [
        {
          taskId: "task-9",
          outputPath: "/Users/shl/nvidia/YX/非技术相关/采购合同模板/基建工程类合同/国浩改-26年9月-装饰装修施工合同_20260928_01.docx",
          contractEdit: {
            baselineRelativePath: "非技术相关/采购合同模板/基建工程类合同/国浩改-26年9月-装饰装修施工合同.docx",
          },
        },
      ],
      "非技术相关/采购合同模板/基建工程类合同/国浩改-26年9月-装饰装修施工合同_20260928_01.docx",
    );
    expect(taskId).toBe("task-9");
  });

  it("opens the draft whose title is the chat filename, even when the original path differs", () => {
    const taskId = taskIdForReviewFile(
      [
        {
          taskId: "task-buy",
          title: "国浩改-26年9月-通用采购合同（修订稿）",
          contractEdit: {
            baselineRelativePath: "非技术相关/通用采购合同（修订稿）.docx",
          },
        },
      ],
      "非技术相关/国浩改-26年9月-通用采购合同（修订稿）.docx",
    );
    expect(taskId).toBe("task-buy");
  });
});
