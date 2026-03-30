import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureTaskRecord } from "../../../src/lawmind/tasks/index.js";
import type { TaskIntent } from "../../../src/lawmind/types.js";
import {
  buildDoctorStats,
  countAuditJsonlFiles,
  countResearchSnapshots,
  tryReadOpenClawPackageVersion,
} from "./lawmind-health-payload.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-health-"));
}

describe("lawmind-health-payload", () => {
  it("countAuditJsonlFiles returns 0 when audit missing", () => {
    const ws = tmpWs();
    expect(countAuditJsonlFiles(ws)).toBe(0);
  });

  it("countAuditJsonlFiles counts jsonl only", () => {
    const ws = tmpWs();
    const ad = path.join(ws, "audit");
    fs.mkdirSync(ad, { recursive: true });
    fs.writeFileSync(path.join(ad, "2026-01-01.jsonl"), "{}\n", "utf8");
    fs.writeFileSync(path.join(ad, "readme.txt"), "x", "utf8");
    expect(countAuditJsonlFiles(ws)).toBe(1);
  });

  it("buildDoctorStats reflects tasks and drafts", () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId: "t-doc",
      kind: "draft.word",
      output: "docx",
      summary: "s",
      riskLevel: "low",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "m1",
      templateId: "word/legal-memo-default",
    };
    ensureTaskRecord(ws, intent);
    const draftsDir = path.join(ws, "drafts");
    fs.mkdirSync(draftsDir, { recursive: true });
    fs.writeFileSync(
      path.join(draftsDir, "t-doc.json"),
      JSON.stringify({
        taskId: "t-doc",
        title: "T",
        output: "docx",
        templateId: "word/legal-memo-default",
        summary: "s",
        sections: [],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: now,
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(draftsDir, "t-doc.research.json"), "{}", "utf8");
    const st = buildDoctorStats(ws);
    expect(st.taskCount).toBe(1);
    expect(st.draftCount).toBe(1);
    expect(st.researchSnapshotCount).toBe(1);
    expect(countResearchSnapshots(ws)).toBe(1);
    expect(st.auditJsonlFileCount).toBe(0);
  });

  it("tryReadOpenClawPackageVersion reads repo package.json", () => {
    const v = tryReadOpenClawPackageVersion(path.join(import.meta.dirname, "../../.."));
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("tryReadOpenClawPackageVersion returns null for bad path", () => {
    expect(tryReadOpenClawPackageVersion("/nonexistent-openclaw-root-xyz")).toBe(null);
  });
});
