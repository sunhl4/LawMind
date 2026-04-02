import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { QualityRecord } from "../types.js";
import { writeQualityDashboardJson } from "./export-json.js";

describe("writeQualityDashboardJson", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("writes dashboard.json from quality snapshots", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-qjson-"));
    const qdir = path.join(tmp, "quality");
    await fs.mkdir(qdir, { recursive: true });
    const rec: QualityRecord = {
      taskId: "t-export-1",
      taskKind: "analyze.contract",
      templateId: "tpl",
      citationValidityRate: 0.9,
      issueCoverageRate: null,
      riskRecallRate: null,
      firstPassApproved: true,
      reviewStatus: "approved",
      reviewLabels: [],
      isGoldenExample: false,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(qdir, "t-export-1.quality.json"), JSON.stringify(rec), "utf8");

    const out = await writeQualityDashboardJson(tmp);
    expect(out).toContain("dashboard.json");
    const raw = await fs.readFile(out, "utf8");
    const parsed = JSON.parse(raw) as {
      schemaVersion: number;
      recordCount: number;
      byTaskKind: Record<string, number>;
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.recordCount).toBe(1);
    expect(parsed.byTaskKind["analyze.contract"]).toBe(1);
  });
});
