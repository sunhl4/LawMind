/**
 * Load lawyer-dropped shadow cases from the workspace when present.
 * CI uses synthetic fixtures; this only adds extras if files exist.
 *
 * 真回放对齐：投放的已结案 fixture（instruction + lawyerFinalText，可带
 * engineDraftText / modelScript）走与内置 fixture 相同的 engine-scripted-model
 * 路径（runWorkspaceEngineShadowReplay）；真模型单轮保持在
 * LAWMIND_SHADOW_REAL_MODEL env 门后，CI 不依赖真模型。
 */

import fs from "node:fs";
import path from "node:path";
import {
  runEngineShadowReplay,
  type EngineShadowReplayOptions,
  type EngineShadowReplayReport,
} from "./shadow-engine-replay.js";
import {
  BUILTIN_SHADOW_FIXTURES,
  defaultShadowModelScript,
  runShadowReplay,
  type ShadowReplayFixture,
  type ShadowReplayReport,
} from "./shadow-replay.js";

function parseFixture(raw: unknown): ShadowReplayFixture | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  if (
    typeof rec.id !== "string" ||
    typeof rec.instruction !== "string" ||
    typeof rec.lawyerFinalText !== "string" ||
    typeof rec.engineDraftText !== "string"
  ) {
    return undefined;
  }
  return {
    id: rec.id,
    instruction: rec.instruction,
    lawyerFinalText: rec.lawyerFinalText,
    engineDraftText: rec.engineDraftText,
    plantedDefectRuleIds: Array.isArray(rec.plantedDefectRuleIds)
      ? rec.plantedDefectRuleIds.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

export function loadWorkspaceShadowFixtures(workspaceDir: string): ShadowReplayFixture[] {
  const dir = path.join(workspaceDir, "lawmind", "shadow");
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: ShadowReplayFixture[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = parseFixture(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
      if (parsed) {
        out.push(parsed);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export function runWorkspaceShadowReplay(workspaceDir: string): ShadowReplayReport {
  const extra = loadWorkspaceShadowFixtures(workspaceDir);
  return runShadowReplay([...BUILTIN_SHADOW_FIXTURES, ...extra]);
}

/**
 * 已结案投放的真回放解析：instruction + lawyerFinalText 必填；
 * engineDraftText 存在时作为默认 cassette 的草稿内容（模型脚本可显式覆盖）。
 * 无 engineDraftText 且无 modelScript 的投放只在真模型模式下可回放
 * （脚本化模式记 no-script 跳过，不伪造草稿来源）。
 */
function parseWorkspaceEngineFixture(raw: unknown): ShadowReplayFixture | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.instruction !== "string") {
    return undefined;
  }
  if (typeof rec.lawyerFinalText !== "string" || !rec.lawyerFinalText.trim()) {
    return undefined;
  }
  const engineDraftText = typeof rec.engineDraftText === "string" ? rec.engineDraftText : "";
  const planted = rec.plantedDefectRuleIds;
  const hasExplicitScript = Array.isArray(rec.modelScript) && rec.modelScript.length > 0;
  return {
    id: rec.id,
    instruction: rec.instruction,
    lawyerFinalText: rec.lawyerFinalText,
    engineDraftText,
    plantedDefectRuleIds: Array.isArray(planted)
      ? planted.filter((x): x is string => typeof x === "string")
      : undefined,
    ...(hasExplicitScript
      ? { modelScript: rec.modelScript as ShadowReplayFixture["modelScript"] }
      : engineDraftText.trim()
        ? { modelScript: defaultShadowModelScript() }
        : {}),
  };
}

export function loadWorkspaceEngineShadowFixtures(workspaceDir: string): ShadowReplayFixture[] {
  const dir = path.join(workspaceDir, "lawmind", "shadow");
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: ShadowReplayFixture[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = parseWorkspaceEngineFixture(
        JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")),
      );
      if (parsed) {
        out.push(parsed);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * 已结案投放的真回放：只跑工作区投放（内置 fixture 的真回放入口是
 * runEngineShadowReplay / lawmind:benchmark --shadow-engine），与内置共用同一
 * engine-scripted-model 机制。真模型见 isShadowRealModelEnabled。
 */
export async function runWorkspaceEngineShadowReplay(
  workspaceDir: string,
  opts: EngineShadowReplayOptions = {},
): Promise<EngineShadowReplayReport> {
  return runEngineShadowReplay(loadWorkspaceEngineShadowFixtures(workspaceDir), opts);
}
