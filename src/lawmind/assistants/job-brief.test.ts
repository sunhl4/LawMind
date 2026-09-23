import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendAssistantProfileMarkdown, readAssistantProfileMarkdown } from "./profile-md.js";
import {
  buildJobBriefBlock,
  buildRoleDirectiveFromProfile,
  bumpAssistantStats,
  duplicateAssistant,
  getAssistantById,
  loadAssistantProfiles,
  loadAssistantStats,
  uniqueAssistantDisplayName,
  upsertAssistant,
} from "./store.js";
import {
  ASSISTANT_JOB_BRIEF_FIELDS,
  ASSISTANT_JOB_BRIEF_LABELS,
  normalizeAssistantJobBrief,
  type AssistantProfile,
} from "./types.js";

const dirs: string[] = [];

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-job-brief-"));
  dirs.push(root);
  return root;
}

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function profile(over: Partial<AssistantProfile> = {}): AssistantProfile {
  return {
    assistantId: "a1",
    displayName: "小陈",
    introduction: "律所通用法律助理。",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("normalizeAssistantJobBrief", () => {
  it("returns undefined for an absent or empty brief so nothing injects", () => {
    expect(normalizeAssistantJobBrief(undefined)).toBeUndefined();
    expect(normalizeAssistantJobBrief({})).toBeUndefined();
    expect(normalizeAssistantJobBrief({ responsibility: "  ", sources: "\n" })).toBeUndefined();
  });

  it("trims values and drops the blank ones", () => {
    const brief = normalizeAssistantJobBrief({
      responsibility: "  盯合同续签  ",
      sources: "",
      prohibitions: " 外发前必须问我 ",
    });
    expect(brief).toEqual({
      responsibility: "盯合同续签",
      prohibitions: "外发前必须问我",
    });
  });

  it("keeps every declared field addressable", () => {
    // 字段清单是 UI 与提示词的共同真相源；漏一个会让那一项静默消失。
    expect(ASSISTANT_JOB_BRIEF_FIELDS).toHaveLength(5);
    for (const field of ASSISTANT_JOB_BRIEF_FIELDS) {
      expect(ASSISTANT_JOB_BRIEF_LABELS[field]).toBeTruthy();
    }
  });
});

describe("buildJobBriefBlock", () => {
  it("returns undefined when there is nothing to say (no empty heading in the prompt)", () => {
    expect(buildJobBriefBlock(undefined)).toBeUndefined();
    expect(buildJobBriefBlock({})).toBeUndefined();
  });

  it("injects the exact values the lawyer wrote, with their labels", () => {
    const block = buildJobBriefBlock({
      responsibility: "盯合同续签",
      prohibitions: "外发前必须问我",
      escalation: "客户资料缺失时停下来问我",
    });
    expect(block).toContain("职务说明书");
    expect(block).toContain(`${ASSISTANT_JOB_BRIEF_LABELS.responsibility}：盯合同续签`);
    expect(block).toContain(`${ASSISTANT_JOB_BRIEF_LABELS.prohibitions}：外发前必须问我`);
    expect(block).toContain(`${ASSISTANT_JOB_BRIEF_LABELS.escalation}：客户资料缺失时停下来问我`);
  });

  it("omits fields the lawyer left blank rather than printing empty labels", () => {
    const block = buildJobBriefBlock({ responsibility: "盯合同续签" });
    expect(block).not.toContain(ASSISTANT_JOB_BRIEF_LABELS.sources);
    expect(block).not.toContain(ASSISTANT_JOB_BRIEF_LABELS.deliverables);
  });

  it("flags that boundaries outrank speed when prohibitions or escalation exist", () => {
    expect(buildJobBriefBlock({ prohibitions: "不许外发" })).toContain("边界优先于效率");
    expect(buildJobBriefBlock({ escalation: "缺资料时问我" })).toContain("边界优先于效率");
    // 纯描述性字段不该触发这句强调，否则又变回人设修辞。
    expect(buildJobBriefBlock({ responsibility: "盯续签" })).not.toContain("边界优先于效率");
  });
});

describe("buildRoleDirectiveFromProfile", () => {
  it("appends the job brief after the free-form role instructions", () => {
    const { roleDirective } = buildRoleDirectiveFromProfile(
      profile({
        customRoleInstructions: "按本所格式出稿。",
        jobBrief: { prohibitions: "外发前必须问我" },
      }),
    );
    expect(roleDirective).toContain("按本所格式出稿。");
    expect(roleDirective).toContain("外发前必须问我");
    expect(roleDirective.indexOf("按本所格式出稿。")).toBeLessThan(
      roleDirective.indexOf("职务说明书"),
    );
  });

  it("leaves the directive untouched when no brief is set (old profiles unaffected)", () => {
    const { roleDirective } = buildRoleDirectiveFromProfile(
      profile({ customRoleInstructions: "按本所格式出稿。" }),
    );
    expect(roleDirective).toBe("## 用户补充的岗位说明\n\n按本所格式出稿。");
  });
});

describe("store round-trip", () => {
  it("persists the brief and reads it back", () => {
    const root = tmpRoot();
    const created = upsertAssistant(root, {
      displayName: "小陈",
      introduction: "助理",
      jobBrief: { responsibility: "盯续签", prohibitions: "不外发" },
    });
    const loaded = getAssistantById(root, created.assistantId);
    expect(loaded?.jobBrief).toEqual({ responsibility: "盯续签", prohibitions: "不外发" });
  });

  it("clears the brief when explicitly set to empty", () => {
    const root = tmpRoot();
    const created = upsertAssistant(root, {
      displayName: "小陈",
      introduction: "助理",
      jobBrief: { responsibility: "盯续签" },
    });
    upsertAssistant(root, { assistantId: created.assistantId, jobBrief: {} });
    expect(getAssistantById(root, created.assistantId)?.jobBrief).toBeUndefined();
  });

  it("keeps the existing brief when the patch omits the field", () => {
    const root = tmpRoot();
    const created = upsertAssistant(root, {
      displayName: "小陈",
      introduction: "助理",
      jobBrief: { responsibility: "盯续签" },
    });
    upsertAssistant(root, { assistantId: created.assistantId, displayName: "小陈2" });
    const loaded = getAssistantById(root, created.assistantId);
    expect(loaded?.displayName).toBe("小陈2");
    expect(loaded?.jobBrief?.responsibility).toBe("盯续签");
  });

  it("still loads a legacy profile that has no brief field", () => {
    const root = tmpRoot();
    upsertAssistant(root, { assistantId: "legacy", displayName: "老助手", introduction: "旧" });
    const loaded = getAssistantById(root, "legacy");
    expect(loaded?.jobBrief).toBeUndefined();
    expect(buildJobBriefBlock(loaded?.jobBrief)).toBeUndefined();
  });

  it("survives a hand-edited assistants.json that has a partial brief", () => {
    const root = tmpRoot();
    upsertAssistant(root, { assistantId: "manual", displayName: "手改", introduction: "" });
    const file = path.join(root, "assistants.json");
    const list = JSON.parse(fs.readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
    // 按 id 定位，不能取 list[0]：空根目录会先播种一个默认助手。
    const target = list.find((row) => row.assistantId === "manual");
    expect(target).toBeTruthy();
    if (target) {
      target.jobBrief = { responsibility: "只填了一项", extraUnknown: "should be ignored" };
    }
    fs.writeFileSync(file, JSON.stringify(list, null, 2), "utf8");

    const loaded = getAssistantById(root, "manual");
    expect(loaded?.jobBrief?.responsibility).toBe("只填了一项");
    expect(buildJobBriefBlock(loaded?.jobBrief)).toContain("只填了一项");
  });
});

describe("名册复制（duplicateAssistant）", () => {
  it("copies the role and its boundaries to a new assistant", () => {
    const root = tmpRoot();
    const source = upsertAssistant(root, {
      displayName: "区域甲续签助手",
      introduction: "盯续签",
      customRoleInstructions: "按本所格式出稿。",
      customRoleTitle: "续签专员",
      orgRole: "member",
      jobBrief: { responsibility: "盯本案续签", prohibitions: "外发前必须问我" },
    });

    const copy = duplicateAssistant(root, source.assistantId);

    expect(copy.assistantId).not.toBe(source.assistantId);
    expect(copy.displayName).toBe("区域甲续签助手 副本");
    expect(copy.introduction).toBe("盯续签");
    expect(copy.customRoleInstructions).toBe("按本所格式出稿。");
    expect(copy.customRoleTitle).toBe("续签专员");
    expect(copy.orgRole).toBe("member");
    expect(copy.jobBrief).toEqual({ responsibility: "盯本案续签", prohibitions: "外发前必须问我" });
    // 副本真的落盘了，不只是返回值好看。
    expect(getAssistantById(root, copy.assistantId)?.jobBrief?.prohibitions).toBe("外发前必须问我");
  });

  it("does NOT bring per-assistant memory: the copy's PROFILE.md is empty", () => {
    const root = tmpRoot();
    const source = upsertAssistant(root, { displayName: "小陈", introduction: "助理" });
    appendAssistantProfileMarkdown(root, source.assistantId, "## 2026-09-01\n\n客户偏好周四开会。");
    expect(readAssistantProfileMarkdown(root, source.assistantId)).toContain("客户偏好周四开会");

    const copy = duplicateAssistant(root, source.assistantId);

    // 「复制角色」不等于「复制它知道的客户事」——记忆按 assistantId 存，新 id 天然为空。
    expect(readAssistantProfileMarkdown(root, copy.assistantId)).toBe("");
    // 源的记忆也原样还在。
    expect(readAssistantProfileMarkdown(root, source.assistantId)).toContain("客户偏好周四开会");
  });

  it("does not carry usage stats either (that is learned, not role)", () => {
    const root = tmpRoot();
    const source = upsertAssistant(root, { displayName: "小陈", introduction: "助理" });
    bumpAssistantStats(root, source.assistantId, { at: "2026-09-12T00:00:00.000Z" });

    const copy = duplicateAssistant(root, source.assistantId);

    const stats = loadAssistantStats(root);
    expect(stats[source.assistantId]).toBeTruthy();
    expect(stats[copy.assistantId]).toBeUndefined();
  });

  it("keeps org links pointing at the same peers", () => {
    const root = tmpRoot();
    const lead = upsertAssistant(root, { displayName: "主管", introduction: "", orgRole: "lead" });
    const member = upsertAssistant(root, {
      displayName: "协办",
      introduction: "",
      orgRole: "member",
      reportsToAssistantId: lead.assistantId,
      peerReviewDefaultAssistantId: lead.assistantId,
    });

    const copy = duplicateAssistant(root, member.assistantId);

    expect(copy.reportsToAssistantId).toBe(lead.assistantId);
    expect(copy.peerReviewDefaultAssistantId).toBe(lead.assistantId);
  });

  it("numbers repeated copies so the roster stays readable", () => {
    const root = tmpRoot();
    const source = upsertAssistant(root, { displayName: "区域甲续签助手", introduction: "" });
    const first = duplicateAssistant(root, source.assistantId);
    const second = duplicateAssistant(root, source.assistantId);
    const third = duplicateAssistant(root, source.assistantId);
    expect([first.displayName, second.displayName, third.displayName]).toEqual([
      "区域甲续签助手 副本",
      "区域甲续签助手 副本 2",
      "区域甲续签助手 副本 3",
    ]);
  });

  it("accepts an explicit new name for the copy's scope", () => {
    const root = tmpRoot();
    const source = upsertAssistant(root, { displayName: "区域甲续签助手", introduction: "" });
    const copy = duplicateAssistant(root, source.assistantId, { displayName: "区域乙续签助手" });
    expect(copy.displayName).toBe("区域乙续签助手");
  });

  it("still numbers an explicit name that is already taken", () => {
    const root = tmpRoot();
    upsertAssistant(root, { displayName: "区域乙续签助手", introduction: "" });
    const source = upsertAssistant(root, { displayName: "区域甲续签助手", introduction: "" });
    const copy = duplicateAssistant(root, source.assistantId, { displayName: "区域乙续签助手" });
    expect(copy.displayName).toBe("区域乙续签助手 2");
  });

  it("refuses to duplicate an assistant that does not exist", () => {
    expect(() => duplicateAssistant(tmpRoot(), "nope")).toThrow(/助手不存在/);
  });

  it("adds exactly one assistant to the roster", () => {
    const root = tmpRoot();
    const source = upsertAssistant(root, { displayName: "小陈", introduction: "" });
    const before = loadAssistantProfiles(root).length;
    duplicateAssistant(root, source.assistantId);
    const ids = loadAssistantProfiles(root).map((a) => a.assistantId);
    expect(ids).toHaveLength(before + 1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("uniqueAssistantDisplayName", () => {
  it("returns the base name when free", () => {
    expect(uniqueAssistantDisplayName("小陈 副本", new Set())).toBe("小陈 副本");
  });

  it("numbers from 2 when taken", () => {
    const taken = new Set(["小陈 副本", "小陈 副本 2"]);
    expect(uniqueAssistantDisplayName("小陈 副本", taken)).toBe("小陈 副本 3");
  });

  it("falls back to a usable name for blank input", () => {
    expect(uniqueAssistantDisplayName("   ", new Set())).toBe("新助手");
  });
});
