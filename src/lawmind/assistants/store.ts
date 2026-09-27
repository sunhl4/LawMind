/**
 * assistants.json / assistant-stats.json 读写（位于 LawMind 根目录，与 .env.lawmind 同级）
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAssistantPreset } from "../agent/assistant-presets.js";
import { DEFAULT_ASSISTANT_ID } from "./constants.js";
import { assertAssistantRosterHasRoom, normalizeAssistantRosterFlags } from "./roster.js";
import type {
  AssistantJobBrief,
  AssistantOrgRole,
  AssistantProfile,
  AssistantStatsEntry,
  AssistantStatsFile,
} from "./types.js";
import {
  ASSISTANT_JOB_BRIEF_FIELDS,
  ASSISTANT_JOB_BRIEF_LABELS,
  normalizeAssistantJobBrief,
} from "./types.js";

function pickOrgRole(v: unknown): AssistantOrgRole | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (v === null || v === "") {
    return undefined;
  }
  if (v === "lead" || v === "member" || v === "intern") {
    return v;
  }
  return undefined;
}

function mergeOrgFields(
  base: AssistantProfile,
  patch: Partial<AssistantProfile>,
): Pick<AssistantProfile, "orgRole" | "reportsToAssistantId" | "peerReviewDefaultAssistantId"> {
  const orgRole = patch.orgRole !== undefined ? pickOrgRole(patch.orgRole) : base.orgRole;
  const reportsToAssistantId =
    patch.reportsToAssistantId !== undefined
      ? patch.reportsToAssistantId.trim() || undefined
      : base.reportsToAssistantId;
  const peerReviewDefaultAssistantId =
    patch.peerReviewDefaultAssistantId !== undefined
      ? patch.peerReviewDefaultAssistantId.trim() || undefined
      : base.peerReviewDefaultAssistantId;
  return { orgRole, reportsToAssistantId, peerReviewDefaultAssistantId };
}

export function validateAssistantOrgLinks(profiles: AssistantProfile[]): void {
  const ids = new Set(profiles.map((p) => p.assistantId));
  for (const p of profiles) {
    if (p.reportsToAssistantId) {
      if (p.reportsToAssistantId === p.assistantId) {
        throw new Error("汇报对象不能是当前智能体自己");
      }
      if (!ids.has(p.reportsToAssistantId)) {
        throw new Error("汇报对象智能体不存在，请先创建或刷新列表");
      }
    }
    if (p.peerReviewDefaultAssistantId) {
      if (p.peerReviewDefaultAssistantId === p.assistantId) {
        throw new Error("互审默认对象不能是当前智能体自己");
      }
      if (!ids.has(p.peerReviewDefaultAssistantId)) {
        throw new Error("互审默认对象智能体不存在");
      }
    }
  }
}

export function resolveLawMindRoot(workspaceDir: string, envFile?: string): string {
  const raw = envFile?.trim();
  if (raw) {
    return path.dirname(path.resolve(raw));
  }
  return path.join(workspaceDir, "..");
}

function assistantsPath(lawMindRoot: string): string {
  return path.join(lawMindRoot, "assistants.json");
}

function statsPath(lawMindRoot: string): string {
  return path.join(lawMindRoot, "assistant-stats.json");
}

function defaultProfile(now: string): AssistantProfile {
  return {
    assistantId: DEFAULT_ASSISTANT_ID,
    displayName: "默认助手",
    introduction: "律所通用法律助理，处理各类法律工作任务。",
    presetKey: "general_default",
    createdAt: now,
    updatedAt: now,
  };
}

export function loadAssistantProfiles(lawMindRoot: string): AssistantProfile[] {
  const p = assistantsPath(lawMindRoot);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [defaultProfile(new Date().toISOString())];
    }
    const out: AssistantProfile[] = [];
    for (const row of parsed) {
      if (isAssistantProfile(row)) {
        out.push(normalizeAssistantRosterFlags(row));
      }
    }
    return out.length > 0 ? out : [defaultProfile(new Date().toISOString())];
  } catch {
    const now = new Date().toISOString();
    const seed = [defaultProfile(now)];
    saveAssistantProfiles(lawMindRoot, seed);
    return seed;
  }
}

function isAssistantProfile(x: unknown): x is AssistantProfile {
  if (!x || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.assistantId === "string" &&
    o.assistantId.length > 0 &&
    typeof o.displayName === "string" &&
    typeof o.introduction === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.updatedAt === "string"
  );
}

export function saveAssistantProfiles(lawMindRoot: string, profiles: AssistantProfile[]): void {
  fs.mkdirSync(lawMindRoot, { recursive: true });
  fs.writeFileSync(assistantsPath(lawMindRoot), `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
}

export function getAssistantById(
  lawMindRoot: string,
  assistantId: string,
): AssistantProfile | undefined {
  return loadAssistantProfiles(lawMindRoot).find((a) => a.assistantId === assistantId);
}

export function upsertAssistant(
  lawMindRoot: string,
  patch: Partial<AssistantProfile> & { assistantId?: string },
): AssistantProfile {
  const list = loadAssistantProfiles(lawMindRoot);
  const now = new Date().toISOString();
  const id = patch.assistantId?.trim() || randomUUID();
  const idx = list.findIndex((a) => a.assistantId === id);

  if (idx >= 0) {
    const base = list[idx];
    if (id === DEFAULT_ASSISTANT_ID && patch.hidden === true) {
      throw new Error("默认助手要留在日常切换里，不能隐藏");
    }
    const org = mergeOrgFields(base, patch);
    const next: AssistantProfile = normalizeAssistantRosterFlags({
      ...base,
      displayName: patch.displayName !== undefined ? patch.displayName.trim() : base.displayName,
      introduction:
        patch.introduction !== undefined ? patch.introduction.trim() : base.introduction,
      presetKey:
        patch.presetKey !== undefined ? patch.presetKey.trim() || undefined : base.presetKey,
      roleId:
        patch.roleId !== undefined
          ? patch.roleId.trim() || undefined
          : (base.roleId ?? base.presetKey),
      customRoleTitle:
        patch.customRoleTitle !== undefined
          ? patch.customRoleTitle.trim() || undefined
          : base.customRoleTitle,
      customRoleInstructions:
        patch.customRoleInstructions !== undefined
          ? patch.customRoleInstructions.trim() || undefined
          : base.customRoleInstructions,
      jobBrief:
        patch.jobBrief !== undefined ? normalizeAssistantJobBrief(patch.jobBrief) : base.jobBrief,
      orgRole: org.orgRole,
      reportsToAssistantId: org.reportsToAssistantId,
      peerReviewDefaultAssistantId: org.peerReviewDefaultAssistantId,
      pinned: patch.pinned !== undefined ? patch.pinned : base.pinned,
      hidden: patch.hidden !== undefined ? patch.hidden : base.hidden,
      updatedAt: now,
    });
    const nextList = list.map((a) => (a.assistantId === id ? next : a));
    validateAssistantOrgLinks(nextList);
    list[idx] = next;
    saveAssistantProfiles(lawMindRoot, list);
    return next;
  }

  const org = mergeOrgFields(
    {
      assistantId: id,
      displayName: "",
      introduction: "",
      createdAt: now,
      updatedAt: now,
    } as AssistantProfile,
    patch,
  );
  assertAssistantRosterHasRoom(list.length);
  const next: AssistantProfile = normalizeAssistantRosterFlags({
    assistantId: id,
    displayName: patch.displayName?.trim() || "新助手",
    introduction: patch.introduction?.trim() || "",
    presetKey: patch.presetKey?.trim() || undefined,
    roleId: patch.roleId?.trim() || patch.presetKey?.trim() || undefined,
    customRoleTitle: patch.customRoleTitle?.trim() || undefined,
    customRoleInstructions: patch.customRoleInstructions?.trim() || undefined,
    jobBrief: normalizeAssistantJobBrief(patch.jobBrief),
    orgRole: org.orgRole,
    reportsToAssistantId: org.reportsToAssistantId,
    peerReviewDefaultAssistantId: org.peerReviewDefaultAssistantId,
    pinned: patch.pinned === true ? true : undefined,
    hidden: patch.hidden === true ? true : undefined,
    createdAt: now,
    updatedAt: now,
  });
  const nextList = [...list, next];
  validateAssistantOrgLinks(nextList);
  list.push(next);
  saveAssistantProfiles(lawMindRoot, list);
  return next;
}

export function deleteAssistant(lawMindRoot: string, assistantId: string): boolean {
  if (assistantId === DEFAULT_ASSISTANT_ID) {
    return false;
  }
  const list = loadAssistantProfiles(lawMindRoot);
  const filtered = list.filter((a) => a.assistantId !== assistantId);
  if (filtered.length === list.length) {
    return false;
  }
  saveAssistantProfiles(lawMindRoot, filtered);
  return true;
}

/**
 * 名册复制：把**角色**复制成一个新助手。
 *
 * 复制什么、不复制什么（与 Grok Bot 公开口径一致：copy「profile, settings,
 * enabled skills, routines」但**不** copy「conversation history, learned memory,
 * attachments」）：
 * - **带走**：简介、岗位预设/标题/补充说明、**职务说明书**、组织关系与互审默认对象。
 *   这些是「这个岗位怎么干活」，换一个范围（区域、客户、业务线）仍适用。
 * - **不带**：记忆与用量。
 *   记忆（`<lawMindRoot>/assistants/<id>/PROFILE.md`）与用量
 *   （`assistant-stats.json`）都按 assistantId 存，新 id 天然为空——
 *   这不是「顺手没抄」，而是刻意的：新助手不该继承别人积累的客户事。
 *
 * 命名：默认 `X 副本`；已存在时递增成 `X 副本 2`、`X 副本 3`，
 * 否则连续复制两次会得到两个同名助手，名册就没法看了。
 */
