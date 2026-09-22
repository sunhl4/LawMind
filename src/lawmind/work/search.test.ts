import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchLawyerWorks } from "./search.js";
import { createLawyerWork } from "./store.js";

describe("searchLawyerWorks", () => {
  it("finds a prior approved-title work by keyword", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-work-search-"));
    createLawyerWork(ws, {
      title: "甲乙服务合同审查稿",
      goal: "审合同",
      status: "done",
      source: "chat",
    });
    const hits = searchLawyerWorks(ws, "服务合同");
    expect(hits.some((h) => h.title.includes("服务合同"))).toBe(true);
  });
});
