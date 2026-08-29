import { describe, expect, it } from "vitest";
import {
  lawyerAudienceLabel,
  lawyerDeliverableTypeLabel,
  lawyerRiskLevelLabel,
} from "./lawmind-lawyer-labels";

describe("lawmind-lawyer-labels", () => {
  it("maps workflow deliverable codes to lawyer Chinese", () => {
    expect(lawyerDeliverableTypeLabel("ppt.training")).toBe("培训课件 / PPT");
    expect(lawyerDeliverableTypeLabel("contract.review")).toBe("合同审查意见");
    expect(lawyerDeliverableTypeLabel("document.general")).toBe("通用文书");
  });

  it("maps risk and audience codes", () => {
    expect(lawyerRiskLevelLabel("high")).toBe("高风险");
    expect(lawyerRiskLevelLabel("low")).toBe("常规");
    expect(lawyerAudienceLabel("solo")).toBe("个人/内部");
    expect(lawyerAudienceLabel("firm")).toBe("所内协作");
  });

  it("returns null for empty input", () => {
    expect(lawyerDeliverableTypeLabel(undefined)).toBeNull();
    expect(lawyerRiskLevelLabel("")).toBeNull();
  });
});
