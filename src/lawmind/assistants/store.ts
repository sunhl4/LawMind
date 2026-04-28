/**
 * assistants.json / assistant-stats.json 读写（位于 LawMind 根目录，与 .env.lawmind 同级）
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAssistantPreset } from "../agent/assistant-presets.js";
import { DEFAULT_ASSISTANT_ID } from "./constants.js";
import type {
  AssistantOrgRole,
  AssistantProfile,
  AssistantStatsEntry,
  AssistantStatsFile,
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
        out.push(row);
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
    const org = mergeOrgFields(base, patch);
    const next: AssistantProfile = {
      ...base,
      displayName: patch.displayName !== undefined ? patch.displayName.trim() : base.displayName,
      introduction:
        patch.introduction !== undefined ? patch.introduction.trim() : base.introduction,
      presetKey:
        patch.presetKey !== undefined ? patch.presetKey.trim() || undefined : base.presetKey,
      customRoleTitle:
        patch.customRoleTitle !== undefined
          ? patch.customRoleTitle.trim() || undefined
          : base.customRoleTitle,
      customRoleInstructions:
        patch.customRoleInstructions !== undefined
          ? patch.customRoleInstructions.trim() || undefined
          : base.customRoleInstructions,
      orgRole: org.orgRole,
      reportsToAssistantId: org.reportsToAssistantId,
      peerReviewDefaultAssistantId: org.peerReviewDefaultAssistantId,
      updatedAt: now,
    };
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
  const next: AssistantProfile = {
    assistantId: id,
    displayName: patch.displayName?.trim() || "新助手",
    introduction: patch.introduction?.trim() || "",
    presetKey: patch.presetKey?.trim() || undefined,
    customRoleTitle: patch.customRoleTitle?.trim() || undefined,
    customRoleInstructions: patch.customRoleInstructions?.trim() || undefined,
    orgRole: org.orgRole,
    reportsToAssistantId: org.reportsToAssistantId,
    peerReviewDefaultAssistantId: org.peerReviewDefaultAssistantId,
    createdAt: now,
    updatedAt: now,
  };
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

  const roleDirective = parts.filter(Boolean).join("\n\n");

  return {
    roleTitle: title,
    roleIntroduction: intro,
    roleDirective,
  };
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