export function duplicateAssistant(
  lawMindRoot: string,
  sourceAssistantId: string,
  opts: { displayName?: string; now?: Date } = {},
): AssistantProfile {
  const source = getAssistantById(lawMindRoot, sourceAssistantId);
  if (!source) {
    throw new Error("助手不存在，请先刷新名册");
  }
  const now = (opts.now ?? new Date()).toISOString();
  const list = loadAssistantProfiles(lawMindRoot);
  assertAssistantRosterHasRoom(list.length);
  const existingNames = new Set(list.map((a) => a.displayName));
  const baseName = opts.displayName?.trim() || `${source.displayName} 副本`;
  const displayName = uniqueAssistantDisplayName(baseName, existingNames);

  const copy: AssistantProfile = {
    assistantId: randomUUID(),
    displayName,
    introduction: source.introduction,
    jobBrief: normalizeAssistantJobBrief(source.jobBrief),
    presetKey: source.presetKey,
    roleId: source.roleId ?? source.presetKey,
    customRoleTitle: source.customRoleTitle,
    customRoleInstructions: source.customRoleInstructions,
    orgRole: source.orgRole,
    reportsToAssistantId: source.reportsToAssistantId,
    peerReviewDefaultAssistantId: source.peerReviewDefaultAssistantId,
    createdAt: now,
    updatedAt: now,
  };

  const nextList = [...list, copy];
  // 组织关系指向的是**别的**助手，复制后引用依然存在；这里仍跑一次校验，
  // 以便源数据本身已经坏掉时立刻报错，而不是把坏数据再复制一份。
  validateAssistantOrgLinks(nextList);
  saveAssistantProfiles(lawMindRoot, nextList);
  return copy;
}

