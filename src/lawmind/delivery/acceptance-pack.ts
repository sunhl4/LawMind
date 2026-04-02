/**
 * Phase D: single Markdown bundle for procurement / IT sign-off (governance + quality).
 */

import { buildQualityReportMarkdown } from "../evaluation/quality.js";
import { buildGovernanceReportMarkdown } from "../policy/governance-report.js";

/**
 * Composes governance report and quality report with a short sign-off checklist.
 */
export async function buildAcceptancePackMarkdown(workspaceDir: string): Promise<string> {
  const [gov, qual] = await Promise.all([
    buildGovernanceReportMarkdown(workspaceDir),
    buildQualityReportMarkdown(workspaceDir),
  ]);
  return [
    "# LawMind customer acceptance pack",
    "",
    "This document bundles governance and quality snapshots for procurement or IT sign-off.",
    "",
    "---",
    "",
    gov,
    "",
    "---",
    "",
    qual,
    "",
    "## Sign-off checklist",
    "",
    "- [ ] Workspace policy reviewed",
    "- [ ] Audit retention acceptable",
    "- [ ] Quality metrics acceptable for pilot scope",
    "",
  ].join("\n");
}
