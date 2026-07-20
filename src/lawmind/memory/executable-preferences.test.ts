import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearExecutablePreference,
  detectAppliedPreferenceIds,
  formatExecutablePreferencesHint,
  loadExecutablePreferences,
  writeExecutablePreference,
} from "./executable-preferences.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("executable-preferences", () => {
  it("writes JSON prefs and merges with profile bullets", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pref-"));
    dirs.push(ws);
    writeExecutablePreference(ws, {
      id: "pref_tone",
      text: "对外函件语气正式严谨",
      tags: ["tone"],
    });
    const profile = `## 八、个人积累\n- 冷启动偏好：风险口径=偏保守\n`;
    const prefs = loadExecutablePreferences(ws, profile, 5);
    expect(prefs[0]?.id).toBe("pref_tone");
    expect(prefs.some((p) => p.text.includes("偏保守"))).toBe(true);
    expect(formatExecutablePreferencesHint(prefs)).toContain("本轮已应用");
  });

  it("clears JSON prefs and detects applied ids from reply", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pref-clear-"));
    dirs.push(ws);
    writeExecutablePreference(ws, { id: "pref_tone", text: "对外函件语气正式严谨" });
    writeExecutablePreference(ws, { id: "pref_risk", text: "风险口径偏保守" });
    expect(clearExecutablePreference(ws, "pref_tone")).toEqual({ ok: true, cleared: true });
    const prefs = loadExecutablePreferences(ws, "", 8);
    expect(prefs.map((p) => p.id)).toEqual(["pref_risk"]);
    const applied = detectAppliedPreferenceIds("已按习惯起草。\n本轮已应用：pref_risk", prefs);
    expect(applied).toContain("pref_risk");
  });
});
