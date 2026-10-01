import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { matterBriefGroundingHash } from "./matter-brief.js";

describe("matter-brief", () => {
  it("returns stable hash when matter has structured grounding", () => {
    const workspaceDir = join(tmpdir(), `lm-brief-${Date.now()}`);
    mkdirSync(workspaceDir, { recursive: true });
    const matterId = "test-matter";
    createMatterIfMissing(workspaceDir, { matterId, title: "测试案" });
    const h1 = matterBriefGroundingHash(workspaceDir, matterId);
    const h2 = matterBriefGroundingHash(workspaceDir, matterId);
    expect(h1).toBeTruthy();
    expect(h1).toBe(h2);
  });

  it("returns undefined hash for missing matter", () => {
    expect(matterBriefGroundingHash("/nonexistent", "nope")).toBeUndefined();
  });
});
