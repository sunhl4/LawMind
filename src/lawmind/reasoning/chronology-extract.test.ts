import { describe, expect, it } from "vitest";
import { formatChronologyBody } from "./chronology-extract.js";
import { extractDatedSnippets, parseFirstYmd } from "./cn-date.js";

describe("chronology-extract", () => {
  it("parses mixed Chinese and ISO dates", () => {
    expect(parseFirstYmd("2024年1月1日送达")).toBe("2024-01-01");
    expect(parseFirstYmd("起算 2024-03-15")).toBe("2024-03-15");
    expect(extractDatedSnippets("2024年1月1日签合同，2024年3月1日付款").map((r) => r.ymd)).toEqual([
      "2024-01-01",
      "2024-03-01",
    ]);
  });

  it("writes a linear chronology without markdown tables", () => {
    const body = formatChronologyBody("整理时间线：2024年1月1日签合同，2024年3月1日付款");
    expect(body).toContain("2024-01-01");
    expect(body).toContain("2024-03-01");
    expect(body).not.toMatch(/\| --- \|/);
  });
});
