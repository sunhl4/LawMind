import { describe, expect, it } from "vitest";
import {
  assertTrainingDesensitizeGate,
  redactTrainingText,
  scanTextForTrainingLeak,
} from "./desensitize-matter.js";

describe("desensitize-matter", () => {
  it("flags phone and id card as blockers", () => {
    const scan = scanTextForTrainingLeak("联系人手机 13800138000，身份证 110101199001011234");
    expect(scan.blockerCount).toBeGreaterThanOrEqual(1);
    expect(scan.ready).toBe(false);
  });

  it("allows training when instruction confirms desensitization", () => {
    const gate = assertTrainingDesensitizeGate({
      matterText: "当事人电话 13912345678",
      instruction: "用于培训，材料已脱敏",
    });
    expect(gate.ok).toBe(true);
  });

  it("blocks training when sensitive and not confirmed", () => {
    const gate = assertTrainingDesensitizeGate({
      matterText: "当事人电话 13912345678",
      instruction: "做培训 PPT",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toMatch(/脱敏/);
    }
  });

  it("redacts obvious PII for preview", () => {
    const out = redactTrainingText("电话 13800138000 邮箱 a@b.com");
    expect(out).toContain("[手机号已脱敏]");
    expect(out).toContain("[邮箱已脱敏]");
  });
});
