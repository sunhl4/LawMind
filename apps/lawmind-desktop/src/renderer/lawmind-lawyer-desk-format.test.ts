import { describe, expect, it } from "vitest";
import {
  formatDeskDate,
  hearingCountdown,
  isOverdue,
  matterStatusZh,
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
    expect(hearingCountdown(2)).toBe("还有 2 天开庭");
    expect(hearingCountdown(-1)).toBe("开庭已过 1 天");
    expect(hearingCountdown(null)).toBeNull();
  });

  it("maps matter status onto the desk labels", () => {
    expect(matterStatusZh("waiting_on_client")).toBe("等客户");
    expect(matterStatusZh(undefined)).toBe("未标");
  });
});
