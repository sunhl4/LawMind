import { describe, expect, it } from "vitest";
import { explainSurgicalSpanViolation } from "./surgical-span-gate.js";

describe("explainSurgicalSpanViolation", () => {
  it("allows short phrase swaps (canonical arbitration example)", () => {
    expect(explainSurgicalSpanViolation("甲方所在地人民法院", "上海仲裁委员会")).toBeUndefined();
  });

  it("allows short end-anchor inserts before period", () => {
    expect(
      explainSurgicalSpanViolation(
        "实际损失。",
        "实际损失，但累计赔偿总额不超过该项目已付软件费用。",
      ),
    ).toBeUndefined();
    expect(
      explainSurgicalSpanViolation("超过部分。", "超过部分，但累计赔偿总额不超过本合同总额。"),
    ).toBeUndefined();
  });

  it("rejects whole-sentence find with period (last-run anti-pattern)", () => {
    const reason = explainSurgicalSpanViolation(
      "并赔偿甲方因此而造成的实际损失。",
      "并赔偿甲方因此而造成的实际损失，但累计赔偿总额不超过该项目已付软件费用。",
    );
    expect(reason).toMatch(/跨度硬门禁/);
    expect(reason).toMatch(/句读|整句/);
  });

  it("rejects paragraph-level finds", () => {
    expect(
      explainSurgicalSpanViolation(
        "第一句有问题。第二句也有问题。第三句保留。",
        "第一句已改。第二句已改。第三句保留。",
      ),
    ).toMatch(/整段|多个句末/);
  });

  it("rejects long sentence rewrite", () => {
    expect(
      explainSurgicalSpanViolation(
        "提交甲方所在地人民法院诉讼解决，胜诉方维权产生的律师费、保全费、诉讼费由败诉方承担。",
        "提交上海仲裁委员会仲裁解决，胜裁方维权产生的律师费、保全费、仲裁费由败裁方承担。",
      ),
    ).toMatch(/跨度硬门禁/);
  });
});
