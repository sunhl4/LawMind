import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadMatter, saveMatter } from "../adapters/matter-storage/index.js";
import { ensureCaseWorkspace } from "../memory/index.js";
import { checkMatterConsistency } from "./matter-consistency.js";
import { ensureMatterWithProjection } from "./matter-dual-write.js";

describe("application/matter-consistency", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-matter-consistency-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("reports missing matter.json when only CASE.md exists", async () => {
    await ensureCaseWorkspace(workspaceDir, "matter-x");
    const issues = await checkMatterConsistency(workspaceDir);
    expect(issues.some((i) => i.matterId === "matter-x" && i.code === "missing_matter_json")).toBe(
      true,
    );
  });

  it("reports title_drift when CASE display name differs from JSON title", async () => {
    await ensureMatterWithProjection(workspaceDir, {
      matterId: "matter-drift",
      title: "JSON 标题",
    });
    const record = loadMatter(workspaceDir, "matter-drift");
    expect(record).toBeDefined();
    saveMatter(workspaceDir, { ...record!, title: "另一标题" });
    const issues = await checkMatterConsistency(workspaceDir);
    expect(issues.some((i) => i.matterId === "matter-drift" && i.code === "title_drift")).toBe(
      true,
    );
  });
});
