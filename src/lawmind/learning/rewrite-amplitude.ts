/**
 * T1.4 — Rewrite amplitude (quality meta).
 * Char / paragraph delta on revision complete; never silent-writes profiles.
 */

import fs from "node:fs";
import path from "node:path";
import { appendProductMetric } from "../metrics/product-metrics.js";
import type { ArtifactDraft } from "../types.js";

export type RewriteAmplitudeSample = {
  assistantId: string;
  taskId: string;
  matterId?: string;
  charBefore: number;
  charAfter: number;
  charDelta: number;
  absCharDelta: number;
  paragraphsBefore: number;
  paragraphsAfter: number;
  paragraphDelta: number;
  absParagraphDelta: number;
  at: string;
};

export type RewriteAmplitudeAssistantStats = {
  assistantId: string;
  samples: number;
  totalAbsCharDelta: number;
  totalAbsParagraphDelta: number;
  lastAbsCharDelta: number;
  lastAbsParagraphDelta: number;
  lastUpdatedAt: string;
};

export type RewriteAmplitudeStore = {
  version: 1;
  byAssistant: Record<string, RewriteAmplitudeAssistantStats>;
};

function storePath(workspaceDir: string): string {
  return path.join(workspaceDir, "quality", "rewrite-amplitude.json");
}

export function draftPlainText(draft: ArtifactDraft): string {
  const parts: string[] = [];
  if (draft.title?.trim()) {
    parts.push(draft.title.trim());
  }
  if (draft.summary?.trim()) {
    parts.push(draft.summary.trim());
  }
  for (const s of draft.sections ?? []) {
    const h = s.heading?.trim() ?? "";
    const b = s.body?.trim() ?? "";
    if (h || b) {
      parts.push([h, b].filter(Boolean).join("\n"));
    }
  }
  return parts.join("\n\n");
}

export function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

export function computeRewriteAmplitude(
  before: string,
  after: string,
): Omit<RewriteAmplitudeSample, "assistantId" | "taskId" | "matterId" | "at"> {
  const charBefore = before.length;
  const charAfter = after.length;
  const charDelta = charAfter - charBefore;
  const paragraphsBefore = countParagraphs(before);
  const paragraphsAfter = countParagraphs(after);
  const paragraphDelta = paragraphsAfter - paragraphsBefore;
  return {
    charBefore,
    charAfter,
    charDelta,
    absCharDelta: Math.abs(charDelta),
    paragraphsBefore,
    paragraphsAfter,
    paragraphDelta,
    absParagraphDelta: Math.abs(paragraphDelta),
  };
}

export function loadRewriteAmplitudeStore(workspaceDir: string): RewriteAmplitudeStore {
  const p = storePath(workspaceDir);
  try {
    if (!fs.existsSync(p)) {
      return { version: 1, byAssistant: {} };
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as RewriteAmplitudeStore;
    if (raw?.version !== 1 || typeof raw.byAssistant !== "object") {
      return { version: 1, byAssistant: {} };
    }
    return raw;
  } catch {
    return { version: 1, byAssistant: {} };
  }
}

function saveStore(workspaceDir: string, store: RewriteAmplitudeStore): void {
  const p = storePath(workspaceDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function avgAbsCharDelta(stats: RewriteAmplitudeAssistantStats): number {
  if (stats.samples <= 0) {
    return 0;
  }
  return stats.totalAbsCharDelta / stats.samples;
}

export function avgAbsParagraphDelta(stats: RewriteAmplitudeAssistantStats): number {
  if (stats.samples <= 0) {
    return 0;
  }
  return stats.totalAbsParagraphDelta / stats.samples;
}

/**
 * Persist amplitude sample to quality meta + product-events (aux metric only).
 *
 * `source` **必须能区分两种改稿**（2026-09-22 补记）：
 *   - `assistant_revision`（默认）：助手后台修订写完 → 量的**助手改了多少**
 *   - `lawyer_edit`：律师在文书台直接改稿 → 量的**律师改了多少**
 *
 * 两者语义不同、总体也不同，混在一个桶里会让指标失去意义：
 * 预注册协议里「改稿幅度」要测的是**律师的编辑负担**，那是 `lawyer_edit`；
 * 助手修订幅度是**模型行为**指标。之所以补这个字段，是因为此前只有
 * `draft-revision` 一条路径产出样本，而律师最常用的直接改稿路径**不产出** ——
 * 于是「改稿幅度」实际测的是助手，与它要回答的问题不符。
 */
export function recordRewriteAmplitude(params: {
  workspaceDir: string;
  assistantId: string;
  taskId: string;
  matterId?: string;
  beforeText: string;
  afterText: string;
  /** 默认 `assistant_revision`（保持既有语义不变）。 */
  source?: "assistant_revision" | "lawyer_edit";
}): RewriteAmplitudeSample {
  const computed = computeRewriteAmplitude(params.beforeText, params.afterText);
  const sample: RewriteAmplitudeSample = {
    assistantId: params.assistantId.trim(),
    taskId: params.taskId,
    matterId: params.matterId,
    ...computed,
    at: new Date().toISOString(),
  };

  const store = loadRewriteAmplitudeStore(params.workspaceDir);
  const prev = store.byAssistant[sample.assistantId];
  store.byAssistant[sample.assistantId] = {
    assistantId: sample.assistantId,
    samples: (prev?.samples ?? 0) + 1,
    totalAbsCharDelta: (prev?.totalAbsCharDelta ?? 0) + sample.absCharDelta,
    totalAbsParagraphDelta: (prev?.totalAbsParagraphDelta ?? 0) + sample.absParagraphDelta,
    lastAbsCharDelta: sample.absCharDelta,
    lastAbsParagraphDelta: sample.absParagraphDelta,
    lastUpdatedAt: sample.at,
  };
  saveStore(params.workspaceDir, store);

  try {
    appendProductMetric(params.workspaceDir, {
      kind: "rewrite_amplitude",
      taskId: params.taskId,
      matterId: params.matterId,
      outcome: "ok",
      detail: `Δchars=${sample.charDelta};Δparas=${sample.paragraphDelta}`,
      meta: {
        assistantId: sample.assistantId,
        source: params.source ?? "assistant_revision",
        charDelta: sample.charDelta,
        absCharDelta: sample.absCharDelta,
        paragraphDelta: sample.paragraphDelta,
        absParagraphDelta: sample.absParagraphDelta,
        charBefore: sample.charBefore,
        charAfter: sample.charAfter,
      },
    });
  } catch {
    /* metrics best-effort */
  }

  return sample;
}
