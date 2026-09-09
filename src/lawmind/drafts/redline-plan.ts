/**
 * Plan list for surgical redline (non-locked 合同审查).
 * Model writes the plan; apply_surgical_edits executes. Mail/Word tool names unchanged.
 */

import fs from "node:fs";
import path from "node:path";
import type { SurgicalTextEdit } from "./apply-surgical-edits.js";
import { explainInvalidSurgicalEdit, tryNarrowSurgicalEdit } from "./apply-surgical-edits.js";

export type RedlinePlanItem = SurgicalTextEdit & {
  priority?: "P0" | "P1" | "P2";
  narrowed?: boolean;
};

export type RedlinePlan = {
  taskId: string;
  items: RedlinePlanItem[];
  skipped: Array<{ find: string; replace: string; reason: string }>;
  updatedAt: string;
};

export function normalizeRedlinePlanItems(edits: SurgicalTextEdit[]): {
  items: RedlinePlanItem[];
  skipped: RedlinePlan["skipped"];
} {
  const items: RedlinePlanItem[] = [];
  const skipped: RedlinePlan["skipped"] = [];
  for (const raw of edits) {
    const invalid = explainInvalidSurgicalEdit(raw.find, raw.replace);
    if (!invalid) {
      items.push({ ...raw });
      continue;
    }
    const narrowed = tryNarrowSurgicalEdit(raw.find, raw.replace);
    if (!narrowed) {
      skipped.push({
        find: raw.find.slice(0, 40),
        replace: raw.replace.slice(0, 40),
        reason: invalid,
      });
      continue;
    }
    items.push({
      find: narrowed.find,
      replace: narrowed.replace,
      note: [raw.note, "已收窄锚定"].filter(Boolean).join("；"),
      narrowed: true,
    });
  }
  return { items, skipped };
}

export function redlinePlanPath(workspaceDir: string, taskId: string): string {
  return path.join(path.resolve(workspaceDir), "drafts", `${taskId}.redline-plan.json`);
}

export function writeRedlinePlan(workspaceDir: string, plan: RedlinePlan): void {
  const file = redlinePlanPath(workspaceDir, plan.taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

export function readRedlinePlan(workspaceDir: string, taskId: string): RedlinePlan | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(redlinePlanPath(workspaceDir, taskId), "utf8"),
    ) as RedlinePlan;
    if (!raw || !Array.isArray(raw.items)) {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

/** Unlocked export path: coach the model to narrow finds; render path may auto-retry once. */
export function buildXmlQaRetryHint(plan: RedlinePlan | undefined): {
  action: "narrow_and_reapply";
  edits: Array<{ find: string; replace: string }>;
} {
  const source = (plan?.items ?? []).map((row) => ({ find: row.find, replace: row.replace }));
  const { items } = normalizeRedlinePlanItems(source);
  return {
    action: "narrow_and_reapply",
    edits: items.map((row) => ({ find: row.find, replace: row.replace })),
  };
}

/** Injected on execute_workflow 合同审查 only — not mail short path / Word tracked lock. */
export function formatRedlinePlanPromptBlock(): string {
  return [
    "## 改稿计划",
    "有钉选合同时：先列出计划（条款、最短 find、replace、P0/P1/P2），再一次性 `apply_surgical_edits`，然后 `render_tracked_draft`。",
    "模型不要直接改 Word。跨度过宽时引擎会收窄锚定；导出后系统核对修订 XML（w:ins/w:del）。空计划不得导出。",
    "没有钉选文件时只出意见（宏观/中观/微观+推荐措辞），不要假装已出红线。",
  ].join("\n");
}

export function shouldInjectRedlinePlanProtocol(
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
  if (bound.pipeline === "tracked_redline" || bound.id === "mail.contract") {
    return false;
  }
  return bound.id === "contract.review";
}
