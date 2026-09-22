/**
 * Lawyer-visible similar-case panel. Reuses CASE.md recall; does not mix old facts into this case.
 */

import fs from "node:fs";
import path from "node:path";
import { parseMatterCaseProfileFields } from "../cases/matter-profile.js";
import { caseFilePath } from "../memory/index.js";
import { findSimilarCaseMemories, type SimilarCaseHit } from "../memory/similar-case-recall.js";

export type SimilarCaseDeskHit = SimilarCaseHit & {
  causeOfAction?: string;
  evidenceHints: string[];
  displayWarning: string;
};

function evidenceHints(caseText: string): string[] {
  const m = /##\s*\d+\.\s*证据[\s\S]*?(?:\n##\s+\d+\.|$)/.exec(caseText);
  const body = m?.[0] ?? "";
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l.length > 1 && !l.startsWith("_"))
    .slice(0, 6);
}

export async function listSimilarCasesForDesk(opts: {
  workspaceDir: string;
  matterId: string;
  query?: string;
}): Promise<SimilarCaseDeskHit[]> {
  let query = opts.query?.trim() ?? "";
  if (!query) {
    try {
      query = fs
        .readFileSync(caseFilePath(opts.workspaceDir, opts.matterId), "utf8")
        .slice(0, 4000);
    } catch {
      query = opts.matterId;
    }
  }
  const hits = await findSimilarCaseMemories({
    workspaceDir: opts.workspaceDir,
    instruction: query,
    currentMatterId: opts.matterId,
    limit: 5,
    minScore: 0.12,
  });
  return hits.map((hit) => {
    let causeOfAction: string | undefined;
    let hints: string[] = [];
    try {
      const full = fs.readFileSync(path.join(opts.workspaceDir, hit.relativePath), "utf8");
      causeOfAction = parseMatterCaseProfileFields(full).causeOfAction;
      hints = evidenceHints(full);
    } catch {
      /* ignore */
    }
    return {
      ...hit,
      causeOfAction,
      evidenceHints: hints,
      displayWarning: "旧案事实不得写入本案。只作案由与证据整理对照。",
    };
  });
}
