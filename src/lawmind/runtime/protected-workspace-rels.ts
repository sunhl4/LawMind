/**
 * 治理/证据面写保护——与 analysis-script-path、research-write-bypass-gate 并列的第三道写门禁。
 *
 * 工作区内这些路径只能由专用服务（zod 校验）或服务器专用路由写入；agent 的
 * write_document、桌面 /api/fs/write、Electron fs:write 一律拒绝。否则模型一次
 * 写调用即可改写策略、MCP 配置、审计链、会话/任务真相源或案件 RULES.md
 * （RULES.md 会被注入系统提示词），治理体系名存实亡。
 *
 * 注意：apps/lawmind-desktop/electron/fs-bridge.mjs 持有一份纯 JS 镜像，
 * 修改本文件清单时必须同步修改该镜像。
 */

const EXACT_PROTECTED_RELS = new Set(["lawmind.policy.json", ".env", ".env.lawmind"]);

const PROTECTED_REL_PREFIXES = ["lawmind/", "audit/", "sessions/", "tasks/", "matters/"];

/** 任意深度下的同名文件（如 cases/<matterId>/.lawmind-dms.json 存 DMS 连接配置）。 */
const PROTECTED_BASENAMES = new Set([".lawmind-dms.json"]);

export function isProtectedWorkspaceRel(rel: string): boolean {
  const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (EXACT_PROTECTED_RELS.has(norm)) {
    return true;
  }
  if (PROTECTED_REL_PREFIXES.some((prefix) => norm.startsWith(prefix))) {
    return true;
  }
  const base = norm.split("/").pop() ?? norm;
  return PROTECTED_BASENAMES.has(base);
}

export const PROTECTED_WORKSPACE_WRITE_REFUSAL =
  "该路径属于 LawMind 治理/审计数据（策略、MCP 配置、审计、会话、任务、案件真相源），不能通过写文书或文件接口修改；请使用对应的设置入口。";
