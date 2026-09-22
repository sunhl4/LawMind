import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendProductMetric } from "../metrics/product-metrics.js";
import { buildLawyerScorecard, scorecardDisplayRows } from "./lawyer-scorecard.js";

describe("lawyer scorecard", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scorecard-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("shows 暂无样本 instead of inventing rates on a fresh workspace", () => {
    const card = buildLawyerScorecard(workspaceDir);
    const firstPass = card.rows.find((r) => r.id === "first_pass");
    expect(firstPass?.value).toBe("暂无样本");
    expect(firstPass?.rate).toBeNull();
    // 真稿与法源两行也在（Doctor 展示口径）。
    const rows = scorecardDisplayRows(card);
    expect(rows.some((r) => r.id === "true_manuscript")).toBe(true);
    expect(rows.some((r) => r.id === "authority")).toBe(true);
  });

  it("computes first-pass and rewrite rates from real metric events", () => {
    appendProductMetric(workspaceDir, { kind: "first_pass", outcome: "ok" });
    appendProductMetric(workspaceDir, { kind: "first_pass", outcome: "ok" });
    appendProductMetric(workspaceDir, { kind: "rewrite", outcome: "rewrite" });
    const card = buildLawyerScorecard(workspaceDir);
    const rows = scorecardDisplayRows(card);
    const rewrite = rows.find((r) => r.id === "rewrite");
    // 2 次一次通过 + 1 次重写 = 重写 1/3。
    expect(rewrite?.value).toContain("1 次");
    expect(rewrite?.value).toContain("3 交件");
  });

  it("reports the true-manuscript gate honestly: not_run without a report", () => {
    const card = buildLawyerScorecard(workspaceDir);
    expect(card.trueManuscript.status).toBe("not_run");
    expect(card.trueManuscript.detail).toContain("还没跑过真稿闸门");
  });

  it("reads the persisted true-manuscript trend report when present", () => {
    const dir = path.join(workspaceDir, "lawmind", "metrics");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "true-manuscript-report.json"),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        status: "pass",
        dir: "/tmp/fixtures",
        files: [{ name: "nda.docx", ok: true }],
        baselines: [
          { file: "nda.docx", kind: "contract", ok: true },
          { file: "complaint.docx", kind: "complaint", ok: false },
        ],
        byKind: { contract: { total: 1, ok: 1 }, complaint: { total: 1, ok: 0 } },
      }),
      "utf8",
    );
    const card = buildLawyerScorecard(workspaceDir);
    expect(card.trueManuscript.status).toBe("pass");
    expect(card.trueManuscript.passed).toBe(1);
    expect(card.trueManuscript.total).toBe(2);
    const row = scorecardDisplayRows(card).find((r) => r.id === "true_manuscript");
    expect(row?.value).toBe("1/2");
  });

  it("labels the authority source truthfully", () => {
    const prev = process.env.LAWMIND_OPEN_LAW_NPC;
    process.env.LAWMIND_OPEN_LAW_NPC = "0";
    try {
      const card = buildLawyerScorecard(workspaceDir);
      expect(card.authority.live).toBe(false);
      expect(card.authority.label).toContain("演示语料");
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prev;
      }
    }
    const withNpc = buildLawyerScorecard(workspaceDir);
    expect(withNpc.authority.label).toContain("国家法律法规数据库");
  });
});
