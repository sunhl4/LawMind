/**
 * Token before/after for verify-loop optimizations:
 * bounce history collapse, Guardian pack-hash reuse, CLAUDE.md stub.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { estimateMessageTokens, estimateTextTokens } from "../agent/context-budget.js";
import type { AgentContext, AgentMessage } from "../agent/types.js";
import { persistDraft } from "../drafts/index.js";
import { writeRedlineProposal } from "../drafts/redline-proposal.js";
import { hashGuardianEvidencePack } from "../guardian/evidence-hash.js";
import {
  buildGuardianEvidencePack,
  formatGuardianEvidenceUserMessage,
  guardianSystemPrompt,
} from "../guardian/legal-guardian.js";
import { runLegalGuardian, runLegalGuardianForTrackedDraft } from "../guardian/run.js";
import type { ArtifactDraft } from "../types.js";
import {
  applySameTurnVerifyFail,
  collapseSameTurnVerifyBounces,
  formatSameTurnVerifyError,
  SAME_TURN_VERIFY_DIGEST_PREFIX,
  SAME_TURN_VERIFY_USER_PREFIX,
  type SameTurnVerifyIssue,
} from "./same-turn-verify.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

const emptyRedlineIssue: SameTurnVerifyIssue = {
  code: "empty_redline",
  message:
    "未产生可核验修订（redlinePending=0）。请用最短 find/replace 再交 apply_surgical_edits，并附 craft_check.deferred（无缓办则 []）。",
  gate: "redline_hunks_gate",
  nextTool: "apply_surgical_edits",
};

const craftIssue: SameTurnVerifyIssue = {
  code: "craft_check_missing",
  message:
    "未附 craft_check。请在同一调用中附 craft_check.deferred（无缓办则 []）后重交 apply_surgical_edits。",
  gate: "reasoning_gate",
  nextTool: "apply_surgical_edits",
};

function bounceMessage(index: number): AgentMessage {
  return {
    role: "user",
    content: formatSameTurnVerifyError([emptyRedlineIssue, craftIssue]),
    timestamp: `2026-09-15T00:00:0${index}.000Z`,
    hiddenFromLawyer: true,
  };
}

function historyWithBounces(bounceCount: number): AgentMessage[] {
  const base: AgentMessage[] = [
    { role: "user", content: "请按词修订这份合同", timestamp: "2026-09-15T00:00:00.000Z" },
    {
      role: "assistant",
      content: "",
      timestamp: "2026-09-15T00:00:01.000Z",
      toolCalls: [{ id: "c1", name: "apply_surgical_edits", arguments: { edits: [] } }],
    },
    {
      role: "tool",
      content: formatSameTurnVerifyError([emptyRedlineIssue, craftIssue]),
      timestamp: "2026-09-15T00:00:02.000Z",
      toolCallResponses: [
        {
          toolCallId: "c1",
          name: "apply_surgical_edits",
          result: { ok: false, error: formatSameTurnVerifyError([emptyRedlineIssue, craftIssue]) },
        },
      ],
    },
    { role: "assistant", content: "已完成。", timestamp: "2026-09-15T00:00:03.000Z" },
  ];
  for (let i = 0; i < bounceCount; i++) {
    base.push(bounceMessage(i + 4));
    if (i < bounceCount - 1) {
      base.push({
        role: "assistant",
        content: "已完成。",
        timestamp: `2026-09-15T00:00:1${i}.000Z`,
      });
    }
  }
  return base;
}

describe("verify token budget (before vs after)", () => {
  it("dropping persisted bounces cuts follow-up history tokens vs keeping 3 full bounces", () => {
    const beforeHistory = historyWithBounces(3);
    const beforeTokens = estimateMessageTokens(beforeHistory);
    const after = collapseSameTurnVerifyBounces(beforeHistory, {
      red: false,
      issues: [emptyRedlineIssue, craftIssue],
      mode: "drop",
    });
    const afterTokens = estimateMessageTokens(after.messages);
    expect(after.removedFullBounces).toBe(3);
    expect(
      after.messages.some(
        (m) => m.role === "user" && m.content.startsWith(SAME_TURN_VERIFY_USER_PREFIX),
      ),
    ).toBe(false);
    expect(afterTokens).toBeLessThan(beforeTokens);
    const saved = beforeTokens - afterTokens;
    expect(saved).toBeGreaterThan(80);
    // eslint-disable-next-line no-console -- measurement the review asked for
    console.log(
      `[token] bounce persist before=${beforeTokens} after=${afterTokens} saved=${saved}`,
    );
  });

  it("paused persist keeps a digest instead of N full bounce copies", () => {
    const beforeHistory = historyWithBounces(3);
    const beforeTokens = estimateMessageTokens(beforeHistory);
    const after = collapseSameTurnVerifyBounces(beforeHistory, {
      red: true,
      issues: [emptyRedlineIssue, craftIssue],
      mode: "digest",
    });
    const afterTokens = estimateMessageTokens(after.messages);
    const digests = after.messages.filter((m) =>
      m.content.startsWith(SAME_TURN_VERIFY_DIGEST_PREFIX),
    );
    expect(digests).toHaveLength(1);
    expect(digests[0]?.content).toContain("empty_redline");
    expect(after.removedFullBounces).toBe(3);
    expect(afterTokens).toBeLessThan(beforeTokens);
    const saved = beforeTokens - afterTokens;
    expect(saved).toBeGreaterThan(80);
    console.log(`[token] bounce digest before=${beforeTokens} after=${afterTokens} saved=${saved}`);
  });

  it("keep_latest_full leaves one bounce for the next sample", () => {
    const history = historyWithBounces(3);
    const after = collapseSameTurnVerifyBounces(history, {
      red: true,
      issues: [emptyRedlineIssue],
      mode: "keep_latest_full",
    });
    const full = after.messages.filter(
      (m) => m.role === "user" && m.hiddenFromLawyer === true && isFull(m.content),
    );
    expect(full).toHaveLength(1);
    expect(after.removedFullBounces).toBe(2);
  });
});

function isFull(content: string): boolean {
  return content.startsWith(SAME_TURN_VERIFY_USER_PREFIX);
}

describe("Guardian evidence hash token budget (before vs after)", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmp.length = 0;
  });

  const draft = (): ArtifactDraft => ({
    taskId: "t1",
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

  it("second export of the same pack skips the reviewer LLM", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-guardian-hash-"));
    tmp.push(ws);
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
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
    const hunks = [
      {
        hunkId: "h1",
        sectionIndex: 0,
        sectionHeading: "争议解决",
        before: "甲方所在地人民法院",
        after: "上海仲裁委员会",
        status: "pending" as const,
      },
    ];
    let calls = 0;
    let reviewerTokens = 0;
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "t",
      guardianCaller: async ({ system, user }) => {
        calls += 1;
        reviewerTokens += estimateTextTokens(system) + estimateTextTokens(user);
        return '{"verdict":"pass","gaps":[]}';
      },
    };
    const first = await runLegalGuardianForTrackedDraft({
      workspaceDir: ws,
      draft: draft(),
      hunks,
      allowEmptyRedline: false,
      ctx,
    });
    const second = await runLegalGuardianForTrackedDraft({
      workspaceDir: ws,
      draft: draft(),
      hunks,
      allowEmptyRedline: false,
      ctx,
    });
    expect(first.verdict).toBe("pass");
    expect(first.evidencePackHash).toBeTruthy();
    expect(second.skipReason).toBe("unchanged_evidence");
    expect(calls).toBe(1);
    const beforeTokens = reviewerTokens * 2;
    const afterTokens = reviewerTokens;
    expect(afterTokens).toBeLessThan(beforeTokens);
    expect(beforeTokens - afterTokens).toBeGreaterThan(50);
    console.log(
      `[token] guardian reviewer before=${beforeTokens} after=${afterTokens} saved=${beforeTokens - afterTokens} hash=${first.evidencePackHash?.slice(0, 12)}`,
    );
  });

  it("hash ignores prior so a follow-up export still matches", () => {
    const packA = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [{ hunkId: "h1", sectionIndex: 0, before: "a", after: "b", status: "pending" }],
      allowEmptyRedline: false,
    });
    const packB = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [{ hunkId: "h1", sectionIndex: 0, before: "a", after: "b", status: "pending" }],
      allowEmptyRedline: false,
      prior: { round: 1, verdict: "pass", gaps: [] },
    });
    expect(hashGuardianEvidencePack(packA)).toBe(hashGuardianEvidencePack(packB));
    const packC = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [{ hunkId: "h1", sectionIndex: 0, before: "a", after: "CHANGED", status: "pending" }],
      allowEmptyRedline: false,
    });
    expect(hashGuardianEvidencePack(packA)).not.toBe(hashGuardianEvidencePack(packC));
  });

  it("changed evidence still calls the reviewer", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-guardian-hash2-"));
    tmp.push(ws);
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    const pack = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [{ hunkId: "h1", sectionIndex: 0, before: "a", after: "b", status: "pending" }],
      allowEmptyRedline: false,
    });
    let calls = 0;
    await runLegalGuardian({
      pack,
      taskId: "t1",
      workspaceDir: ws,
      callReviewer: async () => {
        calls += 1;
        return '{"verdict":"pass","gaps":[]}';
      },
    });
    const changed = buildGuardianEvidencePack({
      draft: draft(),
      hunks: [{ hunkId: "h1", sectionIndex: 0, before: "a", after: "c", status: "pending" }],
      allowEmptyRedline: false,
    });
    await runLegalGuardian({
      pack: changed,
      taskId: "t1",
      workspaceDir: ws,
      callReviewer: async () => {
        calls += 1;
        return '{"verdict":"pass","gaps":[]}';
      },
    });
    expect(calls).toBe(2);
    const oneCall =
      estimateTextTokens(guardianSystemPrompt()) +
      estimateTextTokens(formatGuardianEvidenceUserMessage(pack));
    expect(oneCall).toBeGreaterThan(20);
  });
});

describe("CLAUDE.md stub token budget (before vs after)", () => {
  it("Cursor dual-inject is cheaper than the old AGENTS.md symlink", () => {
    const agents = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
    const claude = fs.readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
    const before = estimateTextTokens(agents) * 2;
    const after = estimateTextTokens(agents) + estimateTextTokens(claude);
    expect(claude.length).toBeLessThan(agents.length);
    expect(claude).toContain("AGENTS.md");
    expect(claude).not.toContain("turn-orchestrator-cassettes");
    expect(after).toBeLessThan(before);
    console.log(
      `[token] contributor inject before=${before} after=${after} saved=${before - after}`,
    );
  });
});

describe("same-turn fail envelope + CJK history cap (before vs after)", () => {
  it("fail JSON carries one PREFIX copy instead of three", () => {
    const after = applySameTurnVerifyFail("apply_surgical_edits", {
      ok: true,
      data: { redlinePending: 0 },
    });
    const message = String(after.error);
    const afterData = after.data as {
      verify?: { codes?: string[]; nextTool?: string };
      sameTurnVerify?: unknown;
      gateDecision?: { gate?: string; decision?: string; category?: string };
    };
    const before = {
      ok: false,
      error: message,
      data: {
        verify: {
          message,
          codes: afterData.verify?.codes,
          nextTool: afterData.verify?.nextTool,
        },
        sameTurnVerify: afterData.sameTurnVerify,
        gateDecision: {
          gate: afterData.gateDecision?.gate,
          decision: afterData.gateDecision?.decision,
          category: afterData.gateDecision?.category,
          reason: message,
        },
      },
    };
    const beforeTokens = estimateTextTokens(JSON.stringify(before));
    const afterTokens = estimateTextTokens(JSON.stringify(after));
    expect(JSON.stringify(after).split(SAME_TURN_VERIFY_USER_PREFIX).length - 1).toBe(1);
    expect(JSON.stringify(before).split(SAME_TURN_VERIFY_USER_PREFIX).length - 1).toBe(3);
    expect(afterTokens).toBeLessThan(beforeTokens);
    expect(beforeTokens - afterTokens).toBeGreaterThan(80);
    console.log(
      `[token] verify fail envelope before=${beforeTokens} after=${afterTokens} saved=${beforeTokens - afterTokens}`,
    );
  });

  it("CJK 3k-char tool result is cheaper after the token cap", async () => {
    const { summarizeToolResultForHistory } = await import("../agent/tool-result-history.js");
    const cjk = { ok: true, text: "合".repeat(3_000) };
    const beforeTokens = estimateTextTokens(JSON.stringify(cjk));
    const slim = summarizeToolResultForHistory(cjk);
    const afterTokens = estimateTextTokens(JSON.stringify(slim));
    expect(beforeTokens).toBeGreaterThan(2_500);
    expect(afterTokens).toBeLessThan(beforeTokens);
    expect(afterTokens).toBeLessThan(2_000);
    console.log(
      `[token] CJK history cap before=${beforeTokens} after=${afterTokens} saved=${beforeTokens - afterTokens}`,
    );
  });
});
