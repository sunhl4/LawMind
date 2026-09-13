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
});
