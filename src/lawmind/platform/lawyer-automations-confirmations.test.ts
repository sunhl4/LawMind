import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { automationsDir } from "./automation-paths.js";
import {
  AUTOMATION_MISSING_DATA_POLICY_DEFAULT,
  AUTOMATION_NOTIFY_POLICY_LEGACY_DEFAULT,
  automationMissingDataPolicy,
  automationNotifyPolicy,
  createAutomation,
  getAutomation,
  shouldNotifyLawyer,
  validateAutomationConfirmations,
  buildAutomationJobBriefNote,
  dispositionForMissingData,
  type LawyerAutomation,
} from "./lawyer-automations.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-conf-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

/** 旧版本的 automation.json（没有六确认字段）——升级后必须照常可读。 */
function legacyAutomation(over: Partial<LawyerAutomation> = {}): LawyerAutomation {
  return {
    id: "legacy-1",
    title: "老的自动办件",
    enabled: true,
    presetId: "custom",
    matterId: "m1",
    schedule: { kind: "daily", hour: 9, minute: 0 },
    nextRunAt: "2026-09-22T01:00:00.000Z",
    allowSendEmailAfterApproval: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("六确认门禁（validateAutomationConfirmations）", () => {
  it("lists every field the lawyer has not committed to", () => {
    const verdict = validateAutomationConfirmations({});
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual([
      "expectedResult",
      "approvalBoundary",
      "missingDataPolicy",
      "notifyPolicy",
    ]);
    expect(verdict.message).toContain("期望结果");
  });

  it("passes only when all four are explicit", () => {
    const verdict = validateAutomationConfirmations({
      expectedResult: "出一份续签提醒清单",
      approvalBoundary: "外发前必须问我",
      missingDataPolicy: "report_failure",
      notifyPolicy: "on_problem",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.missing).toEqual([]);
    expect(verdict.message).toBe("");
  });

  it("treats whitespace-only text as not answered", () => {
    const verdict = validateAutomationConfirmations({
      expectedResult: "   ",
      approvalBoundary: "\n",
      missingDataPolicy: "report_failure",
      notifyPolicy: "always",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(["expectedResult", "approvalBoundary"]);
  });

  it("names only the fields still missing", () => {
    const verdict = validateAutomationConfirmations({
      expectedResult: "清单",
      approvalBoundary: "外发前问我",
      missingDataPolicy: "report_failure",
    });
    expect(verdict.missing).toEqual(["notifyPolicy"]);
    expect(verdict.message).toContain("什么时候通知");
  });
});

describe("通知策略（shouldNotifyLawyer）", () => {
  it("never silences a failure, whatever the policy says", () => {
    for (const policy of ["always", "on_problem", "never"] as const) {
      expect(shouldNotifyLawyer(policy, "failed")).toBe(true);
    }
  });

  it("never silences something waiting for the lawyer's decision", () => {
    for (const policy of ["always", "on_problem", "never"] as const) {
      expect(shouldNotifyLawyer(policy, "blocked")).toBe(true);
    }
  });

  it("keeps quiet about a successful run under on_problem / never", () => {
    expect(shouldNotifyLawyer("on_problem", "ok")).toBe(false);
    expect(shouldNotifyLawyer("never", "ok")).toBe(false);
  });

  it("still reports every run under always", () => {
    expect(shouldNotifyLawyer("always", "ok")).toBe(true);
    expect(shouldNotifyLawyer("always", "skipped")).toBe(true);
  });
});

describe("旧文件向后兼容", () => {
  it("defaults a legacy automation to partial-and-disclose, and always-notify", () => {
    const a = legacyAutomation();
    expect(automationMissingDataPolicy(a)).toBe(AUTOMATION_MISSING_DATA_POLICY_DEFAULT);
    expect(automationNotifyPolicy(a)).toBe(AUTOMATION_NOTIFY_POLICY_LEGACY_DEFAULT);
  });

  it("reads a legacy file from disk without losing the new getters", () => {
    const ws = tmpWs();
    fs.mkdirSync(automationsDir(ws), { recursive: true });
    fs.writeFileSync(
      path.join(automationsDir(ws), "legacy-1.json"),
      JSON.stringify(legacyAutomation()),
      "utf8",
    );
    const loaded = getAutomation(ws, "legacy-1");
    expect(loaded).not.toBeNull();
    // 默认是 report_partial：保留既有「退回本地匣继续办」的行为（见该常量注释）。
    expect(loaded && automationMissingDataPolicy(loaded)).toBe("report_partial");
    expect(loaded && automationNotifyPolicy(loaded)).toBe("always");
  });

  it("honours an explicit policy when the file carries one", () => {
    const a = legacyAutomation({ missingDataPolicy: "skip_run", notifyPolicy: "on_problem" });
    expect(automationMissingDataPolicy(a)).toBe("skip_run");
    expect(automationNotifyPolicy(a)).toBe("on_problem");
  });
});

describe("createAutomation persists the six confirmations", () => {
  it("stores the four new fields", () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "custom",
      matterId: "m1",
      title: "续签盯梢",
      instruction: "每周一看一遍",
      expectedResult: "一份续签提醒清单",
      approvalBoundary: "外发前必须问我",
      missingDataPolicy: "report_failure",
      notifyPolicy: "on_problem",
    });
    const loaded = getAutomation(ws, created.id);
    expect(loaded?.expectedResult).toBe("一份续签提醒清单");
    expect(loaded?.approvalBoundary).toBe("外发前必须问我");
    expect(loaded?.missingDataPolicy).toBe("report_failure");
    expect(loaded?.notifyPolicy).toBe("on_problem");
  });

  it("fills the preset draft when the lawyer did not write the four fields", () => {
    const ws = tmpWs();
    const created = createAutomation(ws, { presetId: "custom", matterId: "m1" });
    const loaded = getAutomation(ws, created.id);
    expect(loaded?.expectedResult).toContain("按你写的那句话");
    expect(loaded?.approvalBoundary).toContain("必须先问我");
    expect(loaded?.missingDataPolicy).toBe("report_partial");
    expect(loaded?.notifyPolicy).toBe("on_problem");
  });

  it("trims whitespace and drops empty strings rather than storing blanks", () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "custom",
      matterId: "m1",
      expectedResult: "  清单  ",
      approvalBoundary: "   ",
    });
    const loaded = getAutomation(ws, created.id);
    expect(loaded?.expectedResult).toBe("清单");
    expect(loaded?.approvalBoundary).toContain("必须先问我");
  });
});

describe("缺资料处置的翻译与交办补充", () => {
  it("maps each policy to an action", () => {
    expect(dispositionForMissingData("report_partial")).toBe("proceed");
    expect(dispositionForMissingData("report_failure")).toBe("fail_run");
    expect(dispositionForMissingData("skip_run")).toBe("skip_quietly");
  });

  it("builds the job-brief note only from what the lawyer wrote", () => {
    expect(
      buildAutomationJobBriefNote({
        expectedResult: "一份续签提醒清单",
        approvalBoundary: "外发前必须问我",
      }),
    ).toBe("办完的标准：一份续签提醒清单\n必须先问我：外发前必须问我");
  });

  it("returns an empty note when nothing was committed (no empty heading)", () => {
    expect(buildAutomationJobBriefNote({})).toBe("");
    expect(buildAutomationJobBriefNote({ expectedResult: "  ", approvalBoundary: "\n" })).toBe("");
  });

  it("carries a single field without inventing the other", () => {
    const note = buildAutomationJobBriefNote({ approvalBoundary: "不要自己改原稿" });
    expect(note).toBe("必须先问我：不要自己改原稿");
    expect(note).not.toContain("办完的标准");
  });
});
