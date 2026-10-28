/**
 * P1.2 冲突扫描：确定性匹配、每个命中带来源、空扫描不能当无冲突。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { addAdmissionCandidates, createAdmission, loadAdmission } from "./admission.js";
import { scanAdmissionConflicts, scanConflictOfInterest } from "./conflict-scan.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-conflict-scan-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seedIndexOnlyMatter(dir: string, matterId: string, body: string) {
  fs.mkdirSync(path.join(dir, "cases", matterId), { recursive: true });
  fs.writeFileSync(path.join(dir, "cases", matterId, "CASE.md"), body, "utf8");
}

describe("conflict scan service", () => {
  it("finds counterparties in matter records and names in CASE.md, excluding the intake matter", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "intake-case", title: "新案", status: "intake" });
    createAdmission(dir, {
      matterId: "intake-case",
      candidates: [
        { name: "李四", role: "counterparty", source: "intake" },
        { name: "王五", role: "related", source: "intake" },
      ],
    });
    createMatterIfMissing(dir, { matterId: "old-case", title: "旧案", status: "closed" });
    await updateMatterProfile(dir, {
      matterId: "old-case",
      parties: [{ partyId: "p1", name: "李四", role: "counterparty" }],
    });
    seedIndexOnlyMatter(dir, "index-only", "# 他案\n\n## 4. 核心争点\n- 王五 欠款\n");

    const result = await scanAdmissionConflicts(dir, "intake-case", { by: "lawyer" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byMatter = new Map(result.scan.hits.map((hit) => [hit.matterId, hit]));
    expect(byMatter.get("old-case")).toMatchObject({
      partyName: "李四",
      source: "matter_record",
    });
    expect(byMatter.get("old-case")?.reason).toContain("已结案件/前客户");
    expect(byMatter.get("index-only")).toMatchObject({
      partyName: "王五",
      source: "matter_index",
    });
    expect([...byMatter.keys()]).not.toContain("intake-case");
    expect(result.admission.status).toBe("lawyer_review");
    expect(result.admission.conflict.status).toBe("hit");
  });

  it("scans workspace memory separately and labels the source", async () => {
    const dir = workspace();
    fs.writeFileSync(path.join(dir, "MEMORY.md"), "张三公司是我们的长期客户。\n", "utf8");
    const scan = await scanConflictOfInterest(dir, ["张三公司"]);
    expect(scan.scannedWorkspaceMemory).toBe(true);
    expect(scan.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matterId: "(workspace-memory)",
          partyName: "张三公司",
          source: "workspace_memory",
        }),
      ]),
    );
  });

  it("refuses to treat an empty candidate list as a clean scan", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "empty-case", title: "无候选", status: "intake" });
    createAdmission(dir, { matterId: "empty-case" });
    const result = await scanAdmissionConflicts(dir, "empty-case", { by: "lawyer" });
    expect(result).toEqual({ ok: false, error: "no_candidates" });
    expect(loadAdmission(dir, "empty-case")?.status).toBe("prospective");
  });

  it("records a clear scan and picks up lawyer-added candidates", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "clear-case", title: "新案", status: "intake" });
    createAdmission(dir, {
      matterId: "clear-case",
      candidates: [{ name: "赵六", role: "client", source: "intake" }],
    });
    const added = addAdmissionCandidates(dir, "clear-case", {
      candidates: [{ name: "钱七", role: "related", source: "lawyer" }],
      by: "lawyer",
    });
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(added.admission.candidates.map((row) => row.name)).toEqual(["赵六", "钱七"]);
    }

    const result = await scanAdmissionConflicts(dir, "clear-case", { by: "lawyer" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scan.hits).toEqual([]);
      expect(result.admission.conflict.status).toBe("clear");
      expect(result.admission.status).toBe("lawyer_review");
    }
  });

  it("does not rescan an accepted or declined admission", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "decided-case", title: "新案", status: "intake" });
    createAdmission(dir, {
      matterId: "decided-case",
      candidates: [{ name: "赵六", role: "client", source: "intake" }],
      ownerLawyerId: "lawyer",
    });
    await scanAdmissionConflicts(dir, "decided-case", { by: "lawyer" });
    const { acknowledgeAdmissionDisclosures, decideAdmission } = await import("./admission.js");
    acknowledgeAdmissionDisclosures(dir, "decided-case", { risk: true, ai: true, by: "lawyer" });
    decideAdmission(dir, "decided-case", { decision: "accept", by: "lawyer" });
    expect(await scanAdmissionConflicts(dir, "decided-case", { by: "lawyer" })).toEqual({
      ok: false,
      error: "already_decided",
    });
  });
});
