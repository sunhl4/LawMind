import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAuthorityUsageSummary,
  recordAuthorityUsage,
} from "./authority-usage.js";

describe("authority-usage", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-auth-usage-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
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
