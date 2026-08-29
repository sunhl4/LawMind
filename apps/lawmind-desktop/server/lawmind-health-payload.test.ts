import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureTaskRecord } from "../../../src/lawmind/tasks/index.js";
import type { TaskIntent } from "../../../src/lawmind/types.js";
import {
  buildDoctorStats,
  buildMemoryTruthSourceFlags,
  buildP2DoctorReport,
  buildReasoningGraphCoverage,
  buildWorkspaceStandardReport,
  countAuditJsonlFiles,
  countClientProfileFilesUnderClients,
  countResearchSnapshots,
  tryReadWorkspacePackageVersion,
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
    expect(st.reasoningGraphCoverage.requiredDraftCount).toBe(0);
    expect(st.reasoningGraphCoverage.ratio).toBe(null);
  });

  it("buildReasoningGraphCoverage tracks high-risk drafts with reasoning graph", () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    const draftsDir = path.join(ws, "drafts");
    fs.mkdirSync(draftsDir, { recursive: true });
    fs.writeFileSync(
      path.join(draftsDir, "t-high.json"),
      JSON.stringify({
        taskId: "t-high",
        title: "Demand",
        output: "docx",
        templateId: "letter-demand-default",
        deliverableType: "letter.demand",
        summary: "s",
        sections: [],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: now,
        hasLegalReasoningSnapshot: true,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(draftsDir, "t-missing.json"),
      JSON.stringify({
        taskId: "t-missing",
        title: "Litigation",
        output: "docx",
        templateId: "litigation-outline-default",
        deliverableType: "litigation.outline",
        summary: "s",
        sections: [],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: now,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(draftsDir, "t-low.json"),
      JSON.stringify({
        taskId: "t-low",
        title: "General",
        output: "docx",
        templateId: "document-general-default",
        deliverableType: "document.general",
        summary: "s",
        sections: [],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: now,
      }),
      "utf8",
    );
    const cov = buildReasoningGraphCoverage(ws);
    expect(cov.requiredDraftCount).toBe(2);
    expect(cov.withSnapshotCount).toBe(1);
    expect(cov.ratio).toBe(0.5);
  });

  it("tryReadWorkspacePackageVersion reads repo package.json", () => {
    const v = tryReadWorkspacePackageVersion(path.join(import.meta.dirname, "../../.."));
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("tryReadWorkspacePackageVersion returns null for bad path", () => {
    expect(tryReadWorkspacePackageVersion("/nonexistent-lawmind-repo-root-xyz")).toBe(null);
  });

  it("buildWorkspaceStandardReport flags missing memory and ok workflows", () => {
    const ws = tmpWs();
    const missing = buildWorkspaceStandardReport(ws);
    expect(missing.ok).toBe(false);
    expect(missing.checks.find((c) => c.id === "memory_md")?.state).toBe("missing");

    fs.writeFileSync(path.join(ws, "MEMORY.md"), "m", "utf8");
    fs.writeFileSync(path.join(ws, "LAWYER_PROFILE.md"), "p", "utf8");
    const wfDir = path.join(ws, "lawmind", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, "sample.json"), "{}", "utf8");
    const tplDir = path.join(ws, "templates", "word");
    fs.mkdirSync(tplDir, { recursive: true });

    const ok = buildWorkspaceStandardReport(ws);
    expect(ok.checks.find((c) => c.id === "memory_md")?.state).toBe("ok");
    expect(ok.checks.find((c) => c.id === "workflows")?.state).toBe("ok");
    expect(ok.checks.find((c) => c.id === "word_templates")?.state).toBe("ok");
  });

  it("buildMemoryTruthSourceFlags reports root files and client profile counts", () => {
    const ws = tmpWs();
    fs.writeFileSync(path.join(ws, "MEMORY.md"), "m", "utf8");
    fs.writeFileSync(path.join(ws, "FIRM_PROFILE.md"), "f", "utf8");
    const clients = path.join(ws, "clients", "c1");
    fs.mkdirSync(clients, { recursive: true });
    fs.writeFileSync(path.join(clients, "CLIENT_PROFILE.md"), "p", "utf8");
    const flags = buildMemoryTruthSourceFlags(ws);
    expect(flags.memoryMd).toBe(true);
    expect(flags.lawyerProfile).toBe(false);
    expect(flags.firmProfile).toBe(true);
    expect(flags.clientProfileRoot).toBe(false);
    expect(flags.clientProfileFilesUnderClients).toBe(1);
    expect(countClientProfileFilesUnderClients(ws)).toBe(1);
  });

  it("buildP2DoctorReport reports sandbox off and team sync disabled by default", () => {
    const ws = tmpWs();
    const p2 = buildP2DoctorReport(ws);
    expect(p2.toolSandbox.enabled).toBe(false);
    expect(p2.toolSandbox.source).toBe("off");
    expect(p2.toolSandbox.sandboxedToolNames.length).toBeGreaterThan(0);
    expect(p2.teamMemorySync.allowed).toBe(false);
    expect(p2.teamMemorySync.reason).toBe("team_memory_sync_disabled");
  });
});
