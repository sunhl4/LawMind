import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  buildGuardianEvidencePack,
  deterministicGuardianGaps,
  extractAnchorContext,
  formatGuardianFailMessage,
  guardianBlocksExport,
  isLegalGuardianEnabled,
  nextGuardianRound,
  parseGuardianReviewerJson,
  shouldRunLegalGuardianForDocument,
  slimGuardianView,
} from "./legal-guardian.js";

const draft = (over: Partial<ArtifactDraft> = {}): ArtifactDraft => ({
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
  ...over,
});

describe("legal guardian evidence", () => {
  it("assembles hunks and deferred claims without writer coverage scores", () => {
    const pack = buildGuardianEvidencePack({
      draft: draft(),
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
      allowEmptyRedline: false,
      confirmedAnswers: {
        governing_law: "中国法",
        __attachments__: "workspace:file:secret.docx",
      },
      writerDeferred: [{ issue: "违约金数字", reason: "律师未确认" }],
      citation: {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
      },
    });
    expect(pack.action).toBe("render_tracked_draft");
    expect(pack.hunks[0]?.after).toContain("上海仲裁");
    expect(pack.writerDeferredClaims[0]?.issue).toBe("违约金数字");
    expect(pack.confirmedAnswers).toEqual([{ key: "governing_law", value: "中国法" }]);
    expect(JSON.stringify(pack)).not.toContain("secret.docx");
    expect(JSON.stringify(pack)).not.toMatch(/"coverage"\s*:/);
    expect(pack.gates.hunkCount).toBe(1);
    expect(pack.gates.hunkGateOk).toBe(true);
  });

  it("extracts anchor context around the edited span", () => {
    const ctx = extractAnchorContext("aaa由甲方所在地人民法院诉讼bbb", "甲方所在地人民法院", 4);
    expect(ctx).toContain("甲方所在地人民法院");
    expect(ctx.startsWith("…") || ctx.includes("aaa")).toBe(true);
  });

  it("fails deterministically when citation IDs are missing from the bundle", () => {
    const pack = buildGuardianEvidencePack({
      draft: draft({
        sections: [{ heading: "意见", body: "x".repeat(90), citations: ["missing-1"] }],
      }),
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
      citation: {
        checked: true,
        ok: false,
        missingSourceIds: ["missing-1"],
        sectionsWithIssues: [{ heading: "意见", missing: ["missing-1"] }],
        unanchoredSections: [],
      },
    });
    const gaps = deterministicGuardianGaps(pack);
    expect(gaps.some((g) => g.code === "citation_ids_missing")).toBe(true);
  });
});

