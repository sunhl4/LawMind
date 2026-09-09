import { describe, expect, it } from "vitest";
import { isProtectedWorkspaceRel } from "./protected-workspace-rels.js";

describe("isProtectedWorkspaceRel", () => {
  it("blocks exact governance files at workspace root", () => {
    expect(isProtectedWorkspaceRel("lawmind.policy.json")).toBe(true);
    expect(isProtectedWorkspaceRel(".env")).toBe(true);
    expect(isProtectedWorkspaceRel(".env.lawmind")).toBe(true);
  });

  it("blocks governance/evidence prefixes", () => {
    expect(isProtectedWorkspaceRel("lawmind/mcp-servers.json")).toBe(true);
    expect(isProtectedWorkspaceRel("lawmind/jobs/job-1.json")).toBe(true);
    expect(isProtectedWorkspaceRel("lawmind/deliverables/custom.json")).toBe(true);
    expect(isProtectedWorkspaceRel("audit/2026-09-02.jsonl")).toBe(true);
    expect(isProtectedWorkspaceRel("sessions/s1/session.json")).toBe(true);
    expect(isProtectedWorkspaceRel("tasks/t1.json")).toBe(true);
    expect(isProtectedWorkspaceRel("matters/m1/RULES.md")).toBe(true);
    expect(isProtectedWorkspaceRel("matters/m1/matter.json")).toBe(true);
  });

  it("blocks DMS connection config at any depth", () => {
    expect(isProtectedWorkspaceRel("cases/m1/.lawmind-dms.json")).toBe(true);
    expect(isProtectedWorkspaceRel(".lawmind-dms.json")).toBe(true);
  });

  it("normalizes backslashes and dot prefixes before matching", () => {
    expect(isProtectedWorkspaceRel("lawmind\\mcp-servers.json")).toBe(true);
    expect(isProtectedWorkspaceRel("./audit/x.jsonl")).toBe(true);
    expect(isProtectedWorkspaceRel("/tasks/t1.json")).toBe(true);
  });

  it("allows the data plane (notes/drafts/cases/artifacts/memory)", () => {
    expect(isProtectedWorkspaceRel("notes/分析.md")).toBe(false);
    expect(isProtectedWorkspaceRel("drafts/t1.json")).toBe(false);
    expect(isProtectedWorkspaceRel("cases/m1/证据清单.md")).toBe(false);
    expect(isProtectedWorkspaceRel("artifacts/r1/report.md")).toBe(false);
    expect(isProtectedWorkspaceRel("MEMORY.md")).toBe(false);
    expect(isProtectedWorkspaceRel("LAWYER_PROFILE.md")).toBe(false);
  });

  it("does not over-match lookalike names", () => {
    expect(isProtectedWorkspaceRel("notes/lawmind.policy.json.bak")).toBe(false);
    expect(isProtectedWorkspaceRel("audits/x.json")).toBe(false);
    expect(isProtectedWorkspaceRel("my-tasks/t1.json")).toBe(false);
    expect(isProtectedWorkspaceRel("cases/m1/dms.json")).toBe(false);
  });
});
