import { describe, expect, it } from "vitest";
import { formatLitigationStageLine, inferLitigationStage } from "./litigation-stage.js";

describe("litigation-stage", () => {
  it("routes appeal / enforcement / filing / complaint from the instruction", () => {
    expect(inferLitigationStage("写上诉状").stage).toBe("appeal");
    expect(inferLitigationStage("写执行异议").stage).toBe("enforcement");
    expect(inferLitigationStage("列立案材料清单").stage).toBe("filing");
    expect(inferLitigationStage("写起诉状").stage).toBe("first_instance");
    expect(inferLitigationStage("取保候审申请怎么写").stage).toBe("criminal");
  });

  it("does not steal a generic research query into a civil stage", () => {
    expect(inferLitigationStage("查一下审查起诉的法条").stage).toBe("criminal");
    expect(inferLitigationStage("合同审查意见怎么写").stage).toBe("unknown");
    expect(formatLitigationStageLine("写起诉状")).toContain("一审");
    expect(formatLitigationStageLine("取保候审申请怎么写")).toContain("不要套民事起诉状");
  });
});
