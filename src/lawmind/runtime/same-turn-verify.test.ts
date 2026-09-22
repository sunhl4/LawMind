import { describe, expect, it } from "vitest";
import {
  applySameTurnVerifyFail,
  collectSameTurnVerifyIssues,
  emptySameTurnVerifyState,
  formatSameTurnCompletionBounce,
  nextSameTurnVerifyState,
  SAME_TURN_VERIFY_BOUNCE_MAX,
  SAME_TURN_VERIFY_USER_PREFIX,
  shouldBounceSameTurnCompletion,
  shouldPauseSameTurnVerify,
} from "./same-turn-verify.js";

describe("same-turn verify", () => {
  it("maps Guardian export fail into a writer bounce issue", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "render_tracked_draft",
      result: {
        ok: false,
        error: "独立审稿未过",
        data: {
          code: "legal_guardian_fail",
          gateDecision: { gate: "legal_guardian_gate", decision: "block" },
          guardian: {
            verdict: "fail",
            gaps: [{ code: "coverage_gap", message: "停项被改" }],
          },
        },
      },
    });
    expect(issues.some((i) => i.code === "guardian_fail")).toBe(true);
    expect(issues[0]?.message).toContain("停项被改");
    expect(formatSameTurnCompletionBounce({ red: true, issues, bounceCount: 0 })).toContain(
      "停项被改",
    );
    expect(shouldBounceSameTurnCompletion({ red: true, issues, bounceCount: 0 })).toBe(true);
  });

  it("maps XML-QA miss to re-export, not surgical rewrite", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "render_tracked_draft",
      result: {
        ok: false,
        error: "未见审阅痕迹",
        data: { code: "xml_qa_no_tracks" },
      },
    });
    expect(issues[0]?.code).toBe("xml_qa_fail");
    expect(issues[0]?.nextTool).toBe("render_tracked_draft");
    expect(issues[0]?.message).toContain("原样重交");
    expect(issues[0]?.message).not.toContain("apply_surgical_edits");
    expect(formatSameTurnCompletionBounce({ red: true, issues, bounceCount: 0 })).toContain(
      "render_tracked_draft",
    );
    expect(formatSameTurnCompletionBounce({ red: true, issues, bounceCount: 0 })).not.toContain(
      "apply_surgical_edits",
    );
  });

  it("does not send infra Guardian fails back to apply_surgical_edits", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "render_tracked_draft",
      result: {
        ok: false,
        error: "独立审稿引擎未能读出结果",
        data: {
          code: "legal_guardian_fail",
          gateDecision: { gate: "legal_guardian_gate", decision: "block" },
          guardian: {
            verdict: "fail",
            skipReason: "unreadable",
            gaps: [{ code: "guardian_unreadable", message: "无法解析" }],
          },
        },
      },
    });
    expect(issues[0]?.code).toBe("guardian_fail");
    expect(issues[0]?.nextTool).toBe("render_tracked_draft");
    expect(issues[0]?.message).toContain("原样重交");
    expect(issues[0]?.message).not.toContain("补改");
    expect(formatSameTurnCompletionBounce({ red: true, issues, bounceCount: 0 })).toContain(
      "render_tracked_draft",
    );
    expect(formatSameTurnCompletionBounce({ red: true, issues, bounceCount: 0 })).not.toContain(
      "apply_surgical_edits",
    );
  });

  it("maps opinion Guardian fail to update_draft bounce", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "render_document",
      result: {
        ok: false,
        error: "独立审稿未过",
        data: {
          code: "legal_guardian_fail",
          gateDecision: { gate: "legal_guardian_gate", decision: "block" },
          guardian: {
            verdict: "fail",
            gaps: [{ code: "coverage_gap", message: "未写保留意见" }],
          },
        },
      },
    });
    expect(issues[0]?.code).toBe("guardian_fail");
    expect(issues[0]?.nextTool).toBe("update_draft");
    expect(issues[0]?.message).toContain("未写保留意见");
  });

  it("exhausted Guardian stops the turn instead of bouncing a contradictory rewrite", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "render_tracked_draft",
      result: {
        ok: false,
        error: "独立审稿未过",
        data: {
          code: "legal_guardian_fail",
          gateDecision: { gate: "legal_guardian_gate", decision: "block" },
          guardian: {
            verdict: "fail",
            round: 3,
            maxRounds: 2,
            skipReason: "独立审稿已 2 轮未过。请把缺口交给律师，不要继续为过审而改稿。",
            gaps: [
              {
                code: "guardian_exhausted",
                message: "独立审稿已 2 轮未过。请把缺口交给律师，不要继续为过审而改稿。",
              },
            ],
          },
        },
      },
    });
    expect(issues[0]?.code).toBe("guardian_fail");
    expect(issues[0]?.terminal).toBe(true);
    expect(issues[0]?.nextTool).toBeUndefined();

    const bounce = formatSameTurnCompletionBounce({ red: true, issues, bounceCount: 0 });
    expect(bounce).toContain("已停");
    expect(bounce).not.toContain("请立即调用 apply_surgical_edits");
    expect(bounce).toContain("交给律师");

    // 终态：本轮不再反弹（旧行为会一边引用「不要继续改稿」一边催再交 apply_surgical_edits）
    expect(shouldBounceSameTurnCompletion({ red: true, issues, bounceCount: 0 })).toBe(false);
    expect(shouldPauseSameTurnVerify({ red: true, issues, bounceCount: 9 })).toBe(false);

    const failed = applySameTurnVerifyFail("render_tracked_draft", {
      ok: false,
      error: "独立审稿未过",
      data: {
        code: "legal_guardian_fail",
        gateDecision: { gate: "legal_guardian_gate", decision: "block" },
        guardian: {
          verdict: "fail",
          skipReason: "独立审稿已 2 轮未过。请把缺口交给律师，不要继续为过审而改稿。",
          gaps: [{ code: "guardian_exhausted", message: "独立审稿已 2 轮未过。" }],
        },
      },
    });
    expect(JSON.stringify(failed.data)).toContain("验收已停");
    expect(String(failed.error)).not.toContain("请立即调用");
  });

  it("treats missing craft_check as a red validator (deferred packet, not self-score)", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "apply_surgical_edits",
      result: {
        ok: true,
        data: { redlinePending: 2, craftCheck: null },
      },
      args: {},
    });
    expect(issues.some((i) => i.code === "craft_check_missing")).toBe(true);
    const failed = applySameTurnVerifyFail(
      "apply_surgical_edits",
      { ok: true, data: { redlinePending: 2, craftCheck: null } },
      {},
    );
    expect(failed.ok).toBe(false);
  });

  it("still flags empty redline after surgical edits", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "apply_surgical_edits",
      result: { ok: true, data: { redlinePending: 0 } },
    });
    expect(issues.some((i) => i.code === "empty_redline")).toBe(true);
    const failed = applySameTurnVerifyFail("apply_surgical_edits", {
      ok: true,
      data: { redlinePending: 0 },
    });
    expect(failed.ok).toBe(false);
    expect(String(failed.error)).toContain("验证器未绿");
    expect(String(failed.error)).toContain(SAME_TURN_VERIFY_USER_PREFIX);
    const data = failed.data as {
      verify?: { message?: string; codes?: string[]; nextTool?: string };
      sameTurnVerify?: { issues?: Array<{ message?: string; code?: string }> };
      gateDecision?: { reason?: string };
    };
    expect(data.verify?.message).toBeUndefined();
    expect(data.verify?.codes).toContain("empty_redline");
    expect(data.verify?.nextTool).toBe("apply_surgical_edits");
    expect(data.sameTurnVerify?.issues?.[0]?.message).toContain("redlinePending=0");
    expect(data.gateDecision?.reason).toContain("空修订");
    expect(data.gateDecision?.reason).not.toContain(SAME_TURN_VERIFY_USER_PREFIX);
    expect(data.gateDecision?.reason).not.toContain("empty_redline");
    const copies = JSON.stringify(failed).split(SAME_TURN_VERIFY_USER_PREFIX).length - 1;
    expect(copies).toBe(1);
  });

  it("clears red after a green apply and bounces until the cap", () => {
    const red = nextSameTurnVerifyState(emptySameTurnVerifyState(), "apply_surgical_edits", {
      ok: false,
      error: "empty",
      data: {
        sameTurnVerify: {
          red: true,
          issues: [
            {
              code: "empty_redline",
              message: "empty",
              gate: "redline_hunks_gate",
              nextTool: "apply_surgical_edits",
            },
          ],
        },
      },
    });
    expect(red.red).toBe(true);
    const green = nextSameTurnVerifyState(red, "apply_surgical_edits", {
      ok: true,
      data: { redlinePending: 1, craftCheck: { deferred: [] } },
    });
    expect(green.red).toBe(false);
    expect(shouldBounceSameTurnCompletion(green)).toBe(false);
    expect(
      shouldPauseSameTurnVerify({
        red: true,
        issues: red.issues,
        bounceCount: SAME_TURN_VERIFY_BOUNCE_MAX,
      }),
    ).toBe(true);
    expect(formatSameTurnCompletionBounce(red)).toContain("apply_surgical_edits");
  });

  it("treats mechanical lint blockers on a non-contractEdit draft as a red validator", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "draft_document",
      result: {
        ok: true,
        data: {
          deliverableType: "contract.review",
          lintReport: {
            findings: [
              {
                ruleId: "lease.term_cap",
                family: "lease",
                severity: "blocker",
                message: "租赁期限超过法定上限",
              },
            ],
          },
        },
      },
    });
    expect(issues.some((i) => i.code === "lint_mechanical")).toBe(true);
    const failed = applySameTurnVerifyFail("draft_document", {
      ok: true,
      data: {
        deliverableType: "contract.review",
        lintReport: {
          findings: [
            {
              ruleId: "lease.term_cap",
              family: "lease",
              severity: "blocker",
              message: "租赁期限超过法定上限",
            },
          ],
        },
      },
    });
    expect(failed.ok).toBe(false);
  });

  it("does not treat subjective deposit-cap lint as a same-turn mechanical fail", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "draft_document",
      result: {
        ok: true,
        data: {
          lintReport: {
            findings: [
              {
                ruleId: "statutory.deposit_cap",
                family: "statutory_cap",
                severity: "blocker",
                message: "定金超过上限",
              },
            ],
          },
        },
      },
    });
    expect(issues.some((i) => i.code === "lint_mechanical")).toBe(false);
  });

  it("skips mechanical lint on contractEdit payloads", () => {
    const issues = collectSameTurnVerifyIssues({
      toolName: "update_draft",
      result: {
        ok: true,
        data: {
          contractEdit: { baselineRelativePath: "a.docx", mode: "surgical" },
          lintReport: {
            findings: [
              {
                ruleId: "lease.term_cap",
                family: "lease",
                severity: "blocker",
                message: "租赁期限超过法定上限",
              },
            ],
          },
        },
      },
    });
    expect(issues).toEqual([]);
  });

  it("keeps xml_qa_fail when a fail envelope also has empty_redline", () => {
    const failed = applySameTurnVerifyFail("render_tracked_draft", {
      ok: false,
      data: {
        code: "xml_qa_no_tracks",
        xmlQa: { ok: false },
        gateDecision: { gate: "redline_hunks_gate", decision: "block" },
      },
    });
    const stored = collectSameTurnVerifyIssues({
      toolName: "render_tracked_draft",
      result: failed,
    });
    expect(stored.map((i) => i.code).toSorted()).toEqual(["empty_redline", "xml_qa_fail"]);
  });
});
