import { describe, expect, it } from "vitest";
import { applySurgicalTextEdits } from "./apply-surgical-edits.js";
import {
  craftSignalsForEdit,
  evaluateCraftCheck,
  CONTRACT_REDLINE_CRAFT_SKILL,
} from "./contract-redline-craft.js";

describe("contract-redline-craft", () => {
  it("skill teaches hard span gate with unlimited edit count", () => {
    expect(CONTRACT_REDLINE_CRAFT_SKILL).toContain("硬门禁");
    expect(CONTRACT_REDLINE_CRAFT_SKILL).toContain("条数不限");
    expect(CONTRACT_REDLINE_CRAFT_SKILL).toContain("能改几个字就只改几个字");
    expect(CONTRACT_REDLINE_CRAFT_SKILL).toContain("实际损失。");
    expect(CONTRACT_REDLINE_CRAFT_SKILL).not.toContain("最多 24");
    expect(CONTRACT_REDLINE_CRAFT_SKILL).not.toContain("2–3 处");
  });

  it("applies phrase-level edits", () => {
    const r = applySurgicalTextEdits({
      sections: [{ heading: "十一", body: "由甲方所在地人民法院诉讼解决。" }],
      edits: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.sections[0]?.body).toContain("上海仲裁委员会");
  });

  it("soft-warns wide clause spans that still pass hard gate", () => {
    const signals = craftSignalsForEdit(
      "甲方所在地人民法院，诉讼解决，相关安排",
      "上海仲裁委员会，仲裁解决，相关安排",
    );
    expect(signals.some((s) => s.code === "wide_span_clause")).toBe(true);
  });

  it("coaches missing craft_check", () => {
    const s = evaluateCraftCheck(undefined);
    expect(s.some((x) => x.code === "craft_check_missing")).toBe(true);
  });
});
