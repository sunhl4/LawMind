import { describe, expect, it } from "vitest";
import { formatRevisionTimestamp, planRevisionTimestamps } from "./revision-timestamps.js";

const NOW = new Date("2026-10-30T09:30:00Z");

describe("planRevisionTimestamps", () => {
  it("returns nothing when there is no revision", () => {
    expect(planRevisionTimestamps({ count: 0, seed: "task", now: NOW })).toEqual([]);
  });

  it("gives every revision a distinct, strictly increasing time before export", () => {
    const dates = planRevisionTimestamps({ count: 12, seed: "task-1", now: NOW });
    expect(dates).toHaveLength(12);
    expect(new Set(dates).size).toBe(12);
    const times = dates.map((date) => Date.parse(date));
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThan(times[index - 1]);
    }
    expect(times.at(-1)!).toBeLessThan(NOW.getTime());
    // 一次审阅不该是几秒钟，也不该拖过四小时。
    const span = times.at(-1)! - times[0];
    expect(span).toBeGreaterThan(60_000);
    expect(span).toBeLessThan(4 * 60 * 60_000);
  });

  it("is deterministic for the same seed and export time", () => {
    const first = planRevisionTimestamps({ count: 8, seed: "task-2", now: NOW });
    const second = planRevisionTimestamps({ count: 8, seed: "task-2", now: NOW });
    expect(second).toEqual(first);
  });

  it("uses a different rhythm for a different task", () => {
    const first = planRevisionTimestamps({ count: 8, seed: "task-a", now: NOW });
    const second = planRevisionTimestamps({ count: 8, seed: "task-b", now: NOW });
    expect(second).not.toEqual(first);
  });

  it("never puts a revision before the baseline file existed", () => {
    const notBefore = new Date(NOW.getTime() - 3 * 60_000);
    const dates = planRevisionTimestamps({
      count: 20,
      seed: "task-3",
      now: NOW,
      notBefore,
      // 固定节奏：尾差 40 秒、每处间隔 7 分钟，确保压缩分支被走到。
      random: () => 0,
    });
    const times = dates.map((date) => Date.parse(date));
    expect(times[0]).toBeGreaterThanOrEqual(notBefore.getTime());
    expect(times.at(-1)!).toBeLessThan(NOW.getTime());
    expect(new Set(dates).size).toBe(20);
  });

  it("moves the review window forward when the baseline is newer than the natural end", () => {
    // 基线在导出前 30 秒才保存：理想结束点（导出前 40 秒）已经早于基线，
    // 必须整段后移，不能把修订时间排到文件出现之前。
    const notBefore = new Date(NOW.getTime() - 30_000);
    const dates = planRevisionTimestamps({
      count: 6,
      seed: "task-shift",
      now: NOW,
      notBefore,
      random: () => 0,
    });
    const times = dates.map((date) => Date.parse(date));
    expect(times[0]).toBeGreaterThanOrEqual(notBefore.getTime());
    expect(times.at(-1)!).toBeLessThan(NOW.getTime());
    expect(new Set(dates).size).toBe(6);
  });

  it("uses millisecond spacing when there are more revisions than available seconds", () => {
    const notBefore = new Date(NOW.getTime() - 41_000);
    const dates = planRevisionTimestamps({
      count: 6,
      seed: "task-4",
      now: NOW,
      notBefore,
      random: () => 0,
    });
    const times = dates.map((date) => Date.parse(date));
    expect(new Set(dates).size).toBe(6);
    for (const time of times) {
      expect(time).toBeGreaterThanOrEqual(notBefore.getTime());
      expect(time).toBeLessThan(NOW.getTime());
    }
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThan(times[index - 1]);
    }
  });

  it("formats Word dates without milliseconds", () => {
    expect(formatRevisionTimestamp(new Date("2026-10-30T09:15:32.987Z"))).toBe(
      "2026-10-30T09:15:33Z",
    );
  });
});
