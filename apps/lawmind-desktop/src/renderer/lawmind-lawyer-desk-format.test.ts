import { describe, expect, it } from "vitest";
import {
  formatDeskDate,
  hearingCountdown,
  isOverdue,
  matterHotLine,
  matterMatchesListFilter,
  matterStatusZh,
  urgencyListRank,
  type MatterUrgencyInput,
} from "./lawmind-lawyer-desk-format";

describe("lawmind-lawyer-desk-format", () => {
  it("formats a desk date with the weekday", () => {
    expect(formatDeskDate("2026-09-27")).toBe("9月27日 周日");
  });

  it("treats a past due instant as overdue and a missing one as not", () => {
    expect(isOverdue(undefined)).toBe(false);
    expect(isOverdue("2000-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("counts hearing days in lawyer language", () => {
    expect(hearingCountdown(0)).toBe("今天开庭");
    expect(hearingCountdown(1)).toBe("明天开庭");
    expect(hearingCountdown(2)).toBe("后天开庭");
    expect(hearingCountdown(5)).toBe("还有 5 天开庭");
    expect(hearingCountdown(-1)).toBe("开庭已过 1 天");
    expect(hearingCountdown(null)).toBeNull();
  });

  it("keeps one hottest line and ranks overdue ahead of a quiet case", () => {
    const overdue: MatterUrgencyInput = {
      status: "open",
      outboundCount: 2,
      unreplied: true,
      overdueDeadline: true,
      daysUntilHearing: 2,
    };
    expect(matterHotLine(overdue)).toBe("期限已过");
    expect(matterHotLine({ ...overdue, overdueDeadline: false })).toBe("2 封待发出");
    expect(
      matterHotLine({
        status: "open",
        outboundCount: 1,
        unreplied: false,
        overdueDeadline: false,
      }),
    ).toBe("有一封待发出");
    expect(
      matterHotLine({
        status: "open",
        outboundCount: 0,
        unreplied: true,
        overdueDeadline: false,
      }),
    ).toBe("有来信未回");
    expect(
      matterHotLine({
        status: "open",
        outboundCount: 0,
        unreplied: false,
        overdueDeadline: false,
        daysUntilHearing: 2,
      }),
    ).toBe("后天开庭");
    expect(
      matterHotLine({
        status: "open",
        outboundCount: 0,
        unreplied: false,
        overdueDeadline: false,
        daysUntilDeadline: 1,
      }),
    ).toBe("明天到期");
    expect(
      matterHotLine({
        status: "open",
        outboundCount: 0,
        unreplied: false,
        overdueDeadline: false,
        daysUntilHearing: 20,
      }),
    ).toBeNull();

    const quiet: MatterUrgencyInput = {
      status: "open",
      outboundCount: 0,
      unreplied: false,
      overdueDeadline: false,
    };
    expect(urgencyListRank(overdue)).toBeLessThan(urgencyListRank({ ...quiet, daysUntilHearing: 2 }));
    expect(urgencyListRank({ ...quiet, status: "closed" })).toBe(800);
    expect(matterMatchesListFilter("outbound", overdue)).toBe(true);
    expect(matterMatchesListFilter("unreplied", quiet)).toBe(false);
    expect(matterMatchesListFilter("all", quiet)).toBe(true);
  });

  it("maps matter status onto the desk labels", () => {
    expect(matterStatusZh("waiting_on_client")).toBe("等客户");
    expect(matterStatusZh(undefined)).toBe("未标");
  });
});
