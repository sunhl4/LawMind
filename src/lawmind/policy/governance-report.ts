/**
 * Phase C: firm-wide governance Markdown report (policy + quality + golden + optional audit counts).
 */

import path from "node:path";
import { readAllAuditLogs } from "../audit/index.js";
import { listGoldenTaskIds } from "../evaluation/golden.js";
import { listQualityRecords } from "../evaluation/quality.js";
import { readWorkspacePolicyFile } from "./workspace-policy.js";

/**
 * Single Markdown document for IT / compliance: policy file status, quality snapshot stats, golden list size.
 */
export async function buildGovernanceReportMarkdown(workspaceDir: string): Promise<string> {
  const policy = readWorkspacePolicyFile(workspaceDir);
  const records = await listQualityRecords(workspaceDir);
  const goldenIds = await listGoldenTaskIds(workspaceDir);

  let auditEventCount = 0;
  try {
    const events = await readAllAuditLogs(path.join(workspaceDir, "audit"));
    auditEventCount = events.length;
  } catch {
    auditEventCount = 0;
  }

  const approved = records.filter((r) => r.reviewStatus === "approved").length;
  const goldenRecords = records.filter((r) => r.isGoldenExample).length;

  const lines = [
    "# LawMind governance report (Phase C)",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Workspace policy (`lawmind.policy.json`)",
    "",
  ];

  if (policy) {
    lines.push(
      "| Field | Value |",
      "|-------|-------|",
      `| schemaVersion | ${policy.schemaVersion} |`,
      `| edition | ${policy.edition ?? "—"} |`,
      `| benchmarkGateMinScore | ${policy.benchmarkGateMinScore ?? "—"} |`,
      `| auditExportCadenceHint | ${policy.auditExportCadenceHint ?? "—"} |`,
      `| allowWebSearch | ${policy.allowWebSearch === undefined ? "—" : String(policy.allowWebSearch)} |`,
      `| enableCollaboration | ${policy.enableCollaboration === undefined ? "—" : String(policy.enableCollaboration)} |`,
      "",
    );
  } else {
    lines.push(
      "_No valid `lawmind.policy.json` found. Optional; see [LawMind policy file](/LAWMIND-POLICY-FILE)._",
      "",
    );
  }

  lines.push(
    "## Quality snapshots",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total records | ${records.length} |`,
    `| Approved | ${approved} |`,
    `| Marked golden (in quality index) | ${goldenRecords} |`,
    "",
    "## Golden examples (`golden/`)",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Files in golden/ | ${goldenIds.length} |`,
    "",
  );

  lines.push("## Audit logs", "", `- Total events read: ${auditEventCount}`, "");

  return lines.join("\n");
}
