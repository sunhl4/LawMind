import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentFleetSummary } from "../platform/build-agent-fleet.js";
import { readStanceItems } from "../stance/store.js";
import type { ArtifactDraft } from "../types.js";
import { persistDraft, readDraft } from "./index.js";
import { LAWYER_SURFACE_RATIONALE, writeRedlineProposal } from "./redline-proposal.js";
import {
  adoptWordReviewAbs,
  closeWordReviewTicket,
  findOpenWordReviewForBaseline,
  findOpenWordReviewForPin,
  finishWordReviewExport,
  openWordReviewTicket,
  readWordReview,
  syncWordReviewTicketsFromDrafts,
  wordReviewPath,
} from "./word-review.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function draft(partial: Partial<ArtifactDraft> & Pick<ArtifactDraft, "taskId">): ArtifactDraft {
  return {
    title: "意见书",
    output: "docx",
    templateId: "general",
    summary: "",
    sections: [{ heading: "违约金", body: "违约金为合同总额的百分之十。" }],
    reviewNotes: [],
    reviewStatus: "approved",
    createdAt: "2026-09-28T00:00:00.000Z",
    ...partial,
  };
}

describe("word review ticket", () => {
  it("opens after a review copy exists and drops the fleet row once closed", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-review-"));
    dirs.push(workspaceDir);
    const reviewAbs = path.join(workspaceDir, "contracts", "服务合同_20260928_01.docx");
    persistDraft(
      workspaceDir,
      draft({
        taskId: "task-rev",
        matterId: "m1",
        title: "服务合同",
        outputPath: reviewAbs,
        contractEdit: { baselineRelativePath: "contracts/服务合同.docx", mode: "surgical" },
      }),
    );
    writeRedlineProposal(workspaceDir, {
      taskId: "task-rev",
      baselineSections: [{ heading: "违约金", body: "违约金为合同总额的百分之十。" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "十",
          after: "五",
          proposedAfter: "五",
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    const opened = openWordReviewTicket({ workspaceDir, taskId: "task-rev", reviewAbs });
    expect(opened.opened).toBe(true);
    expect(readWordReview(workspaceDir, "task-rev")?.reviewAbs).toBe(reviewAbs);
    expect(fs.existsSync(wordReviewPath(workspaceDir, "task-rev") ?? "")).toBe(true);

    const fleet = await buildAgentFleetSummary({ workspaceDir });
    const row = fleet.runs.find((run) => run.kind === "word_check");
    expect(row?.title).toBe("服务合同.docx");
    expect(row?.subtitle).toBe("1 处修订 · 待核对");
    expect(row?.taskId).toBe("task-rev");
    expect(row?.kind).not.toBe("pending_review");

    closeWordReviewTicket(workspaceDir, "task-rev");
    const again = openWordReviewTicket({ workspaceDir, taskId: "task-rev", reviewAbs });
    expect(again.opened).toBe(false);
    expect(again.reason).toBe("closed");
    const after = await buildAgentFleetSummary({ workspaceDir });
    expect(after.runs.some((run) => run.kind === "word_check")).toBe(false);
  });

  it("finds the open review by baseline or by the working-copy pin", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-review-sticky-"));
    dirs.push(workspaceDir);
    const contracts = path.join(workspaceDir, "contracts");
    fs.mkdirSync(contracts, { recursive: true });
    const reviewAbs = path.join(contracts, "服务合同_20260928_01.docx");
    fs.writeFileSync(reviewAbs, "docx");
    persistDraft(
      workspaceDir,
      draft({
        taskId: "task-sticky",
        title: "服务合同",
        outputPath: reviewAbs,
        contractEdit: { baselineRelativePath: "contracts/服务合同.docx", mode: "surgical" },
      }),
    );
    writeRedlineProposal(workspaceDir, {
      taskId: "task-sticky",
      baselineSections: [{ heading: "违约金", body: "百分之十。" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "十",
          after: "五",
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    expect(openWordReviewTicket({ workspaceDir, taskId: "task-sticky", reviewAbs }).opened).toBe(
      true,
    );
    expect(findOpenWordReviewForBaseline(workspaceDir, "contracts/服务合同.docx")?.taskId).toBe(
      "task-sticky",
    );
    expect(findOpenWordReviewForPin(workspaceDir, "contracts/服务合同.docx")?.taskId).toBe(
      "task-sticky",
    );
    expect(findOpenWordReviewForPin(workspaceDir, reviewAbs)?.taskId).toBe("task-sticky");

    const renamed = path.join(contracts, "服务合同-发包人修订稿.docx");
    fs.renameSync(reviewAbs, renamed);
    expect(findOpenWordReviewForPin(workspaceDir, renamed)?.taskId).toBe("task-sticky");
    expect(adoptWordReviewAbs({ workspaceDir, taskId: "task-sticky", reviewAbs: renamed }).ok).toBe(
      true,
    );
    expect(readWordReview(workspaceDir, "task-sticky")?.reviewAbs).toBe(path.resolve(renamed));
    expect(readDraft(workspaceDir, "task-sticky")?.outputPath).toBe(path.resolve(renamed));
  });

  it("does not queue an opinion drafted from scratch", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-review-opinion-"));
    dirs.push(workspaceDir);
    persistDraft(
      workspaceDir,
      draft({
        taskId: "opinion-1",
        title: "法律意见书",
        outputPath: path.join(workspaceDir, "artifacts", "意见书.docx"),
        reviewStatus: "pending",
      }),
    );
    const opened = openWordReviewTicket({
      workspaceDir,
      taskId: "opinion-1",
      reviewAbs: path.join(workspaceDir, "artifacts", "意见书.docx"),
    });
    expect(opened.opened).toBe(false);
    expect(opened.reason).toBe("no_baseline");
    const fleet = await buildAgentFleetSummary({ workspaceDir });
    expect(fleet.runs.some((run) => run.kind === "word_check")).toBe(false);
    expect(
      fleet.runs.some((run) => run.kind === "pending_review" && run.taskId === "opinion-1"),
    ).toBe(true);
  });
});

describe("word review close stance", () => {
  it("records a preference only when the lawyer's wording differs from proposedAfter", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-review-stance-"));
    dirs.push(workspaceDir);
    persistDraft(
      workspaceDir,
      draft({
        taskId: "task-stance",
        outputPath: "/tmp/review.docx",
        contractEdit: { baselineRelativePath: "contracts/a.docx", mode: "surgical" },
      }),
    );
    writeRedlineProposal(workspaceDir, {
      taskId: "task-stance",
      baselineSections: [],
      hunks: [
        {
          hunkId: "same",
          sectionIndex: 0,
          sectionHeading: "违约金",
          before: "违约金为合同总额的百分之十。",
          after: "违约金为合同总额的百分之三十。",
          proposedAfter: "违约金为合同总额的百分之三十。",
          status: "accepted",
        },
        {
          hunkId: "edited",
          sectionIndex: 0,
          sectionHeading: "违约金",
          before: "违约金为合同总额的百分之十。",
          after: "违约金为合同总额的百分之五。",
          proposedAfter: "违约金为合同总额的百分之三十。",
          status: "accepted",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    openWordReviewTicket({
      workspaceDir,
      taskId: "task-stance",
      reviewAbs: "/tmp/review.docx",
    });
    finishWordReviewExport(workspaceDir, "task-stance");
    const items = readStanceItems(workspaceDir);
    expect(items.map((item) => item.preferredLanguage)).toEqual(["违约金为合同总额的百分之五。"]);
    expect(items[0]?.preferredLanguage).not.toBe("违约金为合同总额的百分之三十。");
    expect(readWordReview(workspaceDir, "task-stance")?.closedAt).toBeTruthy();
  });

  it("records a rejection without adopting the model sentence, and keeps a lawyer-authored example", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-review-reject-"));
    dirs.push(workspaceDir);
    persistDraft(
      workspaceDir,
      draft({
        taskId: "task-reject",
        outputPath: "/tmp/review.docx",
        contractEdit: { baselineRelativePath: "contracts/a.docx", mode: "surgical" },
      }),
    );
    writeRedlineProposal(workspaceDir, {
      taskId: "task-reject",
      baselineSections: [],
      hunks: [
        {
          hunkId: "no",
          sectionIndex: 0,
          sectionHeading: "违约金",
          before: "违约金为合同总额的百分之十。",
          after: "违约金为合同总额的百分之三十。",
          proposedAfter: "违约金为合同总额的百分之三十。",
          status: "rejected",
        },
        {
          hunkId: "mine",
          sectionIndex: 0,
          sectionHeading: "违约金",
          before: "违约金为合同总额的百分之十。",
          after: "违约金为合同总额的百分之八。",
          rationale: LAWYER_SURFACE_RATIONALE,
          status: "accepted",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    openWordReviewTicket({
      workspaceDir,
      taskId: "task-reject",
      reviewAbs: "/tmp/review.docx",
    });
    finishWordReviewExport(workspaceDir, "task-reject");
    const items = readStanceItems(workspaceDir);
    const rejected = items.find((item) => item.rationale === "这次不要这种改法");
    expect(rejected?.preferredLanguage).toBe("违约金为合同总额的百分之十。");
    expect(rejected?.unacceptableLanguage).toBe("违约金为合同总额的百分之三十。");
    expect(rejected?.preferredLanguage).not.toBe(rejected?.unacceptableLanguage);
    expect(items.some((item) => item.preferredLanguage === "违约金为合同总额的百分之八。")).toBe(
      true,
    );
  });

  it("does not record stance when there is no open word-review ticket", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-review-no-ticket-"));
    dirs.push(workspaceDir);
    writeRedlineProposal(workspaceDir, {
      taskId: "task-no-ticket",
      baselineSections: [],
      hunks: [
        {
          hunkId: "edited",
          sectionIndex: 0,
          sectionHeading: "违约金",
          before: "十",
          after: "五",
          proposedAfter: "三",
          status: "accepted",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    finishWordReviewExport(workspaceDir, "task-no-ticket");
    expect(readStanceItems(workspaceDir)).toEqual([]);
  });
});

describe("syncWordReviewTicketsFromDrafts", () => {
  it("backfills an open ticket from an existing draft with outputPath", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-review-backfill-"));
    dirs.push(workspaceDir);
    const reviewAbs = path.join(workspaceDir, "contracts", "合同_20260928_01.docx");
    persistDraft(
      workspaceDir,
      draft({
        taskId: "backfill-1",
        outputPath: reviewAbs,
        contractEdit: { baselineRelativePath: "contracts/合同.docx", mode: "surgical" },
      }),
    );
    writeRedlineProposal(workspaceDir, {
      taskId: "backfill-1",
      baselineSections: [{ heading: "正文", body: "原文" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "原文",
          after: "改过",
          status: "pending",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    syncWordReviewTicketsFromDrafts(workspaceDir);
    expect(readWordReview(workspaceDir, "backfill-1")?.reviewAbs).toBe(reviewAbs);
  });
});
