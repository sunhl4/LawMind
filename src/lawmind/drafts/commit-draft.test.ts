import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import {
  commitDraft,
  completionSidecarPath,
  type DeliverableCompletionRecord,
} from "./commit-draft.js";
import { evaluateMechanicalVerdict, type MechanicalSignals } from "./mechanical-verdict.js";
import { persistResearchSnapshot } from "./research-snapshot.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-commit-"));
  dirs.push(dir);
  return dir;
}

function draft(over: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "task-commit-1",
    title: "备忘",
    summary: "核对",
    sections: [{ heading: "一", body: "正文", citations: [] }],
    reviewStatus: "pending",
    reviewNotes: [],
    output: "docx",
    templateId: "word/memo",
    createdAt: "2026-09-24T00:00:00.000Z",
    ...over,
  };
}

function bundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "核对",
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: "2026-09-24T00:00:00.000Z",
  };
}

function readCompletion(workspaceDir: string, taskId: string): DeliverableCompletionRecord {
  const raw = fs.readFileSync(completionSidecarPath(workspaceDir, taskId), "utf8");
  return JSON.parse(raw) as DeliverableCompletionRecord;
}

describe("commitDraft", () => {
  it("file channel writes the draft and a drafting completion without a research snapshot", () => {
    const workspaceDir = workspace();
    const next = draft();
    const stored = commitDraft(workspaceDir, next, { channel: "file" });
    expect(fs.existsSync(stored)).toBe(true);
    expect(readCompletion(workspaceDir, next.taskId).completion).toBe("drafting");
    expect(readCompletion(workspaceDir, next.taskId).channel).toBe("file");
  });

  it("pipeline channel refuses to write when the research snapshot is missing", () => {
    const workspaceDir = workspace();
    expect(() =>
      commitDraft(workspaceDir, draft(), {
        channel: "pipeline",
        researchSnapshot: true,
        audit: true,
        reasoningGraph: "when-spec-requires",
      }),
    ).toThrow(/research.json/);
    expect(fs.existsSync(path.join(workspaceDir, "drafts", "task-commit-1.json"))).toBe(false);
  });

  it("pipeline channel stamps mechanical_green when the snapshot checks clean and the draft is still pending", () => {
    const workspaceDir = workspace();
    const next = draft();
    persistResearchSnapshot(workspaceDir, bundle(next.taskId));
    commitDraft(workspaceDir, next, {
      channel: "pipeline",
      researchSnapshot: true,
      audit: true,
      reasoningGraph: "when-spec-requires",
    });
    const record = readCompletion(workspaceDir, next.taskId);
    expect(record.channel).toBe("pipeline");
    expect(record.completion).toBe("mechanical_green");
    expect(record.mechanicalGreen).toBe(true);
  });

  it("approved by a lawyer is signed; system auto-deliver stays review_passed", () => {
    const workspaceDir = workspace();
    commitDraft(workspaceDir, draft({ reviewStatus: "approved", reviewedBy: "lawyer:desk" }), {
      channel: "file",
    });
    expect(readCompletion(workspaceDir, "task-commit-1").completion).toBe("signed");

    const auto = draft({
      taskId: "task-auto",
      reviewStatus: "approved",
      reviewedBy: "system:auto_deliver",
    });
    commitDraft(workspaceDir, auto, { channel: "file" });
    expect(readCompletion(workspaceDir, auto.taskId).completion).toBe("review_passed");
  });
});

describe("evaluateMechanicalVerdict", () => {
  it("returns the same blocks for the same signals regardless of which path built them", () => {
    const signals: MechanicalSignals = {
      citation: {
        checked: true,
        ok: false,
        missingSourceIds: ["s1"],
        sectionsWithIssues: [],
        unanchoredSections: [],
      },
      acceptanceReady: false,
      redlinePending: 0,
    };
    const fromPipeline = evaluateMechanicalVerdict({ ...signals });
    const fromAgent = evaluateMechanicalVerdict({
      citation: signals.citation,
      acceptanceReady: signals.acceptanceReady,
      redlinePending: signals.redlinePending,
    });
    expect(fromAgent).toEqual(fromPipeline);
    expect(fromPipeline.green).toBe(false);
    expect(fromPipeline.blocks).toEqual(["citation", "acceptance", "empty_redline"]);
  });
});
