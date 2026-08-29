import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureStanceFromRedline,
  formatStanceHint,
  readStanceItems,
  upsertStanceFromRedline,
  writeStanceFromHabit,
  writeStanceItems,
} from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-stance-"));
  dirs.push(ws);
  return ws;
}

const JURISDICTION_HUNK = {
  before: "由甲方所在地人民法院管辖",
  after: "提交北京仲裁委员会仲裁",
  heading: "争议解决",
  status: "accepted" as const,
};

describe("stance library", () => {
  it("stores an accepted 管辖 hunk", () => {
    const ws = tmpWs();
    const item = upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK });
    expect(item?.clauseType).toBe("管辖");
    expect(item?.preferredLanguage).toContain("北京仲裁委员会");
    expect(item?.source).toBe("redline");
    expect(item?.occurrences).toBe(1);
    expect(item?.confidence).toBeCloseTo(0.4);
    expect(item?.supersededBy).toBeUndefined();
    const stored = readStanceItems(ws);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(item?.id);
    expect(fs.existsSync(path.join(ws, "lawmind", "stance", "items.json"))).toBe(true);
  });

  it("keeps latest wording and supersedes the old item on conflict", () => {
    const ws = tmpWs();
    const first = upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK });
    const second = upsertStanceFromRedline({
      workspaceDir: ws,
      hunk: {
        ...JURISDICTION_HUNK,
        after: "提交上海仲裁委员会仲裁",
      },
    });
    expect(second?.preferredLanguage).toContain("上海仲裁委员会");
    expect(second?.occurrences).toBe(2);
    expect(second?.id).not.toBe(first?.id);
    const items = readStanceItems(ws);
    const old = items.find((it) => it.id === first?.id);
    expect(old?.supersededBy).toBe(second?.id);
    expect(old?.preferredLanguage).toContain("北京仲裁委员会");
    const active = items.filter((it) => !it.supersededBy);
    expect(active).toHaveLength(1);
    expect(active[0]?.preferredLanguage).toContain("上海");
  });

  it("omits low-confidence items from formatStanceHint", () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    writeStanceItems(ws, [
      {
        id: "st_low",
        clauseType: "保密",
        position: "保密期限三年",
        preferredLanguage: "保密期限三年",
        source: "manual",
        confidence: 0.3,
        occurrences: 10,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "st_ok",
        clauseType: "管辖",
        position: "北京仲裁",
        preferredLanguage: "提交北京仲裁委员会仲裁",
        source: "redline",
        confidence: 0.4,
        occurrences: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const hint = formatStanceHint(ws);
    expect(hint).toContain("已按你确认的条款立场");
    expect(hint).toContain("【管辖】");
    expect(hint).toContain("北京仲裁委员会");
    expect(hint).not.toContain("保密");
    expect(hint).not.toContain("st_low");
  });

  it("ignores a rejected hunk", () => {
    const ws = tmpWs();
    const item = upsertStanceFromRedline({
      workspaceDir: ws,
      hunk: { ...JURISDICTION_HUNK, status: "rejected" },
    });
    expect(item).toBeUndefined();
    expect(readStanceItems(ws)).toEqual([]);
    expect(
      captureStanceFromRedline({
        workspaceDir: ws,
        hunk: { ...JURISDICTION_HUNK, status: "pending" },
      }),
    ).toBeUndefined();
  });

  it("parses an adopted habit payload into stance", () => {
    const ws = tmpWs();
    const item = writeStanceFromHabit(
      ws,
      "审查「管辖」条款时，默认采用：提交北京仲裁委员会仲裁（5 次，已取最新改法）",
    );
    expect(item?.clauseType).toBe("管辖");
    expect(item?.source).toBe("habit_adopt");
    expect(item?.occurrences).toBe(5);
    expect(item?.confidence).toBeCloseTo(0.8);
    expect(item?.preferredLanguage).toBe("提交北京仲裁委员会仲裁");
  });
});
