/**
 * 跨助手检索：对话命中之外，再看办件与常设工作运行记录，按助手分组。
 *
 * 复用现有对话检索，不另造一套索引。常设工作没有助手归属时放在「未归属」，
 * 不把办件硬安到某个助手头上。
 */

import { searchConversations } from "../agent/conversation-search.js";
import { listSessions } from "../agent/session.js";
import { listAutomationRuns } from "../platform/automation-run-history.js";
import { listAutomations } from "../platform/lawyer-automations.js";
import { listLawyerWorks } from "../work/store.js";

export type RosterSearchKind = "conversation" | "work" | "routine";

export type RosterSearchHit = {
  kind: RosterSearchKind;
  title: string;
  snippet: string;
  ref: string;
};

export type RosterSearchGroup = {
  assistantId: string | null;
  label: string;
  hits: RosterSearchHit[];
};

const MAX_GROUPS = 12;
const MAX_HITS_PER_GROUP = 6;

function includesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return false;
  }
  return text.toLowerCase().includes(q);
}

function pushHit(
  groups: Map<string, RosterSearchGroup>,
  assistantId: string | null,
  label: string,
  hit: RosterSearchHit,
): void {
  const key = assistantId ?? "";
  const group = groups.get(key) ?? { assistantId, label, hits: [] };
  if (group.hits.length < MAX_HITS_PER_GROUP) {
    group.hits.push(hit);
  }
  groups.set(key, group);
}

export function searchAssistantRoster(
  workspaceDir: string,
  query: string,
  assistantNames: ReadonlyMap<string, string> = new Map(),
): RosterSearchGroup[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const groups = new Map<string, RosterSearchGroup>();
  const sessionAssistant = new Map<string, string>();
  try {
    for (const session of listSessions(workspaceDir)) {
      if (session.sessionId && session.assistantId) {
        sessionAssistant.set(session.sessionId, session.assistantId);
      }
    }
  } catch {
    /* 会话目录读失败时仍返回办件与常设工作 */
  }

  try {
    const conversations = searchConversations(workspaceDir, { query: q, limit: 8 });
    for (const hit of conversations.hits) {
      const assistantId = hit.assistantId ?? null;
      pushHit(
        groups,
        assistantId,
        assistantNames.get(assistantId ?? "") ?? assistantId ?? "未归属",
        {
          kind: "conversation",
          title: hit.title,
          snippet: hit.snippets[0]?.text ?? "",
          ref: hit.sessionId,
        },
      );
    }
  } catch {
    /* 对话检索失败不挡住另外两类 */
  }

  try {
    for (const work of listLawyerWorks(workspaceDir)) {
      const blob = `${work.title}\n${work.goal}`;
      if (!includesQuery(blob, q)) {
        continue;
      }
      const assistantId = work.sessionId ? (sessionAssistant.get(work.sessionId) ?? null) : null;
      pushHit(
        groups,
        assistantId,
        assistantNames.get(assistantId ?? "") ?? assistantId ?? "未归属",
        {
          kind: "work",
          title: work.title,
          snippet: work.goal.slice(0, 180),
          ref: work.workId,
        },
      );
    }
  } catch {
    /* 办件目录缺失时跳过 */
  }

  try {
    for (const automation of listAutomations(workspaceDir)) {
      const runs = listAutomationRuns(workspaceDir, automation.id);
      const blob = [
        automation.title,
        automation.lastResultSummary,
        ...runs.map((run) => run.summary ?? ""),
      ]
        .filter(Boolean)
        .join("\n");
      if (!includesQuery(blob, q)) {
        continue;
      }
      const snippet = (automation.lastResultSummary ?? runs[0]?.summary ?? automation.title).slice(
        0,
        180,
      );
      const assistantId = automation.assistantId?.trim() || null;
      pushHit(
        groups,
        assistantId,
        assistantNames.get(assistantId ?? "") ?? assistantId ?? "未归属",
        {
          kind: "routine",
          title: automation.title,
          snippet,
          ref: automation.id,
        },
      );
    }
  } catch {
    /* 常设工作目录缺失时跳过 */
  }

  return [...groups.values()].slice(0, MAX_GROUPS);
}
