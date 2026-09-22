import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  persistClauseSnapshot,
  readClauseSnapshot,
  resolveClauseGraphForDraft,
} from "./clause-snapshot.js";

function draft(): ArtifactDraft {
  return {
    taskId: "t-clause-snap",
    title: "租赁合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.rental",
    summary: "测",
    sections: [{ heading: "第一条 租金", body: "乙方应当按月支付租金。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

describe("clause snapshot", () => {
  it("fills missing criticNotes when reading older files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-clause-snap-"));
    persistClauseSnapshot(dir, {
      taskId: "t-clause-snap",
      clauses: [
        {
          id: "c1",
          heading: "第一条 租金",
          body: "乙方应当按月支付租金。",
          kind: "article",
          risks: [],
          missing: ["有义务表述，但未写后果"],
          criticNotes: ["押金未写清"],
        },
      ],
      riskCount: 0,
      missingCount: 1,
      builtAt: new Date().toISOString(),
    });
    expect(readClauseSnapshot(dir, "t-clause-snap")?.clauses[0]?.criticNotes).toEqual([
      "押金未写清",
    ]);
    expect(resolveClauseGraphForDraft(dir, draft()).clauses[0]?.heading).toContain("第一条");
  });
});
