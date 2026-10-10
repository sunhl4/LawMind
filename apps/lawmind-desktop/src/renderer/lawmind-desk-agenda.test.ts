import { describe, expect, it } from "vitest";
import {
  agendaBucketFor,
  agendaKindLabel,
  agendaProgressLabel,
  buildAgendaSections,
  isViewMatterIntent,
  resolveMatterIdFromViewIntent,
} from "./lawmind-desk-agenda";

describe("lawmind-desk-agenda", () => {
  const noon = new Date(2026, 9, 10, 12, 0, 0);

  it("buckets overdue / today / week / memo", () => {
    expect(
      agendaBucketFor({ kind: "deadline", dueAt: "2026-10-01T00:00:00.000Z", done: false }, noon),
    ).toBe("overdue");
    expect(
      agendaBucketFor({ kind: "deadline", dueAt: "2026-10-10T15:00:00", done: false }, noon),
    ).toBe("today");
    expect(
      agendaBucketFor({ kind: "deadline", dueAt: "2026-10-14T09:00:00", done: false }, noon),
    ).toBe("week");
    expect(agendaBucketFor({ kind: "plan", done: false }, noon)).toBe("memo");
  });

  it("builds ordered sections and kind labels", () => {
    const sections = buildAgendaSections(
      [
        {
          id: "d1",
          kind: "deadline",
          title: "甲案 · 开庭",
          done: false,
          dueAt: "2026-10-01T00:00:00.000Z",
        },
        { id: "p1", kind: "plan", title: "回电王总", done: false },
        {
          id: "m1",
          kind: "mail",
          title: "待回复 · 催稿",
          done: false,
          matterId: "case-a",
        },
      ],
      { todayDate: "2026-10-10", now: noon },
    );
    expect(sections.map((s) => s.id)).toEqual(["overdue", "memo"]);
    expect(agendaKindLabel("deadline", "甲案 · 开庭")).toBe("开庭");
    expect(agendaKindLabel("mail", "法院来件 · 传票")).toBe("法院");
    expect(agendaProgressLabel(1, 3)).toBe("今日已办 1 / 3");
  });

  it("resolves view-matter intent from bound chip or title", () => {
    expect(isViewMatterIntent("帮我看看买卖合同纠纷的案件详情")).toBe(true);
    expect(isViewMatterIntent("审一下这份合同")).toBe(false);
    expect(
      resolveMatterIdFromViewIntent("打开买卖合同纠纷的案件管理", [
        { matterId: "m1", title: "买卖合同纠纷" },
        { matterId: "m2", title: "安静顾问" },
      ]),
    ).toBe("m1");
    expect(
      resolveMatterIdFromViewIntent("打开案件管理看看", [{ matterId: "m1", title: "买卖合同纠纷" }], "m9"),
    ).toBe("m9");
  });
});
