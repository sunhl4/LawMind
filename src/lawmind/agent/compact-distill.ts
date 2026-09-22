/**
 * After session compact, distill dropped / retained dialogue into memory-adoption suggestions
 * (lawyer preferences + matter session notes) for explicit lawyer review.
 *
 * Trust: never silent-write PROFILE / session-summary.md — only pending adoption.
 */

import { isRecentDuplicateAdoption } from "../learning/review-learning-suggest.js";
import {
  listMemorySuggestions,
  listPendingMemorySuggestions,
  suggestMemoryAdoption,
} from "../memory/adoption-service.js";
import type { AgentMessage, AgentSession } from "./types.js";

export type CompactDistillResult = {
  suggestionIds: string[];
  /** @deprecated Always false — distill no longer writes session-summary.md before adopt. */
  sessionSummaryAppended: boolean;
  preferenceSnippetCount: number;
};

const PREFERENCE_HINT =
  /(?:请以后|以后请|偏好|习惯|不要|务必|一律|默认|风格|用词|格式|称呼|语气|务必记住|记住：)/;

function collectDialogueSnippets(messages: AgentMessage[], maxChars: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      continue;
    }
    const text = (msg.content ?? "").trim();
    if (!text) {
      continue;
    }
    const line = `${msg.role === "user" ? "律师" : "助手"}：${text.slice(0, 800)}`;
    if (used + line.length > maxChars) {
      break;
    }
    parts.push(line);
    used += line.length + 1;
  }
  return parts.join("\n");
}

function extractPreferenceLines(messages: AgentMessage[], limit: number): string[] {
  const out: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") {
      continue;
    }
    const text = (msg.content ?? "").trim();
    if (!text || text.length < 8) {
      continue;
    }
    if (!PREFERENCE_HINT.test(text) && text.length > 280) {
      continue;
    }
    if (PREFERENCE_HINT.test(text) || text.length <= 160) {
      const line = text.replace(/\s+/g, " ").slice(0, 240);
      if (line && !out.includes(line)) {
        out.push(line);
      }
    }
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/**
 * Create pending adoption suggestions from pre-compact history (call before truncating,
 * or pass the messages that were dropped / the full prior history).
 */
export async function distillCompactIntoMemorySuggestions(opts: {
  workspaceDir: string;
  auditDir: string;
  session: AgentSession;
  /** Messages considered for distillation (typically pre-compact history). */
  sourceMessages: AgentMessage[];
}): Promise<CompactDistillResult> {
  const { workspaceDir, auditDir, session, sourceMessages } = opts;
  const suggestionIds: string[] = [];
  const preferenceLines = extractPreferenceLines(sourceMessages, 3);

  const allSuggestions = await listMemorySuggestions(workspaceDir);
  const existingLawyerPending = await listPendingMemorySuggestions(workspaceDir, {
    scope: "lawyer",
  });
  const existingLawyerPayloads = new Set(existingLawyerPending.map((r) => r.payload.trim()));

  for (const line of preferenceLines) {
    const payload = `对话压缩沉淀：${line}`;
    if (existingLawyerPayloads.has(payload)) {
      continue;
    }
    if (
      isRecentDuplicateAdoption(allSuggestions, line, {
        scope: "lawyer",
        kind: "lawyer.profile_learning",
      }) ||
      isRecentDuplicateAdoption(allSuggestions, payload, {
        scope: "lawyer",
        kind: "lawyer.profile_learning",
      })
    ) {
      continue;
    }
    const rec = await suggestMemoryAdoption(
      workspaceDir,
      auditDir,
      {
        scope: "lawyer",
        kind: "lawyer.profile_learning",
        payload,
        targetId: session.actorId || "lawyer",
        sourceTaskId: session.sessionId,
        origin: "agent",
        note: "由「整理上下文 / 沉淀学习」从对话中提取，待律师在记忆检查中采纳。",
      },
      { autoAdopt: false },
    );
    existingLawyerPayloads.add(payload);
    allSuggestions.push(rec);
    suggestionIds.push(rec.id);
  }

  const matterId = session.matterId?.trim();
  if (matterId) {
    const snippet = collectDialogueSnippets(sourceMessages, 2_500);
    if (snippet.trim().length >= 40) {
      const chunk = `### 对话压缩沉淀（${new Date().toISOString().slice(0, 10)}）\n\n${snippet.slice(0, 2_000)}`;
      const payload = chunk.slice(0, 1_500);
      if (
        !isRecentDuplicateAdoption(allSuggestions, payload, {
          scope: "matter",
          kind: "case.progress",
        })
      ) {
        const rec = await suggestMemoryAdoption(
          workspaceDir,
          auditDir,
          {
            scope: "matter",
            kind: "case.progress",
            payload,
            targetId: matterId,
            sourceTaskId: session.sessionId,
            origin: "agent",
            note: "由「整理上下文 / 沉淀学习」提取的案件摘要草稿，待律师在记忆检查中采纳后再写入。",
          },
          { autoAdopt: false },
        );
        suggestionIds.push(rec.id);
      }
    }
  }

  return {
    suggestionIds,
    sessionSummaryAppended: false,
    preferenceSnippetCount: preferenceLines.length,
  };
}
