import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMatterContextFragmentBody } from "./matter-context-fragment.js";

describe("matter-context-fragment", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matter-frag-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("returns undefined for unknown or empty matters", async () => {
    expect(buildMatterContextFragmentBody({ workspaceDir, matterId: "nope" })).toBeUndefined();
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    createMatterIfMissing(workspaceDir, { matterId: "m-empty", title: "空案件" });
    expect(buildMatterContextFragmentBody({ workspaceDir, matterId: "m-empty" })).toBeUndefined();
  });

  it("packs parties, open deadlines, materials and timeline into one brief", async () => {
    const { createMatterIfMissing, updateMatterProfile } =
      await import("../application/services/matter-write-service.js");
    const { applyLegalEvents } = await import("../desk/desk-apply.js");
    createMatterIfMissing(workspaceDir, { matterId: "m-full", title: "买卖合同纠纷" });
    await updateMatterProfile(workspaceDir, {
      matterId: "m-full",
      parties: [
        { name: "张三", role: "client" },
        { name: "李四", role: "counterparty" },
      ],
    });
    const applied = await applyLegalEvents(workspaceDir, "m-full", [
      {
        eventKind: "hearing",
        title: "开庭",
        dueAt: "2026-10-12T01:00:00.000Z",
        notes: "第三法庭",
      },
    ]);
    expect(applied.ok).toBe(true);
    const materialsDir = path.join(workspaceDir, "cases", "m-full", "materials");
    fs.mkdirSync(materialsDir, { recursive: true });
    fs.writeFileSync(path.join(materialsDir, "合同扫描件.txt"), "合同正文", "utf8");

    const body = buildMatterContextFragmentBody({ workspaceDir, matterId: "m-full" });
    expect(body).toBeDefined();
    expect(body).toContain("本案速览 [m-full]");
    expect(body).toContain("委托人 张三");
    expect(body).toContain("对方 李四");
    expect(body).toContain("2026-10-12 开庭");
    expect(body).toContain("合同扫描件.txt");
    expect(body).toContain("近期进展");
  });

  it("hides completed deadlines and caps list sizes", async () => {
    const { createMatterIfMissing } =
      await import("../application/services/matter-write-service.js");
    const { applyLegalEvents } = await import("../desk/desk-apply.js");
    const { listDeadlinesForMatter } = await import("../application/services/deadline-service.js");
    createMatterIfMissing(workspaceDir, { matterId: "m-cap", title: "期限案" });
    const applied = await applyLegalEvents(
      workspaceDir,
      "m-cap",
      Array.from({ length: 7 }, (_, i) => ({
        eventKind: "filing" as const,
        title: `事项${i + 1}`,
        dueAt: `2026-11-${String(i + 10).padStart(2, "0")}T01:00:00.000Z`,
        notes: "",
      })),
    );
    expect(applied.ok).toBe(true);
    expect(listDeadlinesForMatter(workspaceDir, "m-cap").length).toBe(7);
    const body = buildMatterContextFragmentBody({ workspaceDir, matterId: "m-cap" });
    expect(body).toBeDefined();
    expect(body).toContain("事项1");
    expect(body).toContain("事项5");
    expect(body).not.toContain("事项6");
  });
});
