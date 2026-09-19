import { describe, expect, it } from "vitest";
import {
  extractWorkingBriefHints,
  formatWorkingBriefPromptBlock,
  WORKING_BRIEF_HEADING,
} from "./working-brief.js";

const LETTER_QA =
  "我要你做的不是合同审核，是根据【河南堃云顿数据科技有限公司】文件夹里的信息帮我看我起草的律师函内容是否有误";

describe("working-brief", () => {
  it("restates the 律师函 QA without turning it into contract review", () => {
    const hints = extractWorkingBriefHints({ instruction: LETTER_QA });
    expect(hints.notGoal).toContain("合同审查");
    expect(hints.materials).toContain("explore_folder");
    expect(hints.materials).toContain("河南堃云顿");
    expect(hints.goal).toContain("律师函");
    expect(hints.goal).not.toContain("不是合同审核");
    const block = formatWorkingBriefPromptBlock(hints);
    expect(block).toContain(WORKING_BRIEF_HEADING);
    expect(block).toContain("不要做");
    expect(block).toContain("update_plan");
    expect(hints.done).toContain("会话");
    expect(hints.materials).not.toContain("交办");
  });

  it("files a folder into a named matter instead of exploring first", () => {
    const hints = extractWorkingBriefHints({
      instruction: "把诉讼/刘学江侵权纠纷收进刘学江侵权案",
    });
    expect(hints.materials).toContain("import_host_file");
    expect(hints.materials).not.toContain("explore_folder");
  });

  it("does not treat 【交办】 as a folder to explore", () => {
    const hints = extractWorkingBriefHints({
      instruction: "【交办】5 分钟合同审查\n交付物类型：合同审查意见",
    });
    expect(hints.materials).not.toContain("交办");
    expect(hints.materials).not.toContain("explore_folder");
  });

  it("does not treat 合同目录 as a folder to explore", () => {
    const hints = extractWorkingBriefHints({
      instruction: "请审查这份采购合同的合同目录条款",
    });
    expect(hints.materials).not.toContain("explore_folder");
  });
});
