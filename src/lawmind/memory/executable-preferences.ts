/**
 * Structured, executable lawyer preferences (JSON) + Markdown §八 merge.
 * Preferences are rules the agent must acknowledge applying.
 */

import fs from "node:fs";
import path from "node:path";
import {
  extractAppliedPreferencesFromProfile,
  type AppliedPreference,
} from "./applied-preferences.js";

export type ExecutablePreference = AppliedPreference & {
  id: string;
  tags?: string[];
  source: "json" | "profile";
};

type PrefsFileV1 = {
  schemaVersion: 1;
  preferences: Array<{
    id: string;
    text: string;
    tags?: string[];
    capturedAt?: string;
  }>;
};

function prefsFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "lawyer-preferences.json");
}

export function readExecutablePreferencesFile(workspaceDir: string): ExecutablePreference[] {
  const p = prefsFilePath(workspaceDir);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw) as PrefsFileV1;
    if (j?.schemaVersion !== 1 || !Array.isArray(j.preferences)) {
      return [];
    }
    return j.preferences
      .filter((x) => typeof x?.id === "string" && typeof x?.text === "string" && x.text.trim())
      .map((x) => ({
        id: x.id.trim(),
        text: x.text.trim(),
        tags: Array.isArray(x.tags)
          ? x.tags.filter((t): t is string => typeof t === "string")
          : undefined,
        capturedAt: typeof x.capturedAt === "string" ? x.capturedAt : undefined,
        source: "json" as const,
      }));
  } catch {
    return [];
  }
}

export function writeExecutablePreference(
  workspaceDir: string,
  pref: { id?: string; text: string; tags?: string[] },
): ExecutablePreference {
  const dir = path.join(workspaceDir, "lawmind");
  fs.mkdirSync(dir, { recursive: true });
  const existing = readExecutablePreferencesFile(workspaceDir);
  const id =
    pref.id?.trim() || `pref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next: ExecutablePreference = {
    id,
    text: pref.text.trim(),
    tags: pref.tags,
    capturedAt: new Date().toISOString().slice(0, 10),
    source: "json",
  };
  const merged = [next, ...existing.filter((e) => e.id !== id)].slice(0, 40);
  const payload: PrefsFileV1 = {
    schemaVersion: 1,
    preferences: merged.map((e) => ({
      id: e.id,
      text: e.text,
      tags: e.tags,
      capturedAt: e.capturedAt,
    })),
  };
  fs.writeFileSync(prefsFilePath(workspaceDir), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return next;
}

/** Remove a JSON-backed preference by id. Profile-sourced prefs cannot be cleared here. */
export function clearExecutablePreference(
  workspaceDir: string,
  id: string,
): { ok: boolean; cleared: boolean } {
  const trimmed = id.trim();
  if (!trimmed || trimmed.startsWith("profile_")) {
    return { ok: false, cleared: false };
  }
  const existing = readExecutablePreferencesFile(workspaceDir);
  const next = existing.filter((e) => e.id !== trimmed);
  if (next.length === existing.length) {
    return { ok: true, cleared: false };
  }
  const dir = path.join(workspaceDir, "lawmind");
  fs.mkdirSync(dir, { recursive: true });
  const payload: PrefsFileV1 = {
    schemaVersion: 1,
    preferences: next.map((e) => ({
      id: e.id,
      text: e.text,
      tags: e.tags,
      capturedAt: e.capturedAt,
    })),
  };
  fs.writeFileSync(prefsFilePath(workspaceDir), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { ok: true, cleared: true };
}

/**
 * Merge JSON prefs (priority) with profile §八 bullets.
 */
export function loadExecutablePreferences(
  workspaceDir: string,
  profileMarkdown: string,
  limit = 8,
): ExecutablePreference[] {
  const fromJson = readExecutablePreferencesFile(workspaceDir);
  const fromProfile = extractAppliedPreferencesFromProfile(profileMarkdown, limit).map(
    (p, i): ExecutablePreference => ({
      id: `profile_${i}_${p.text.slice(0, 12)}`,
      text: p.text,
      capturedAt: p.capturedAt,
      source: "profile",
    }),
  );
  const seen = new Set<string>();
  const out: ExecutablePreference[] = [];
  for (const p of [...fromJson, ...fromProfile]) {
    const key = p.text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(p);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

export function formatExecutablePreferencesHint(prefs: ExecutablePreference[]): string | undefined {
  if (prefs.length === 0) {
    return undefined;
  }
  const lines = prefs.map((p, i) => `${i + 1}. [${p.id}] ${p.text}`);
  return ["已按你的习惯（可执行偏好；回复末尾须列出「本轮已应用」的 id）：", ...lines].join("\n");
}

/**
 * Detect which preference ids the assistant claim to have applied (best-effort).
 */
export function detectAppliedPreferenceIds(reply: string, prefs: ExecutablePreference[]): string[] {
  if (!reply.trim() || prefs.length === 0) {
    return [];
  }
  const applied: string[] = [];
  for (const p of prefs) {
    if (reply.includes(p.id) || reply.includes(p.text.slice(0, Math.min(24, p.text.length)))) {
      applied.push(p.id);
    }
  }
  const m = /本轮已应用[：:]\s*([^\n]+)/.exec(reply);
  if (m) {
    for (const p of prefs) {
      if (m[1].includes(p.id) && !applied.includes(p.id)) {
        applied.push(p.id);
      }
    }
  }
  return applied;
}
