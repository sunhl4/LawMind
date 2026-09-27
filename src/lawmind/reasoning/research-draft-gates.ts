/**
 * Production gates for compliance / learning / training drafts:
 * outline-before-write, desensitize, and outline-only skeleton mode.
 */

import fs from "node:fs";
import path from "node:path";
import {
  assertTrainingDesensitizeGate,
  scanTextForTrainingLeak,
} from "../research/desensitize-matter.js";
import { expandApprovedOutlineToSections } from "../research/outline-expand.js";
import {
  applyOutlineClarificationAnswer,
  extractOutlineAnswerFromResume,
  outlineAnswerDecision,
  outlineLooksApproved,
} from "../research/outline-hitl.js";
import {
  approveResearchOutline,
  persistResearchOutline,
  readResearchOutline,
} from "../research/outline-store.js";
import {
  buildResearchOutline,
  lawyerWantsOutlineHold,
  type ResearchOutline,
} from "../research/research-outline.js";
import type { ArtifactSection, ResearchBundle, TaskIntent } from "../types.js";

export { expandApprovedOutlineToSections };

export const OUTLINE_GATED_DELIVERABLES = new Set([
  "report.compliance",
  "report.learning",
  "ppt.training",
]);

export function isOutlineGatedDeliverable(type: string | undefined): boolean {
  return !!type && OUTLINE_GATED_DELIVERABLES.has(type);
}

export function resolveOutlineForDraft(opts: {
  workspaceDir?: string;
  intent: TaskIntent;
  bundle?: ResearchBundle | null;
}): { outline: ResearchOutline; approved: boolean } {
  const { intent, bundle } = opts;
  let outline =
    (opts.workspaceDir ? readResearchOutline(opts.workspaceDir, intent.taskId) : undefined) ??
    buildResearchOutline(intent, bundle);

  const resumeAnswer = extractOutlineAnswerFromResume(intent.instruction);
  if (resumeAnswer) {
    const applied = applyOutlineClarificationAnswer(outline, resumeAnswer);
    if (applied) {
      outline = applied;
      if (opts.workspaceDir) {
        persistResearchOutline(opts.workspaceDir, intent.taskId, outline);
        approveResearchOutline(opts.workspaceDir, intent.taskId, {
          sections: outline.sections,
          lawyerNotes: resumeAnswer.slice(0, 200),
        });
      }
      return { outline, approved: true };
    }
    // Reject / unclear clarification answers must not rubber-stamp via free-text markers.
    const decision = outlineAnswerDecision(resumeAnswer);
    if (decision === "rejected") {
      const rebuilt = buildResearchOutline(intent, bundle);
      const hold = lawyerWantsOutlineHold(`${intent.instruction ?? ""} ${intent.summary ?? ""}`);
      outline = {
        ...rebuilt,
        status: hold ? "pending" : "approved",
        notes: [
          ...rebuilt.notes,
          hold
            ? "律师不同意上一版大纲，已按当前检索结果重建，请再次确认。"
            : "律师不同意上一版大纲，已按当前检索结果重建并直接写正文。",
        ],
      };
      if (opts.workspaceDir) {
        persistResearchOutline(opts.workspaceDir, intent.taskId, outline);
      }
      return { outline, approved: !hold };
    }
    if (decision === "unclear") {
      const hold = lawyerWantsOutlineHold(`${intent.instruction ?? ""} ${intent.summary ?? ""}`);
      outline = { ...outline, status: hold ? "pending" : "approved" };
      if (opts.workspaceDir) {
        persistResearchOutline(opts.workspaceDir, intent.taskId, outline);
      }
      return { outline, approved: !hold };
    }
  }

  const hold = lawyerWantsOutlineHold(`${intent.instruction ?? ""} ${intent.summary ?? ""}`);
  if (hold && !outlineLooksApproved(intent.instruction)) {
    outline = { ...outline, status: "pending" };
    if (opts.workspaceDir) {
      persistResearchOutline(opts.workspaceDir, intent.taskId, outline);
    }
  } else if (outlineLooksApproved(intent.instruction) || !hold) {
    outline = { ...outline, status: "approved" };
    if (opts.workspaceDir) {
      persistResearchOutline(opts.workspaceDir, intent.taskId, outline);
      approveResearchOutline(opts.workspaceDir, intent.taskId);
    }
  }

  return { outline, approved: outline.status === "approved" };
}

export function buildOutlineOnlySections(outline: ResearchOutline): ArtifactSection[] {
  return [
    {
      heading: "研究大纲（待确认 — 确认前不扩写正文）",
      body: [
        "本轮仅输出大纲。请在澄清卡片中：",
        "1) 回复「大纲已确认」；或",
        "2) 粘贴修订后的 ## 章节 与 - 要点 后确认；或",
        "3) 回复「不同意大纲」以要求重做。",
        "",
        ...outline.sections.map(
          (s) => `## ${s.heading}\n（${s.purpose}）\n${s.bullets.map((b) => `- ${b}`).join("\n")}`,
        ),
        "",
        ...(outline.notes.length ? ["## 备注", ...outline.notes.map((n) => `- ${n}`)] : []),
      ].join("\n"),
    },
  ];
}

export function loadMatterTextForDesense(opts: {
  workspaceDir?: string;
  matterId?: string;
  instruction: string;
}): string {
  const parts = [opts.instruction];
  if (opts.workspaceDir && opts.matterId) {
    try {
      const p = path.join(opts.workspaceDir, "cases", opts.matterId, "CASE.md");
      parts.push(fs.readFileSync(p, "utf8"));
    } catch {
      // no CASE.md
    }
  }
  return parts.join("\n");
}

export function trainingDesenseGateOrThrow(opts: {
  workspaceDir?: string;
  intent: TaskIntent;
}): void {
  if (opts.intent.deliverableType !== "ppt.training") {
    return;
  }
  const matterText = loadMatterTextForDesense({
    workspaceDir: opts.workspaceDir,
    matterId: opts.intent.matterId,
    instruction: `${opts.intent.instruction}\n${opts.intent.summary ?? ""}`,
  });
  const gate = assertTrainingDesensitizeGate({
    matterText,
    instruction: opts.intent.instruction,
  });
  if (!gate.ok) {
    const err = new Error(gate.error) as Error & { code?: string; scan?: unknown };
    err.code = "training_desense_gate";
    err.scan = gate.scan;
    throw err;
  }
  void scanTextForTrainingLeak(matterText);
}
