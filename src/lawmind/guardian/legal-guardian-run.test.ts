import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../agent/types.js";
import { persistDraft } from "../drafts/index.js";
import { writeRedlineProposal } from "../drafts/redline-proposal.js";
import type { ArtifactDraft } from "../types.js";
import { buildGuardianEvidencePack } from "./legal-guardian.js";
import {
  runLegalGuardian,
  runLegalGuardianForTrackedDraft,
  runLegalGuardianForDocument,
} from "./run.js";
import {
  lawyerGuardianViewFromSidecar,
  persistGuardianRecord,
  readLatestGuardian,
} from "./store.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-guardian-"));
}

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmp.length = 0;
});

const draft = (wsTask = "t1"): ArtifactDraft => ({
  taskId: wsTask,
  title: "合作协议",
  output: "docx",
  templateId: "word/contract-default",
  deliverableType: "contract.review",
  summary: "改管辖",
  sections: [{ heading: "争议解决", body: "由上海仲裁委员会仲裁解决。" }],
  reviewNotes: [],
  reviewStatus: "pending",
  createdAt: "2026-09-13T00:00:00.000Z",
  contractEdit: { baselineRelativePath: "cases/m1/a.docx", mode: "surgical" },
});

describe("legal guardian run", () => {
  it("keeps reviewer transcript in the sidecar only", async () => {
    const ws = tmpWs();
    tmp.push(ws);
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    const pack = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "甲方所在地人民法院",
          after: "上海仲裁委员会",
          status: "pending",
        },
      ],
      allowEmptyRedline: false,
    });
    const record = await runLegalGuardian({
      pack,
      taskId: "t1",
      workspaceDir: ws,
      callReviewer: async () =>
        JSON.stringify({
          verdict: "fail",
          gaps: [{ code: "coverage_gap", message: "检查单停项被改了" }],
        }) + "\nRAW_CHAIN",
    });
    expect(record.verdict).toBe("fail");
    expect(record.reviewerRaw).toContain("RAW_CHAIN");
    const lawyer = lawyerGuardianViewFromSidecar(ws, "t1");
    expect(lawyer?.verdict).toBe("fail");
    expect(JSON.stringify(lawyer)).not.toContain("RAW_CHAIN");
  });

  it("skips the LLM when no model or caller is available", async () => {
    const ws = tmpWs();
    tmp.push(ws);
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    const pack = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "a",
          after: "b",
          status: "pending",
        },
      ],
      allowEmptyRedline: false,
    });
    const record = await runLegalGuardian({ pack, taskId: "t1", workspaceDir: ws });
    expect(record.verdict).toBe("skipped");
    expect(record.skipReason).toBe("no_model");
  });

  it("blocks tracked export assembly when the reviewer fails", async () => {
    const ws = tmpWs();
    tmp.push(ws);
    persistDraft(ws, draft());
    writeRedlineProposal(ws, {
      taskId: "t1",
      baselineSections: [{ heading: "争议解决", body: "由甲方所在地人民法院仲裁解决。" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          sectionHeading: "争议解决",
          before: "甲方所在地人民法院",
          after: "上海仲裁委员会",
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "t",
      guardianCaller: async ({ user }) => {
        expect(user).toContain("上海仲裁委员会");
        expect(user).not.toMatch(/"coverage"\s*:/);
        return '{"verdict":"fail","gaps":[{"code":"coverage_gap","message":"未覆盖检查单停项"}]}';
      },
    };
    const record = await runLegalGuardianForTrackedDraft({
      workspaceDir: ws,
      draft: draft(),
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          sectionHeading: "争议解决",
          before: "甲方所在地人民法院",
          after: "上海仲裁委员会",
          status: "pending",
        },
      ],
      allowEmptyRedline: false,
      ctx,
    });
    expect(record.verdict).toBe("fail");
    expect(readLatestGuardian(ws, "t1")?.gaps[0]?.code).toBe("coverage_gap");
  });

  it("fails closed when the reviewer output is unreadable, without leaking transcript", async () => {
    const ws = tmpWs();
    tmp.push(ws);
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    const pack = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [{ hunkId: "h1", sectionIndex: 0, before: "a", after: "b", status: "pending" }],
      allowEmptyRedline: false,
    });
    const record = await runLegalGuardian({
      pack,
      taskId: "t1",
      workspaceDir: ws,
      callReviewer: async () => "NOT_JSON RAW_CHAIN",
    });
    expect(record.verdict).toBe("fail");
    expect(record.gaps[0]?.code).toBe("guardian_unreadable");
    expect(record.reviewerRaw).toContain("RAW_CHAIN");
    const lawyer = lawyerGuardianViewFromSidecar(ws, "t1");
    expect(lawyer?.verdict).toBe("fail");
    expect(JSON.stringify(lawyer)).not.toContain("RAW_CHAIN");
  });

  it("feeds confirmed answers into the reviewer user message", async () => {
    const ws = tmpWs();
    tmp.push(ws);
    persistDraft(ws, draft());
    writeRedlineProposal(ws, {
      taskId: "t1",
      baselineSections: [{ heading: "争议解决", body: "由甲方所在地人民法院仲裁解决。" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          sectionHeading: "争议解决",
          before: "甲方所在地人民法院",
          after: "上海仲裁委员会",
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    let user = "";
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "t",
      confirmedAnswers: { venue: "上海仲裁" },
      guardianCaller: async (input) => {
        user = input.user;
        return '{"verdict":"pass","gaps":[]}';
      },
    };
    const record = await runLegalGuardianForTrackedDraft({
      workspaceDir: ws,
      draft: draft(),
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          sectionHeading: "争议解决",
          before: "甲方所在地人民法院",
          after: "上海仲裁委员会",
          status: "pending",
        },
      ],
      allowEmptyRedline: false,
      ctx,
    });
    expect(record.verdict).toBe("pass");
    expect(user).toContain("上海仲裁");
    expect(user).toContain("venue");
  });

  it("reviews opinion documents from sections, not hunks", async () => {
    const ws = tmpWs();
    tmp.push(ws);
    persistDraft(
      ws,
      draft({
        deliverableType: "memo.opinion",
        sections: [{ heading: "争点", body: "管辖条款是否有效。", citations: [] }],
      }),
    );
    let user = "";
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "t",
      guardianCaller: async (input) => {
        user = input.user;
        return '{"verdict":"fail","gaps":[{"code":"coverage_gap","message":"未写保留意见"}]}';
      },
    };
    const record = await runLegalGuardianForDocument({
      workspaceDir: ws,
      draft: draft({
        deliverableType: "memo.opinion",
        sections: [{ heading: "争点", body: "管辖条款是否有效。" }],
      }),
      ctx,
    });
    expect(record.verdict).toBe("fail");
    expect(user).toContain("render_document");
    expect(user).toContain("管辖条款");
    expect(user).not.toContain("hunkId");
  });

  it("exhausts after two fails without another reviewer call", async () => {
    const ws = tmpWs();
    tmp.push(ws);
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    persistGuardianRecord(ws, {
      taskId: "t1",
      at: new Date().toISOString(),
      verdict: "fail",
      round: 2,
      maxRounds: 2,
      gaps: [{ code: "coverage_gap", message: "仍缺" }],
    });
    let calls = 0;
    const pack = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [{ hunkId: "h1", sectionIndex: 0, before: "a", after: "b", status: "pending" }],
      allowEmptyRedline: false,
    });
    const record = await runLegalGuardian({
      pack,
      taskId: "t1",
      workspaceDir: ws,
      callReviewer: async () => {
        calls += 1;
        return '{"verdict":"pass","gaps":[]}';
      },
    });
    expect(calls).toBe(0);
    expect(record.verdict).toBe("fail");
    expect(record.gaps.some((g) => g.code === "guardian_exhausted")).toBe(true);
  });
});
