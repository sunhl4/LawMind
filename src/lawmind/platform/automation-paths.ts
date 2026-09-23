/**
 * 常设工作（自动办件）的落盘路径与 id 安全校验。
 *
 * 单独成模块的原因：`lawyer-automations.ts`（定义）与 `automation-run-history.ts`
 * （运行历史）都需要这些路径，而两者互相 import 会形成环。路径是叶子依赖，
 * 放在这里让两边都只向下依赖。
 */

import path from "node:path";

export const AUTOMATIONS_SUBDIR = "automations";
export const AUTOMATION_INBOX_SUBDIR = "automation-inbox";
export const AUTOMATION_RUNS_SUBDIR = "runs";

export function automationsDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", AUTOMATIONS_SUBDIR);
}

export function automationInboxDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", AUTOMATION_INBOX_SUBDIR);
}

/**
 * 自动办件 id 会拼进路径；先挡住穿越，避免运行历史写入逃出工作区。
 */
export function assertSafeAutomationId(id: string): string {
  const trimmed = id.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(trimmed)) {
    throw new Error(`unsafe_automation_id:${trimmed.slice(0, 32)}`);
  }
  return trimmed;
}

/** 单个自动办件的运行历史目录。 */
export function automationRunsDir(workspaceDir: string, automationId: string): string {
  return path.join(
    automationsDir(workspaceDir),
    assertSafeAutomationId(automationId),
    AUTOMATION_RUNS_SUBDIR,
  );
}
