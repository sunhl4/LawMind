import { describe, expect, it } from "vitest";
import { isIncompleteWorkerBrief, validateWorkerBrief } from "./worker-brief.js";

describe("worker-brief", () => {
  it("rejects a bare 帮我看看", () => {
    expect(isIncompleteWorkerBrief("帮我看看")).toBe(true);
    expect(validateWorkerBrief({ task: "帮我看看" }).ok).toBe(false);
  });

  it("accepts a self-contained letter QA brief", () => {
    const result = validateWorkerBrief({
      task: "帮我看看",
      goal: "根据文件夹核对接律师函是否有误",
      notGoal: "合同审查、审阅痕迹稿",
      materials: "【河南堃云顿数据科技有限公司】先 list_dir",
      output: "列出函内具体错误并引用材料路径",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brief).toContain("不要做：合同审查");
      expect(result.brief).toContain("材料：");
    }
  });

  it("accepts a long task without structured fields", () => {
    const result = validateWorkerBrief({
      task: "请根据案件文件夹核对我起草的律师函事实与主体是否写错，不要改合同。",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a short complete goal with materials", () => {
    const result = validateWorkerBrief({
      goal: "核对律师函主体是否写错",
      notGoal: "合同审查",
      materials: "函件文件夹",
    });
    expect(result.ok).toBe(true);
  });
});