/** `基名`、`基名 2`、`基名 3`…取第一个没被占用的。 */
export function uniqueAssistantDisplayName(baseName: string, taken: ReadonlySet<string>): string {
  const name = baseName.trim() || "新助手";
  if (!taken.has(name)) {
    return name;
  }
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${name} ${i}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${name} ${Date.now()}`;
}

/**
 * 合并预设段落与用户自定义说明，供 buildSystemPrompt 使用。
 */
export function buildRoleDirectiveFromProfile(profile: AssistantProfile): {
  roleTitle: string;
  roleIntroduction: string;
  roleDirective: string;
} {
  const preset = getAssistantPreset(profile.presetKey);
  const title =
    profile.customRoleTitle?.trim() || preset?.displayName || profile.displayName || "法律助理";

  const intro = profile.introduction.trim();

  const parts: string[] = [];
  if (preset?.promptSection) {
    parts.push(preset.promptSection.trim());
  }
  if (profile.customRoleInstructions?.trim()) {
    parts.push("## 用户补充的岗位说明\n\n" + profile.customRoleInstructions.trim());
  }
  const briefBlock = buildJobBriefBlock(profile.jobBrief);
  if (briefBlock) {
    parts.push(briefBlock);
  }

  const roleDirective = parts.filter(Boolean).join("\n\n");

  return {
    roleTitle: title,
    roleIntroduction: intro,
    roleDirective,
  };
}

/**
 * 把职务说明书渲染成提示词区块。全空返回 `undefined`（不注入空标题）。
 *
 * 导出是为了让单测直接断言「哪些字进了提示词」——AGENTS.md 允许汇编器单测
 * 断言动态注入值（这正是其一），但不允许断言「某句中文还在提示词里」。
 */
export function buildJobBriefBlock(brief: AssistantJobBrief | undefined): string | undefined {
  const normalized = normalizeAssistantJobBrief(brief);
  if (!normalized) {
    return undefined;
  }
  const lines: string[] = [
    "## 职务说明书",
    "",
    "以下是对你长期有效的岗位边界（不是本次任务的补充说明）。",
  ];
  for (const field of ASSISTANT_JOB_BRIEF_FIELDS) {
    const value = normalized[field];
    if (value) {
      lines.push(`- ${ASSISTANT_JOB_BRIEF_LABELS[field]}：${value}`);
    }
  }
  // 禁止项与上报条件是这个结构存在的理由，单独强调一次。
  if (normalized.prohibitions || normalized.escalation) {
    lines.push("", "边界优先于效率：越界比慢一点更糟。");
  }
  return lines.join("\n");
}

export function loadAssistantStats(lawMindRoot: string): AssistantStatsFile {
  try {
    const raw = fs.readFileSync(statsPath(lawMindRoot), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as AssistantStatsFile;
  } catch {
    return {};
  }
}

export function saveAssistantStats(lawMindRoot: string, stats: AssistantStatsFile): void {
  fs.mkdirSync(lawMindRoot, { recursive: true });
  fs.writeFileSync(statsPath(lawMindRoot), `${JSON.stringify(stats, null, 2)}\n`, "utf8");
}

export function bumpAssistantStats(
  lawMindRoot: string,
  assistantId: string,
  opts: { newSession?: boolean; turn?: boolean },
): AssistantStatsEntry {
  const stats = loadAssistantStats(lawMindRoot);
  const now = new Date().toISOString();
  const prev = stats[assistantId];
  const next: AssistantStatsEntry = {
    lastUsedAt: now,
    turnCount: (prev?.turnCount ?? 0) + (opts.turn ? 1 : 0),
    sessionCount: (prev?.sessionCount ?? 0) + (opts.newSession ? 1 : 0),
  };
  stats[assistantId] = next;
  saveAssistantStats(lawMindRoot, stats);
  return next;
}

export { DEFAULT_ASSISTANT_ID };
