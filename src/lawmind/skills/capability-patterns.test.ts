import { describe, expect, it } from "vitest";
import { FAMILY_MATTER_RE, QUICK_TRIAGE_RE } from "./capability-patterns.js";
import { bindLawyerCapability } from "./lawyer-capabilities.js";

describe("capability-patterns", () => {
  it("keeps bind and the shared matcher on the same 快问 / 家事 cues", () => {
    expect(QUICK_TRIAGE_RE.test("他一直拖欠工资这算不算违法")).toBe(true);
    expect(bindLawyerCapability({ instruction: "他一直拖欠工资这算不算违法" })?.id).toBe(
      "analysis.quick",
    );
    expect(FAMILY_MATTER_RE.test("这份离婚诉讼材料怎么主张抚养权")).toBe(true);
    expect(bindLawyerCapability({ instruction: "这份离婚诉讼材料怎么主张抚养权" })?.id).toBe(
      "family.matter",
    );
  });
});
