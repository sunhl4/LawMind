import { describe, expect, it } from "vitest";
import { defaultRemindBeforeHours, extractLegalEvents } from "./legal-event-extract.js";

describe("extractLegalEvents", () => {
  it("extracts hearing from a summons-like paragraph", () => {
    const events = extractLegalEvents(
      "北京市朝阳区人民法院传票：请于2026年9月15日9时到第三法庭开庭。案号（2026）京0105民初88号。",
    );
    expect(events.some((e) => e.eventKind === "hearing")).toBe(true);
    const hearing = events.find((e) => e.eventKind === "hearing");
    expect(hearing?.dueAt).toMatch(/^2026-09-15/);
  });

  it("extracts court SMS 12368 hearing", () => {
    const events = extractLegalEvents("【12368】请于2026-10-08 09:30到本院参加庭审。");
    expect(events[0]?.eventKind).toBe("hearing");
    expect(events[0]?.dueAt).toBeTruthy();
  });

  it("returns empty for unrelated text", () => {
    expect(extractLegalEvents("今天天气不错")).toEqual([]);
  });

  it("treats 保全 as a deadline kind so 到期/续封 lands in the reminder system", () => {
    const events = extractLegalEvents(
      "民事裁定书：查封被告名下房产，保全期限至2027年3月1日，届满前须申请续封。",
    );
    const preservation = events.find((e) => e.eventKind === "preservation");
    expect(preservation).toBeTruthy();
    expect(preservation?.dueAt).toMatch(/^2027-03-01/);
    // 保全提前一周提醒（未续封会直接损失担保财产）。
    expect(defaultRemindBeforeHours("preservation")).toBe(168);
  });

  it("labels 续封 separately from the original 保全", () => {
    const events = extractLegalEvents("关于续冻银行存款的申请：2026年12月1日前提交。");
    expect(events.some((e) => e.eventKind === "preservation" && e.title.includes("续封"))).toBe(
      true,
    );
  });
});
