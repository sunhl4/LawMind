/**
 * Plan list for surgical redline (non-locked 合同审查).
 * Model writes the plan; apply_surgical_edits executes. Mail/Word tool names unchanged.
 */

import fs from "node:fs";
import path from "node:path";
import {
  SURGICAL_PROTOCOL_TOOLS,
  toolsAllowAny,
  type PromptProtocolGate,
} from "../agent/prompt-protocol-gate.js";
import { isOpinionMemoDelivery, resolveTurnDeliveryIntent } from "../intent/delivery-intent.js";
import type { SurgicalTextEdit } from "./apply-surgical-edits.js";
import { computeMinimalEditSpans } from "./minimal-edit-script.js";

export type RedlinePlanItem = SurgicalTextEdit & {
  priority?: "P0" | "P1" | "P2";
  narrowed?: boolean;
};

export type RedlinePlan = {
  taskId: string;
  items: RedlinePlanItem[];
  skipped: Array<{ find: string; replace: string; reason: string }>;
  updatedAt: string;
  /** Writer-declared deferrals only — not a coverage self-score. */
  writerDeferred?: Array<{ issue?: string; reason?: string }>;
  /** True when apply_surgical_edits received a craft_check object (even deferred: []). */
  craftCheckAttached?: boolean;
};

export function normalizeRedlinePlanItems(edits: SurgicalTextEdit[]): {
  items: RedlinePlanItem[];
  skipped: RedlinePlan["skipped"];
} {
  const items: RedlinePlanItem[] = [];
  const skipped: RedlinePlan["skipped"] = [];
  for (const raw of edits) {
    if (!raw.find) {
      skipped.push({ find: "", replace: raw.replace.slice(0, 40), reason: "find 为空" });
      continue;
    }
    if (raw.find === raw.replace) {
      skipped.push({
        find: raw.find.slice(0, 40),
        replace: raw.replace.slice(0, 40),
        reason: "find 与 replace 相同",
      });
      continue;
    }
    // 最短改动硬不变量：不信输入粒度，重算成若干最短片段（保留文字不进修订轨）。
    const spans = computeMinimalEditSpans(raw.find, raw.replace);
    if (spans.length === 0) {
      skipped.push({
        find: raw.find.slice(0, 40),
        replace: raw.replace.slice(0, 40),
        reason: "find 与 replace 相同",
      });
      continue;
    }
    const minimized =
      spans.length > 1 || spans[0]?.before !== raw.find || spans[0]?.after !== raw.replace;
    for (const span of spans) {
      const priority = (raw as { priority?: "P0" | "P1" | "P2" }).priority;
      items.push({
        find: span.before,
        replace: span.after,
        ...(raw.note || minimized
          ? {
              note: [raw.note, minimized ? "已按最短改动拆分" : undefined]
                .filter(Boolean)
                .join("；"),
            }
          : {}),
        ...(priority ? { priority } : {}),
        ...(minimized ? { narrowed: true } : {}),
      });
    }
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

/** Injected on 合同审查 / Word 改稿 / 邮件合同 when surgical tools are advertised. */
export function formatRedlinePlanPromptBlock(): string {
  return [
    "## 改稿计划",
    "有钉选合同且要出修订稿时：先列最短 find/replace（条款、P0/P1/P2），再 `apply_surgical_edits`，然后 `render_tracked_draft`。",
    "不要直接改 Word 文件。跨度过宽时引擎会收窄锚定；导出后系统核对修订 XML（w:ins/w:del）。空修订不得导出。",
    "没有钉选文件、或律师只要意见书时，只出意见（宏观/中观/微观+推荐措辞），不要假装已出红线。",
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
  gate?: PromptProtocolGate,
): boolean {
  if (!bound) {
    return false;
  }
  if (isOpinionMemoDelivery(resolveTurnDeliveryIntent(gate?.instruction, gate?.pins))) {
    return false;
  }
  if (!toolsAllowAny(gate?.availableToolNames, SURGICAL_PROTOCOL_TOOLS)) {
    return false;
  }
  return (
    bound.id === "contract.review" ||
    bound.id === "mail.contract" ||
    bound.pipeline === "tracked_redline"
  );
}
