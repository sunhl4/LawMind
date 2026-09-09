import { describe, expect, it } from "vitest";
import { formatSlotsAsLines } from "./compile-fill.js";
import {
  extractComplaintCompileFill,
  extractLiabilityCapCompileFill,
} from "./complaint-liability-adapters.js";
import { extractLaborCompileFill, extractPeriodCompileFill } from "./labor-period-adapters.js";
import {
  extractLetterAddressFill,
  letterAddressSlots,
  letterAddressToFill,
} from "./letter-fill.js";

describe("compile-fill IR", () => {
  it("letter slots fill from 致/委托人 without inventing", () => {
    const filled = extractLetterAddressFill("起草催告函。致：某科技有限公司。委托人：张三。");
    expect(filled.to).toBe("某科技有限公司");
    expect(filled.client).toBe("张三");
    expect(letterAddressSlots("起草催告函").to).toContain("收函对象");
    expect(letterAddressToFill(filled).kind).toBe("letter.address");
  });

  it("labor and period adapters expose computed engine results", () => {
    const labor = extractLaborCompileFill("工作3年月薪10000，计算违法解除的经济补偿");
    expect(labor.kind).toBe("labor.calc");
    expect(labor.slots.find((s) => s.key === "amount")?.value).toBe("60000");
    expect(formatSlotsAsLines(labor.slots)).toContain("60000");

    const period = extractPeriodCompileFill("2024年1月1日送达判决，计算上诉期届满日");
    expect(period.kind).toBe("period.calc");
    expect(period.slots.find((s) => s.key === "expires")?.value).toBe("2024-01-16");
  });

  it("complaint and liability-cap adapters fill named slots", () => {
    const complaint = extractComplaintCompileFill(
      "原告：张三，被告：某科技有限公司。向海淀区人民法院起诉。写起诉状。",
    );
    expect(complaint.kind).toBe("litigation.complaint");
    expect(complaint.slots.find((s) => s.key === "plaintiffs")?.value).toBe("张三");
    expect(complaint.slots.find((s) => s.key === "defendants")?.value).toContain("某科技");

    const cap = extractLiabilityCapCompileFill("审查这份采购合同，对方要无限责任");
    expect(cap.kind).toBe("liability.cap");
    expect(cap.computed && (cap.computed as { neverHits: string[] }).neverHits).toContain(
      "无限责任",
    );
  });
});
