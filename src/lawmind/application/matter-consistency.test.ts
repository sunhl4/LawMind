import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadMatter, saveMatter } from "../adapters/matter-storage/index.js";
import { ensureCaseWorkspace } from "../memory/index.js";
import { checkMatterConsistency } from "./matter-consistency.js";
import { ensureMatterWithProjection } from "./matter-dual-write.js";
import { createPlannedDeliverable, transitionDeliverable } from "./services/deliverable-service.js";

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

  it("stays consistent after ensureMatterWithProjection and transitionDeliverable", async () => {
    await ensureMatterWithProjection(workspaceDir, {
      matterId: "matter-deliverable",
      title: "交付物案件",
    });
    createPlannedDeliverable(workspaceDir, {
      matterId: "matter-deliverable",
      deliverableId: "del-1",
      kind: "demand-letter",
    });
    transitionDeliverable(workspaceDir, "matter-deliverable", "del-1", "drafting");
    const issues = await checkMatterConsistency(workspaceDir);
    const forMatter = issues.filter((i) => i.matterId === "matter-deliverable");
    expect(forMatter.some((i) => i.code === "missing_matter_json")).toBe(false);
    expect(forMatter.some((i) => i.code === "title_drift")).toBe(false);
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

  it("reports status_drift when CASE 当前阶段 differs from JSON status", async () => {
    await ensureMatterWithProjection(workspaceDir, {
      matterId: "matter-status",
      title: "状态案件",
    });
    const casePath = path.join(workspaceDir, "cases", "matter-status", "CASE.md");
    let raw = await fs.readFile(casePath, "utf8");
    raw = raw.replace(/当前阶段[:：][^\n]*/, "当前阶段: 已结案");
    await fs.writeFile(casePath, raw, "utf8");
    const issues = await checkMatterConsistency(workspaceDir);
    expect(issues.some((i) => i.matterId === "matter-status" && i.code === "status_drift")).toBe(
      true,
    );
  });
});
