import { describe, expect, it } from "vitest";
import {
  annotateDeskDeadlines,
  deadlineSourceLabel,
  isAppealLimitation,
  isDeadlineReleased,
  sanitizeDeadlineDependsOn,
  suggestDependsOnDeadlineId,
  wouldCreateDeadlineCycle,
} from "./deadline-chain.js";

describe("deadline-chain", () => {
  it("labels known sources for the desk", () => {
    expect(deadlineSourceLabel("document_extract")).toBe("传票抽取");
    expect(deadlineSourceLabel("manual")).toBe("律师手记");
    expect(deadlineSourceLabel("mystery")).toBe("mystery");
  });

  it("recognizes appeal-style limitations only", () => {
    expect(isAppealLimitation("limitation", "上诉期限")).toBe(true);
    expect(isAppealLimitation("limitation", "举证期限届满")).toBe(false);
    expect(isAppealLimitation("filing", "上诉期限")).toBe(false);
  });

  it("releases when predecessor is missing or completed; never gates hearings", () => {
    const rows = [
      {
        deadlineId: "h1",
        title: "开庭",
        eventKind: "hearing",
        status: "open",
        dependsOnDeadlineId: "ghost",
      },
      {
        deadlineId: "a1",
        title: "上诉期限",
        eventKind: "limitation",
        status: "open",
        dependsOnDeadlineId: "h1",
      },
    ];
    expect(isDeadlineReleased(rows[0]!, rows)).toBe(true);
    expect(isDeadlineReleased(rows[1]!, rows)).toBe(false);
    expect(
      isDeadlineReleased(rows[1]!, [{ ...rows[0]!, status: "completed" }, rows[1]!]),
    ).toBe(true);
    expect(isDeadlineReleased({ deadlineId: "x", dependsOnDeadlineId: "missing" }, rows)).toBe(
      true,
    );
  });

  it("rejects self-deps and cycles when sanitizing", () => {
    const rows = [
      { deadlineId: "a", dependsOnDeadlineId: "b" },
      { deadlineId: "b", dependsOnDeadlineId: "a" },
      { deadlineId: "c" },
    ];
    expect(wouldCreateDeadlineCycle("a", "b", rows)).toBe(true);
    expect(sanitizeDeadlineDependsOn({ deadlineId: "c", dependsOnDeadlineId: "c" }, rows)).toBe(
      undefined,
    );
    expect(sanitizeDeadlineDependsOn({ deadlineId: "c", dependsOnDeadlineId: "a" }, rows)).toBe(
      "a",
    );
    expect(
      sanitizeDeadlineDependsOn(
        { deadlineId: "h", eventKind: "hearing", dependsOnDeadlineId: "a" },
        rows,
      ),
    ).toBeUndefined();
  });

  it("suggests the latest prior hearing for an appeal limitation", () => {
    const candidates = [
      {
        deadlineId: "h-old",
        eventKind: "hearing",
        status: "open",
        dueAt: "2026-09-01T01:00:00.000Z",
      },
      {
        deadlineId: "h-new",
        eventKind: "hearing",
        status: "open",
        dueAt: "2026-09-15T01:00:00.000Z",
      },
      {
        deadlineId: "ev",
        eventKind: "filing",
        status: "open",
        dueAt: "2026-09-10T01:00:00.000Z",
        title: "举证期限",
      },
    ];
    expect(
      suggestDependsOnDeadlineId({
        eventKind: "limitation",
        title: "上诉期限",
        dueAt: "2026-09-30T01:00:00.000Z",
        candidates,
      }),
    ).toBe("h-new");
    expect(
      suggestDependsOnDeadlineId({
        eventKind: "filing",
        title: "举证期限",
        dueAt: "2026-09-20T01:00:00.000Z",
        candidates,
      }),
    ).toBeUndefined();
  });

  it("annotates desk views with waiting copy", () => {
    const views = annotateDeskDeadlines([
      {
        deadlineId: "h1",
        matterId: "m1",
        title: "开庭",
        dueAt: "2026-09-15T01:00:00.000Z",
        severity: "hard",
        source: "document_extract",
        status: "open",
        eventKind: "hearing",
      },
      {
        deadlineId: "a1",
        matterId: "m1",
        title: "上诉期限",
        dueAt: "2026-09-30T01:00:00.000Z",
        severity: "soft",
        source: "document_extract",
        status: "open",
        eventKind: "limitation",
        dependsOnDeadlineId: "h1",
      },
    ]);
    expect(views[0]?.released).toBe(true);
    expect(views[0]?.sourceLabel).toBe("传票抽取");
    expect(views[1]?.released).toBe(false);
    expect(views[1]?.waitingOnTitle).toBe("开庭");
  });
});
