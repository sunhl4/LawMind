import { describe, expect, it } from "vitest";
import { runLegalLint } from "../run-lint.js";
import { CONSTRUCTION_LINT_RULES, constructionFamilyApplies } from "./construction.js";
import { EMPLOYMENT_LINT_RULES, employmentFamilyApplies } from "./employment.js";
import { EQUITY_LINT_RULES, equityFamilyApplies } from "./equity.js";
import { LEASE_LINT_RULES, leaseFamilyApplies } from "./lease.js";
import { LOAN_LINT_RULES } from "./loan.js";
import { SALE_LINT_RULES } from "./sale.js";

const CONTRACT = { deliverableType: "contract.review" } as const;
const lint = (text: string) => runLegalLint(text, undefined, undefined, undefined, CONTRACT);

describe("extra family packs", () => {
  it("lease / employment / equity / construction fire on matching titles", () => {
    expect(leaseFamilyApplies("房屋租赁合同", CONTRACT)).toBe(true);
    expect(employmentFamilyApplies("劳动合同", CONTRACT)).toBe(true);
    expect(equityFamilyApplies("股权转让协议", CONTRACT)).toBe(true);
    expect(constructionFamilyApplies("建设工程施工合同", CONTRACT)).toBe(true);
    expect(constructionFamilyApplies("工程承包合同", CONTRACT)).toBe(true);

    const lease = lint("房屋租赁合同\n第一条 甲乙双方订立本合同。");
    expect(lease.findings.some((f) => f.ruleId === "lease.rent")).toBe(true);

    const labor = lint("劳动合同\n第一条 甲方聘用乙方。");
    expect(labor.findings.some((f) => f.ruleId === "employment.pay")).toBe(true);

    const eq = lint("股权转让协议\n第一条 双方同意转让。");
    expect(eq.findings.some((f) => f.ruleId === "equity.ratio")).toBe(true);

    const con = lint("建设工程施工合同\n第一条 承包范围为本工程。");
    expect(con.findings.some((f) => f.ruleId === "construction.schedule")).toBe(true);
  });

  it("does not treat 承包经营 as a construction contract", () => {
    expect(constructionFamilyApplies("承包经营合同。甲方将店铺交乙方承包经营。")).toBe(false);
    const report = runLegalLint("承包经营合同。甲方将店铺交乙方承包经营。");
    expect(report.findings.some((f) => f.family === "construction")).toBe(false);
  });

  it("ships at least eight rules per family pack", () => {
    expect(SALE_LINT_RULES.length).toBeGreaterThanOrEqual(8);
    expect(LOAN_LINT_RULES.length).toBeGreaterThanOrEqual(8);
    expect(LEASE_LINT_RULES.length).toBeGreaterThanOrEqual(8);
    expect(EMPLOYMENT_LINT_RULES.length).toBeGreaterThanOrEqual(8);
    expect(EQUITY_LINT_RULES.length).toBeGreaterThanOrEqual(8);
    expect(CONSTRUCTION_LINT_RULES.length).toBeGreaterThanOrEqual(8);
  });
});

describe("family trigger dual-gate (deliverableType)", () => {
  const withType = (text: string, deliverableType: string) =>
    runLegalLint(text, undefined, undefined, undefined, { deliverableType });

  it("does not fire contract families on an opinion memo that merely mentions keywords", () => {
    const text = "法律意见书\n本案涉及劳动争议，用人单位与劳动者协商一致解除合同。";
    const report = withType(text, "memo.opinion");
    expect(report.findings.some((f) => f.family === "employment")).toBe(false);
  });

  it("still fires when the deliverable type matches the family", () => {
    const report = withType("劳动合同\n第一条 甲方聘用乙方。", "contract.general");
    expect(report.findings.some((f) => f.ruleId === "employment.pay")).toBe(true);
  });

  it("does not fire family rules when deliverableType is unknown", () => {
    const report = runLegalLint("劳动合同\n第一条 甲方聘用乙方。");
    expect(report.findings.some((f) => f.ruleId === "employment.pay")).toBe(false);
    const blank = withType("劳动合同\n第一条 甲方聘用乙方。", "  ");
    expect(blank.findings.some((f) => f.ruleId === "employment.pay")).toBe(false);
  });

  it("gates loan and lease families by their applicable deliverable types", () => {
    const loanText = "借款合同。甲方出借，乙方收款。";
    expect(withType(loanText, "memo.opinion").findings.some((f) => f.family === "loan")).toBe(
      false,
    );
    expect(withType(loanText, "contract.review").findings.some((f) => f.family === "loan")).toBe(
      true,
    );

    const leaseText = "房屋租赁合同\n第一条 甲乙双方订立本合同。";
    expect(
      withType(leaseText, "contract.rental").findings.some((f) => f.ruleId === "lease.rent"),
    ).toBe(true);
    expect(withType(leaseText, "litigation.brief").findings.some((f) => f.family === "lease")).toBe(
      false,
    );
  });
});

