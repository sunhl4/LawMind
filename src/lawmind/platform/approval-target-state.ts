/**
 * 审批卡「当前值」：目标文件现在是什么样。
 *
 * 之前这一栏恒为「拟新执行，无既有对照值」——律师看不出这次是新建还是覆盖，
 * 也看不出要覆盖的那份文件有多新。本模块只读文件元信息，不改任何东西。
 *
 * 放在独立文件而不是 `requires-action.ts` 里，是因为后者被 renderer 以值的方式
 * 引用（`toolDisplayNameZh`），不能把 `node:fs` 拖进浏览器包。
 */

import fs from "node:fs";
import path from "node:path";
import { fenceAgentFilePath } from "../runtime/workspace-io-fence.js";

const PATH_ARG_KEYS = [
  "path",
  "file_path",
  "rel_path",
  "output_path",
  "target_path",
  "source_path",
  "baseline_path",
] as const;

function pickPathArg(toolArgs: Record<string, unknown>): string | undefined {
  for (const key of PATH_ARG_KEYS) {
    const value = toolArgs[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 返回律师可读的一句现状；读不到就返回 undefined（卡片沿用「拟新执行」）。
 * 只描述元信息，不读正文：审批卡不需要把整篇稿子铺开。
 */
export function describeApprovalTargetState(opts: {
  workspaceDir: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  /** 注入时钟，便于测试。 */
  now?: Date;
}): string | undefined {
  const rel = pickPathArg(opts.toolArgs);
  if (!rel) {
    return undefined;
  }
  const root = path.resolve(opts.workspaceDir);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
    // 工作区外（例如本机挂载）：只说明范围，不假装知道内容。
    return `${path.basename(rel)}：工作区外的文件，本次按授权范围访问。`;
  }
  const fenced = fenceAgentFilePath({ rootDir: root, abs });
  if (!fenced.ok) {
    return undefined;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fenced.abs);
  } catch {
    return `${path.basename(rel)}：尚不存在，本次会新建。`;
  }
  if (!stat.isFile()) {
    return `${path.basename(rel)}：已存在（目录），本次会改动其内容。`;
  }
  const now = opts.now ?? new Date();
  const ageMinutes = Math.max(0, Math.round((now.getTime() - stat.mtimeMs) / 60_000));
  const age =
    ageMinutes < 1
      ? "刚刚"
      : ageMinutes < 60
        ? `${ageMinutes} 分钟前`
        : ageMinutes < 60 * 24
          ? `${Math.round(ageMinutes / 60)} 小时前`
          : `${Math.round(ageMinutes / (60 * 24))} 天前`;
  return `${path.basename(rel)}：已存在，${formatBytes(stat.size)}，${age}修改过。本次会覆盖它。`;
}
