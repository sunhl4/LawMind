/**
 * Optional lawyer practice playbook. Missing file = built-in defaults; never blocks a turn.
 * Changing the file only affects later tasks; existing drafts are not recomputed.
 */

import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";
import {
  PRACTICE_STANCE_DEFAULTS,
  PRACTICE_STANCE_LABELS,
  type PracticeStanceDefault,
} from "./practice-playbook-constants.js";

export {
  PRACTICE_STANCE_DEFAULTS,
  PRACTICE_STANCE_LABELS,
  type PracticeStanceDefault,
} from "./practice-playbook-constants.js";

export const PRACTICE_PLAYBOOK_REL = path.join("lawmind", "practice-playbook.json");

export type PracticePlaybook = {
  schemaVersion: 1;
  stanceDefault: PracticeStanceDefault;
  governingLaw: "PRC";
  disputeForum: string;
  neverAccept: string[];
  notes: string;
  updatedAt?: string;
};

export type LoadedPracticePlaybook = PracticePlaybook & {
  source: "default" | "workspace";
};

export const DEFAULT_PRACTICE_PLAYBOOK: PracticePlaybook = {
  schemaVersion: 1,
  stanceDefault: "protect_instructing",
  governingLaw: "PRC",
  disputeForum: "写明有管辖权的人民法院或仲裁；反对仅约定对方所在地且对我方明显不利。",
  neverAccept: ["无限责任", "排除人身/故意/重大过失责任的条款不经提示", "仅对方所在地单方管辖"],
  notes: "",
};

export function practicePlaybookPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), PRACTICE_PLAYBOOK_REL);
}

function asStance(value: unknown): PracticeStanceDefault {
  if (value === "our_paper" || value === "neutral" || value === "protect_instructing") {
    return value;
  }
  return DEFAULT_PRACTICE_PLAYBOOK.stanceDefault;
}

function asStringList(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PRACTICE_PLAYBOOK.neverAccept];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, max);
}

export function parsePracticePlaybook(raw: unknown): PracticePlaybook {
  const j = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const notes = typeof j.notes === "string" ? j.notes.trim().slice(0, 2_000) : "";
  const dispute =
    typeof j.disputeForum === "string" && j.disputeForum.trim()
      ? j.disputeForum.trim().slice(0, 500)
      : DEFAULT_PRACTICE_PLAYBOOK.disputeForum;
  const updatedAt = typeof j.updatedAt === "string" ? j.updatedAt.trim() : undefined;
  return {
    schemaVersion: 1,
    stanceDefault: asStance(j.stanceDefault),
    governingLaw: "PRC",
    disputeForum: dispute,
    neverAccept: asStringList(j.neverAccept),
    notes,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function loadPracticePlaybook(workspaceDir: string | undefined): LoadedPracticePlaybook {
  if (!workspaceDir?.trim()) {
    return { ...DEFAULT_PRACTICE_PLAYBOOK, source: "default" };
  }
  const file = practicePlaybookPath(workspaceDir);
  try {
    if (!fs.existsSync(file)) {
      return { ...DEFAULT_PRACTICE_PLAYBOOK, source: "default" };
    }
    const parsed = parsePracticePlaybook(JSON.parse(fs.readFileSync(file, "utf8")));
    return { ...parsed, source: "workspace" };
  } catch {
    return { ...DEFAULT_PRACTICE_PLAYBOOK, source: "default" };
  }
}

export async function savePracticePlaybook(
  workspaceDir: string,
  partial: Partial<PracticePlaybook>,
): Promise<LoadedPracticePlaybook> {
  const current = loadPracticePlaybook(workspaceDir);
  const next = parsePracticePlaybook({
    ...current,
    ...(partial.stanceDefault !== undefined ? { stanceDefault: partial.stanceDefault } : {}),
    ...(partial.disputeForum !== undefined ? { disputeForum: partial.disputeForum } : {}),
    ...(partial.neverAccept !== undefined ? { neverAccept: partial.neverAccept } : {}),
    ...(partial.notes !== undefined ? { notes: partial.notes } : {}),
    schemaVersion: 1,
    governingLaw: "PRC",
    updatedAt: new Date().toISOString(),
  });
  const file = practicePlaybookPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeFileAtomicAsync(file, `${JSON.stringify(next, null, 2)}\n`);
  return { ...next, source: "workspace" };
}

/** Mail short path and Word tracked redline keep their frozen prompts. */
export function shouldInjectPracticePlaybook(
  bound:
    | {
        id: string;
        pipeline: string;
      }
    | null
    | undefined,
): boolean {
  if (!bound) {
    return false;
  }
  if (bound.pipeline === "tracked_redline") {
    return false;
  }
  if (bound.id === "mail.contract") {
    return false;
  }
  return true;
}

export function formatPracticePlaybookPromptBlock(playbook: LoadedPracticePlaybook): string {
  const origin =
    playbook.source === "workspace"
      ? `本工作区口径${playbook.updatedAt ? `（${playbook.updatedAt}）` : ""}`
      : "开箱默认（律师未改设置）";
  const never = playbook.neverAccept.map((item) => `- ${item}`).join("\n");
  const notes = playbook.notes.trim() ? `\n律师备注：${playbook.notes}` : "";
  return [
    "## 执业口径",
    `来源：${origin}。改口径只影响**之后**的新任务；已生成草稿不自动重算。`,
    `默认立场：${PRACTICE_STANCE_LABELS[playbook.stanceDefault]}。准据法：中国法。`,
    `争议解决：${playbook.disputeForum}`,
    "原则上不接受：",
    never || `- ${DEFAULT_PRACTICE_PLAYBOOK.neverAccept[0]}`,
    notes,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
