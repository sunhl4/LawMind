import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthorityUsageSummary, recordAuthorityUsage } from "./authority-usage.js";

describe("authority-usage", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-auth-usage-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("separates valid empty results from HTTP-200 quota errors and legacy data", () => {
    recordAuthorityUsage(workspaceDir, { ok: false, httpStatus: 200, provider: "pkulaw" });
    recordAuthorityUsage(workspaceDir, {
      ok: true,
      httpStatus: 200,
      provider: "pkulaw",
      outcome: { status: "empty", hitCount: 0, httpStatus: 200 },
    });
    recordAuthorityUsage(workspaceDir, {
      ok: false,
      httpStatus: 200,
      provider: "pkulaw",
      outcome: { status: "quota_exhausted", hitCount: 0, httpStatus: 200 },
    });
    recordAuthorityUsage(workspaceDir, {
      ok: true,
      httpStatus: 200,
      provider: "pkulaw",
      outcome: { status: "ok", hitCount: 3, httpStatus: 200 },
    });
    expect(buildAuthorityUsageSummary(workspaceDir)).toMatchObject({
      total: 4,
      ok: 2,
      error: 2,
      hits: 3,
      unclassified: 1,
      byOutcome: { ok: 1, empty: 1, quota_exhausted: 1 },
    });
  });

  it("records ok/error without storing query text", () => {
    recordAuthorityUsage(workspaceDir, { ok: true, httpStatus: 200, provider: "pkulaw" });
    recordAuthorityUsage(workspaceDir, { ok: false, httpStatus: 429, provider: "pkulaw" });
    const s = buildAuthorityUsageSummary(workspaceDir);
    expect(s.total).toBe(2);
    expect(s.ok).toBe(1);
    expect(s.error).toBe(1);
    expect(s.message).not.toMatch(/解除|押金|query/i);
  });
});