describe("legal guardian verdict parse", () => {
  it("parses JSON even when wrapped in prose", () => {
    const parsed = parseGuardianReviewerJson(
      '好的。{"verdict":"fail","gaps":[{"code":"coverage_gap","message":"管辖未覆盖"}]}',
    );
    expect(parsed?.verdict).toBe("fail");
    expect(parsed?.gaps[0]?.code).toBe("coverage_gap");
  });

  it("parses fenced JSON and ignores trailing prose braces", () => {
    const fenced = parseGuardianReviewerJson('```json\n{"verdict":"pass","gaps":[]}\n```');
    expect(fenced?.verdict).toBe("pass");
    const trailing = parseGuardianReviewerJson(
      '{"verdict":"pass","gaps":[]}\n备注：对照 {检查单} 即可。',
    );
    expect(trailing?.verdict).toBe("pass");
  });

  it("accepts Chinese verdict aliases", () => {
    expect(parseGuardianReviewerJson('{"verdict":"通过","gaps":[]}')?.verdict).toBe("pass");
    expect(parseGuardianReviewerJson('{"verdict":"未过","gaps":[]}')?.verdict).toBe("fail");
  });

  it("does not treat infra fail as a coverage rewrite", () => {
    expect(
      formatGuardianFailMessage({
        verdict: "fail",
        round: 1,
        maxRounds: 2,
        skipReason: "unreadable",
        gaps: [{ code: "guardian_unreadable", message: "无法解析" }],
      }),
    ).toContain("原样重交");
    expect(
      formatGuardianFailMessage({
        verdict: "fail",
        round: 1,
        maxRounds: 2,
        skipReason: "unreadable",
        gaps: [{ code: "guardian_unreadable", message: "无法解析" }],
      }),
    ).not.toContain("补改");
  });

  it("treats pass-with-gaps as fail", () => {
    const parsed = parseGuardianReviewerJson(
      '{"verdict":"pass","gaps":[{"code":"x","message":"仍有缺口"}]}',
    );
    expect(parsed?.verdict).toBe("fail");
  });

  it("does not put reviewer transcript into the lawyer/tool view", () => {
    const view = slimGuardianView({
      taskId: "t1",
      at: "2026-09-13T00:00:00.000Z",
      verdict: "fail",
      round: 1,
      maxRounds: 2,
      gaps: [{ code: "coverage_gap", message: "未改仲裁" }],
      reviewerRaw: "SECRET_REVIEWER_CHAIN",
    });
    expect(view).not.toHaveProperty("reviewerRaw");
    expect(JSON.stringify(view)).not.toContain("SECRET_REVIEWER_CHAIN");
    expect(guardianBlocksExport(view)).toBe(true);
    expect(formatGuardianFailMessage(view)).toContain("独立审稿未过");
  });

  it("resets round after pass or skip, increments only on fail", () => {
    expect(nextGuardianRound(undefined)).toBe(1);
    expect(
      nextGuardianRound({
        taskId: "t",
        at: "",
        verdict: "pass",
        round: 2,
        maxRounds: 2,
        gaps: [],
      }),
    ).toBe(1);
    expect(
      nextGuardianRound({
        taskId: "t",
        at: "",
        verdict: "fail",
        round: 1,
        maxRounds: 2,
        gaps: [],
      }),
    ).toBe(2);
    expect(
      nextGuardianRound({
        taskId: "t",
        at: "",
        verdict: "fail",
        round: 1,
        maxRounds: 2,
        skipReason: "unreadable",
        gaps: [{ code: "guardian_unreadable", message: "无法解析" }],
      }),
    ).toBe(1);
  });

  it("can be disabled with LAWMIND_LEGAL_GUARDIAN=0", () => {
    expect(isLegalGuardianEnabled({ LAWMIND_LEGAL_GUARDIAN: "0" } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(isLegalGuardianEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it("runs on opinion Word export, not internal memos or tracked redline drafts", () => {
    expect(shouldRunLegalGuardianForDocument({ deliverableType: "memo.opinion" })).toBe(true);
    expect(shouldRunLegalGuardianForDocument({ deliverableType: "contract.review" })).toBe(true);
    expect(shouldRunLegalGuardianForDocument({ deliverableType: "letter.counsel" })).toBe(true);
    expect(shouldRunLegalGuardianForDocument({ deliverableType: "memo.internal" })).toBe(false);
    expect(
      shouldRunLegalGuardianForDocument({
        deliverableType: "contract.review",
        contractEdit: { baselineRelativePath: "a.docx", mode: "surgical" },
      }),
    ).toBe(false);
  });

  it("assembles document sections and issue tree without hunks", () => {
    const pack = buildGuardianEvidencePack({
      action: "render_document",
      draft: draft({
        deliverableType: "memo.opinion",
        sections: [
          {
            heading: "争点",
            body: "管辖条款是否有效。",
            citations: ["src-1"],
          },
        ],
      }),
      graph: {
        issueTree: [
          {
            issue: "管辖效力",
            elements: ["约定管辖"],
            facts: [],
            evidence: [],
            authorityIds: ["src-1"],
            openQuestions: ["是否书面约定"],
            confidence: 0.4,
          },
        ],
      },
      confirmedAnswers: { venue: "上海" },
    });
    expect(pack.action).toBe("render_document");
    expect(pack.hunks).toEqual([]);
    expect(pack.sections[0]?.heading).toBe("争点");
    expect(pack.issues[0]?.issue).toBe("管辖效力");
    expect(pack.confirmedAnswers).toEqual([{ key: "venue", value: "上海" }]);
    expect(pack.gates.hunkCount).toBeUndefined();
  });
});