describe("lease.term_cap (民法典 §705)", () => {
  const hit = (text: string) => lint(text).findings.find((f) => f.ruleId === "lease.term_cap");

  it("triggers when the lease term exceeds 20 years (Arabic and Chinese numerals)", () => {
    const a = hit("房屋租赁合同\n第一条 租赁期限 25 年，租金按月支付。");
    expect(a?.severity).toBe("blocker");
    expect(a?.statuteRef).toBe("民法典第705条");
    expect(a?.message).toContain("25 年");
    expect(hit("房屋租赁合同\n第一条 租赁期限二十五年，租金按月支付。")).toBeDefined();
  });

  it("does not trigger at or under 20 years, nor on calendar years", () => {
    expect(hit("房屋租赁合同\n第一条 租赁期限二十年，租金按月支付。")).toBeUndefined();
    expect(hit("房屋租赁合同\n第一条 租赁期限 10 年，租金按月支付。")).toBeUndefined();
    expect(hit("房屋租赁合同\n第一条 租期自 2026 年起，租金按月支付。")).toBeUndefined();
  });

  it("parses compound terms (year + month, mixed numerals) against the 240-month cap", () => {
    const cn = hit("房屋租赁合同\n第一条 租期二十年六个月，租金按月支付。");
    expect(cn?.severity).toBe("blocker");
    expect(cn?.message).toContain("20 年 6 个月");
    expect(hit("房屋租赁合同\n第一条 租期20年零3个月，租金按月支付。")).toBeDefined();
    expect(hit("房屋租赁合同\n第一条 租赁期限二十一年，租金按月支付。")).toBeDefined();
  });

  it("does not trigger on compound terms at or under the cap", () => {
    expect(hit("房屋租赁合同\n第一条 租期二十年，租金按月支付。")).toBeUndefined();
    expect(hit("房屋租赁合同\n第一条 租期十九年六个月，租金按月支付。")).toBeUndefined();
    expect(hit("房屋租赁合同\n第一条 租期19年11个月，租金按月支付。")).toBeUndefined();
  });

  it("keeps the calendar-year guard on compound shapes", () => {
    expect(hit("房屋租赁合同\n第一条 租期自 2026 年 3 月起，租金按月支付。")).toBeUndefined();
  });
});

describe("employment.probation_cap (劳动合同法 §19)", () => {
  const hit = (text: string) =>
    lint(text).findings.find((f) => f.ruleId === "employment.probation_cap");

  it("always triggers when probation exceeds six months", () => {
    const h = hit("劳动合同\n第一条 合同期限三年，试用期八个月。");
    expect(h?.severity).toBe("blocker");
    expect(h?.statuteRef).toBe("劳动合同法第19条");
    expect(h?.message).toContain("8 个月");
  });

  it("triggers when a contract shorter than three months sets probation", () => {
    const h = hit("劳动合同\n合同期限二个月，试用期一个月。");
    expect(h?.message).toContain("不得约定");
  });

  it("triggers when a task-based contract sets probation", () => {
    expect(hit("劳动合同\n以完成一定工作任务为期限，试用期一个月。")?.message).toContain(
      "不得约定",
    );
  });

  it("applies the middle ladder when both term and probation parse cleanly", () => {
    expect(hit("劳动合同\n合同期限一年，试用期三个月。")).toBeDefined();
    expect(hit("劳动合同\n合同期限一年，试用期二个月。")).toBeUndefined();
  });

  it("does not trigger within the statutory cap", () => {
    expect(hit("劳动合同\n第一条 合同期限三年，试用期六个月。")).toBeUndefined();
    expect(hit("无固定期限劳动合同\n第一条 试用期六个月。")).toBeUndefined();
  });
});

describe("construction.warranty_floor (建设工程质量管理条例 §40)", () => {
  const hit = (text: string) =>
    lint(text).findings.find((f) => f.ruleId === "construction.warranty_floor");

  it("triggers when roof waterproofing warranty is below five years", () => {
    const h = hit("建设工程施工合同\n第一条 屋面防水工程的保修期为3年。");
    expect(h?.severity).toBe("blocker");
    expect(h?.statuteRef).toBe("建设工程质量管理条例第40条");
    expect(h?.message).toContain("3 年");
    expect(hit("建设工程施工合同\n第一条 屋面防水工程保修期五年。")).toBeUndefined();
  });

  it("triggers when MEP or fit-out warranty is below two years", () => {
    expect(hit("建设工程施工合同\n第一条 电气管线保修1年。")).toBeDefined();
    expect(hit("建设工程施工合同\n第一条 装修工程保修一年。")).toBeDefined();
    expect(hit("建设工程施工合同\n第一条 给排水管道保修2年。")).toBeUndefined();
    expect(hit("建设工程施工合同\n第一条 设备安装保修三年。")).toBeUndefined();
  });

  it("triggers when heating/cooling warranty is below two heating/cooling periods", () => {
    expect(hit("建设工程施工合同\n第一条 供热系统保修1个采暖期。")).toBeDefined();
    expect(hit("建设工程施工合同\n第一条 供冷系统保修两个供冷期。")).toBeUndefined();
  });

  it("stays silent without a warranty context or outside construction drafts", () => {
    expect(hit("建设工程施工合同\n第一条 屋面防水工程预计3年完工。")).toBeUndefined();
    expect(hit("买卖合同\n第一条 屋面防水材料保修3年。")).toBeUndefined();
  });
});

describe("employment.noncompete_cap (劳动合同法 §24)", () => {
  const hit = (text: string) =>
    lint(text).findings.find((f) => f.ruleId === "employment.noncompete_cap");

  it("triggers when the non-compete exceeds two years", () => {
    const h = hit("劳动合同\n第一条 离职后竞业限制期限三年，按月补偿。");
    expect(h?.severity).toBe("blocker");
    expect(h?.statuteRef).toBe("劳动合同法第24条");
    expect(hit("劳动合同\n第一条 竞业限制三十六个月，按月补偿。")).toBeDefined();
  });

  it("does not trigger at or under two years", () => {
    expect(hit("劳动合同\n第一条 竞业限制期限二年，按月补偿。")).toBeUndefined();
    expect(hit("劳动合同\n第一条 竞业限制 24 个月，按月补偿。")).toBeUndefined();
  });
});
