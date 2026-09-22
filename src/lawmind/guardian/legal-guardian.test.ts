import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  buildGuardianEvidencePack,
  deterministicGuardianGaps,
  extractAnchorContext,
  formatGuardianFailMessage,
  guardianBlocksExport,
  resolveGuardianTrackedRedlinePosture,
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

  it("does not hard-block tracked redline export by default (审稿照跑、缺口照报)", () => {
    // 实测把 tracked 导出也按 block 处理时，「审稿 2 轮未过」会打断整条 Word 一键改稿，
    // 律师只看到「没有结果」。solo 缺省改为 advisory：缺口如实交出，不阻断。
    expect(resolveGuardianTrackedRedlinePosture({ env: {} as NodeJS.ProcessEnv })).toBe("advisory");
    expect(resolveGuardianTrackedRedlinePosture()).toBe("advisory");
  });

  it("keeps the hard wall by default for firm / private deployments", () => {
    // 跨档口径：律所/私有部署里「未过独立审稿的稿子流出去」代价更高，缺省保留硬墙。
    expect(
      resolveGuardianTrackedRedlinePosture({
        env: { LAWMIND_EDITION: "firm" } as NodeJS.ProcessEnv,
      }),
    ).toBe("block");
    expect(
      resolveGuardianTrackedRedlinePosture({
        env: { LAWMIND_EDITION: "private_deploy" } as NodeJS.ProcessEnv,
      }),
    ).toBe("block");
    // policy 标注的 edition 优先于 env（与 resolveEdition 同一口径）
    expect(
      resolveGuardianTrackedRedlinePosture({
        policy: { edition: "firm" },
        env: { LAWMIND_EDITION: "solo" } as NodeJS.ProcessEnv,
      }),
    ).toBe("block");
    // 律所也能显式放行（与 solo 同样一条覆盖路径）
    expect(
      resolveGuardianTrackedRedlinePosture({
        env: {
          LAWMIND_EDITION: "firm",
          LAWMIND_GUARDIAN_TRACKED_REDLINE: "advisory",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe("advisory");
  });

  it("lets a firm restore the hard wall via policy or env", () => {
    expect(
      resolveGuardianTrackedRedlinePosture({ policy: { guardianTrackedRedline: "block" } }),
    ).toBe("block");
    expect(
      resolveGuardianTrackedRedlinePosture({
        env: { LAWMIND_GUARDIAN_TRACKED_REDLINE: "block" } as NodeJS.ProcessEnv,
      }),
    ).toBe("block");
    // policy 优先于 env
    expect(
      resolveGuardianTrackedRedlinePosture({
        policy: { guardianTrackedRedline: "advisory" },
        env: { LAWMIND_GUARDIAN_TRACKED_REDLINE: "block" } as NodeJS.ProcessEnv,
      }),
    ).toBe("advisory");
  });

  it("ignores a garbage posture value instead of failing open or closed by accident", () => {
    // 认不出就按所在 edition 的缺省，不把写错的配置当成硬墙或免检。
    expect(
      resolveGuardianTrackedRedlinePosture({
        policy: { guardianTrackedRedline: "whatever" },
        env: { LAWMIND_GUARDIAN_TRACKED_REDLINE: "nonsense" } as NodeJS.ProcessEnv,
      }),
    ).toBe("advisory");
    expect(
      resolveGuardianTrackedRedlinePosture({
        policy: { guardianTrackedRedline: "whatever", edition: "firm" },
        env: { LAWMIND_GUARDIAN_TRACKED_REDLINE: "nonsense" } as NodeJS.ProcessEnv,
      }),
    ).toBe("block");
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
