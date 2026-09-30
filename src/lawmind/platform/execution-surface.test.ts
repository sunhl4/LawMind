import { describe, expect, it } from "vitest";
import { buildExecutionSurfaceReport, EXECUTION_SURFACE_CATALOG } from "./execution-surface.js";

describe("execution-surface", () => {
  it("catalog covers all four kinds and has unique ids", () => {
    const kinds = new Set(EXECUTION_SURFACE_CATALOG.map((i) => i.kind));
    expect(kinds).toEqual(new Set(["persistent", "rebuildable", "ephemeral", "credential"]));
    const ids = EXECUTION_SURFACE_CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("report lines are lawyer-facing and do not invent counts of zero kinds", () => {
    const report = buildExecutionSurfaceReport();
    expect(report.persistent.length).toBeGreaterThan(0);
    expect(report.lines).toHaveLength(3);
    expect(report.lines[0]).toContain("持久");
    expect(report.lines.join("\n")).not.toMatch(/pid|SIG|HTTP/i);
  });
});
