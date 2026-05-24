import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { listMemorySuggestions } from "./adoption-service.js";
import { writeCaseMemorySection } from "./write-gateway.js";

describe("memory/write-gateway", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-write-gw-"));
    await fs.mkdir(path.join(workspaceDir, "cases", "matter-a"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("writes case section and mirrors auto_adopted adoption record", async () => {
    await writeCaseMemorySection({
      workspaceDir,
      matterId: "matter-a",
      section: "core_issue",
      content: "争点：合同解除条件",
    });
    const caseMd = await fs.readFile(
      path.join(workspaceDir, "cases", "matter-a", "CASE.md"),
      "utf8",
    );
    expect(caseMd).toContain("争点：合同解除条件");
    const all = await listMemorySuggestions(workspaceDir);
    expect(all.some((p) => p.kind === "case.core_issue" && p.state === "auto_adopted")).toBe(true);
  });

  it("tracks risk section via same adoption mirror", async () => {
    await writeCaseMemorySection({
      workspaceDir,
      matterId: "matter-a",
      section: "risk",
      content: "风险：证据链不完整",
      trackAdoption: true,
      sourceTaskId: "task-1",
      origin: "agent",
    });
    const all = await listMemorySuggestions(workspaceDir);
    expect(all.some((p) => p.kind === "case.risk_note" && p.state === "auto_adopted")).toBe(true);
  });
});
