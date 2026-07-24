import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { persistDraft } from "./index.js";
import { readDraft } from "./index.js";
import {
  generateRedlineProposal,
  readRedlineProposal,
  resetRedlineBaselineFromDraft,
  resolveAllRedlineHunks,
  resolveRedlineHunk,
  writeRedlineProposal,
} from "./redline-proposal.js";

describe("redline-proposal", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("baseline then edit then generate produces hunks and accept applies", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-2",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [{ heading: "Intro", body: "Version A" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    const baseline = resetRedlineBaselineFromDraft(ws, draft.taskId);
    expect(baseline.ok).toBe(true);
    draft.sections[0].body = "Version B";
    persistDraft(ws, draft);
    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    expect(gen.proposal.hunks.length).toBe(1);
    const hunkId = gen.proposal.hunks[0].hunkId;
    const resolved = resolveRedlineHunk(ws, draft.taskId, hunkId, "accept");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || !resolved.draft) {
      return;
    }
    expect(resolved.draft.sections[0]?.body).toBe("Version B");
  });

  it("generates hunks when section body changes and accept applies to draft", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-1",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [{ heading: "Intro", body: "Original text" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    resetBaseline(ws, draft);
    draft.sections[0].body = "Revised text";
    persistDraft(ws, draft);

    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    expect(gen.proposal.hunks.length).toBe(1);
    const hunkId = gen.proposal.hunks[0].hunkId;

    const resolved = resolveRedlineHunk(ws, draft.taskId, hunkId, "accept");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || !resolved.draft) {
      return;
    }
    expect(resolved.draft.sections[0]?.body).toBe("Revised text");
    const stored = readRedlineProposal(ws, draft.taskId);
    expect(stored?.hunks[0]?.status).toBe("accepted");
  });

  it("reject reverts draft body to before", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-reject",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [{ heading: "Intro", body: "Original" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    resetRedlineBaselineFromDraft(ws, draft.taskId);
    draft.sections[0].body = "Changed by agent";
    persistDraft(ws, draft);
    const gen = generateRedlineProposal(ws, draft.taskId);
    expect(gen.ok).toBe(true);
    if (!gen.ok) {
      return;
    }
    const hunkId = gen.proposal.hunks[0].hunkId;
    const rejected = resolveRedlineHunk(ws, draft.taskId, hunkId, "reject");
    expect(rejected.ok).toBe(true);
    const after = readDraft(ws, draft.taskId);
    expect(after?.sections[0]?.body).toBe("Original");
    expect(readRedlineProposal(ws, draft.taskId)?.hunks[0]?.status).toBe("rejected");
  });

  it("resolveAll accept applies every pending hunk", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-"));
    dirs.push(ws);
    const draft: ArtifactDraft = {
      taskId: "task-redline-all",
      title: "Test",
      output: "markdown",
      templateId: "default",
      summary: "s",
      sections: [
        { heading: "A", body: "a0" },
        { heading: "B", body: "b0" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);
    resetRedlineBaselineFromDraft(ws, draft.taskId);
    draft.sections[0].body = "a1";
    draft.sections[1].body = "b1";
    persistDraft(ws, draft);
    expect(generateRedlineProposal(ws, draft.taskId).ok).toBe(true);
    const all = resolveAllRedlineHunks(ws, draft.taskId, "accept");
    expect(all.ok).toBe(true);
    if (!all.ok) {
      return;
    }
    expect(all.resolved).toBe(2);
    expect(readDraft(ws, draft.taskId)?.sections.map((s) => s.body)).toEqual(["a1", "b1"]);
  });
});

function resetBaseline(ws: string, draft: ArtifactDraft): void {
  writeRedlineProposal(ws, {
    taskId: draft.taskId,
    baselineSections: draft.sections.map((s) => ({ ...s })),
    hunks: [],
    updatedAt: new Date().toISOString(),
  });
}
