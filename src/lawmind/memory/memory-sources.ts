/**
 * 本轮「记忆层」可视化：哪些 Markdown 真相源已加载、是否进入 Agent system prompt。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { assistantProfilePath } from "../assistants/profile-md.js";
import { resolveLawMindRoot } from "../assistants/store.js";

async function readLen(filePath: string): Promise<{ exists: boolean; charCount: number }> {
  try {
    const s = await fs.stat(filePath);
    if (!s.isFile()) {
      return { exists: false, charCount: 0 };
    }
    const buf = await fs.readFile(filePath, "utf8");
    return { exists: true, charCount: buf.length };
  } catch {
    return { exists: false, charCount: 0 };
  }
}

function dailyLogRel(workspaceDir: string, d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join("memory", `${yyyy}-${mm}-${dd}.md`);
}

export type MemorySourceLayer = {
  /** 稳定 ID，供 UI */
  id: string;
  /** 展示名 */
  label: string;
  /** 相对 workspace 根的路径 */
  relativePath: string;
  exists: boolean;
  charCount: number;
  /** 是否进入当前 Agent 主对话 system prompt（与架构文档一致：MEMORY 等为检索侧） */
  inAgentSystemPrompt: boolean;
  /** 补充说明 */
  hint?: string;
};

export type BuildMemorySourceReportOpts = {
  matterId?: string;
  /** 当前助手，用于 assistants/<id>/PROFILE.md */
  assistantId?: string;
  /** 默认从 workspace 解析 LawMind 根目录 */
  lawMindRoot?: string;
};

/**
 * 构建与 Agent `runTurn` / 引擎 `loadMemoryContext` 对齐的记忆来源清单。
 */
export async function buildAgentMemorySourceReport(
  workspaceDir: string,
  opts: BuildMemorySourceReportOpts = {},
): Promise<MemorySourceLayer[]> {
  const matterId = opts.matterId?.trim();
  const assistantId = opts.assistantId?.trim();
  let lawMindRoot = opts.lawMindRoot?.trim();
  if (!lawMindRoot) {
    try {
      lawMindRoot = resolveLawMindRoot(workspaceDir);
    } catch {
      lawMindRoot = undefined;
    }
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const relToday = dailyLogRel(workspaceDir, today);
  const relYesterday = dailyLogRel(workspaceDir, yesterday);

  const base: Array<Omit<MemorySourceLayer, "exists" | "charCount"> & { abs: string }> = [
    {
      id: "memory_md",
      label: "通用长期记忆",
      relativePath: "MEMORY.md",
      abs: path.join(workspaceDir, "MEMORY.md"),
      inAgentSystemPrompt: false,
      hint: "供检索管线与 search_workspace；默认不整段拼入 Agent system prompt",
    },
    {
      id: "lawyer_profile",
      label: "律师档案",
      relativePath: "LAWYER_PROFILE.md",
      abs: path.join(workspaceDir, "LAWYER_PROFILE.md"),
      inAgentSystemPrompt: true,
    },
    {
      id: "firm_profile",
      label: "律所级规则",
      relativePath: "FIRM_PROFILE.md",
      abs: path.join(workspaceDir, "FIRM_PROFILE.md"),
      inAgentSystemPrompt: false,
      hint: "引擎与检索使用；当前 Agent prompt 未整段注入",
    },
    {
      id: "clause_playbook",
      label: "条款 Playbook",
      relativePath: path.join("playbooks", "CLAUSE_PLAYBOOK.md"),
      abs: path.join(workspaceDir, "playbooks", "CLAUSE_PLAYBOOK.md"),
      inAgentSystemPrompt: false,
      hint: "审核学习等写回；Agent prompt 未整段注入",
    },
    {
      id: "court_opponent",
      label: "法院与对方画像",
      relativePath: path.join("playbooks", "COURT_AND_OPPONENT_PROFILE.md"),
      abs: path.join(workspaceDir, "playbooks", "COURT_AND_OPPONENT_PROFILE.md"),
      inAgentSystemPrompt: false,
    },
    {
      id: "today_log",
      label: "今日工作日志",
      relativePath: relToday,
      abs: path.join(workspaceDir, relToday),
      inAgentSystemPrompt: true,
    },
    {
      id: "yesterday_log",
      label: "昨日工作日志",
      relativePath: relYesterday,
      abs: path.join(workspaceDir, relYesterday),
      inAgentSystemPrompt: false,
      hint: "引擎 loadMemoryContext 会加载；当前 Agent prompt 未注入",
    },
  ];

  if (matterId) {
    base.push(
      {
        id: "case_md",
        label: "案件档案 CASE",
        relativePath: path.join("cases", matterId, "CASE.md"),
        abs: path.join(workspaceDir, "cases", matterId, "CASE.md"),
        inAgentSystemPrompt: true,
        hint: "作为「当前案件」上下文进入 system prompt",
      },
      {
        id: "matter_strategy",
        label: "案件策略 MATTER_STRATEGY",
        relativePath: path.join("cases", matterId, "MATTER_STRATEGY.md"),
        abs: path.join(workspaceDir, "cases", matterId, "MATTER_STRATEGY.md"),
        inAgentSystemPrompt: false,
        hint: "引擎加载；推理快照可写回；Agent prompt 未整段注入",
      },
    );
  }

  if (assistantId && lawMindRoot) {
    const ap = assistantProfilePath(lawMindRoot, assistantId);
    base.push({
      id: "assistant_profile",
      label: "本助手档案",
      relativePath:
        path.relative(workspaceDir, ap).split(path.sep).join("/") ||
        `assistants/${assistantId}/PROFILE.md`,
      abs: ap,
      inAgentSystemPrompt: true,
      hint: "LawMind 根目录下 assistants/<id>/PROFILE.md",
    });
  }

  const out: MemorySourceLayer[] = [];
  for (const row of base) {
    const { exists, charCount } = await readLen(row.abs);
    out.push({
      id: row.id,
      label: row.label,
      relativePath: row.relativePath.split(path.sep).join("/"),
      exists,
      charCount,
      inAgentSystemPrompt: row.inAgentSystemPrompt,
      hint: row.hint,
    });
  }
  return out;
}
