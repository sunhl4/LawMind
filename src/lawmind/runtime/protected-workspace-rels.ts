/**
 * 治理/证据面写保护——与 analysis-script-path、research-write-bypass-gate 并列的第三道写门禁。
 *
 * 工作区内这些路径只能由专用服务（zod 校验）或服务器专用路由写入；agent 的
 * write_document、桌面 /api/fs/write、Electron fs:write 一律拒绝。否则模型一次
 * 写调用即可改写策略、MCP 配置、审计链、会话/任务真相源或案件 RULES.md
 * （`matters/`、`drafts/` 前缀与任意深度 `RULES.md` 均受保护；RULES 会被注入系统提示词），治理体系名存实亡。
 * 草稿目录只经 `commitDraft` 写入，不走通用文件接口。
 *
 * 注意：apps/lawmind-desktop/electron/fs-bridge.mjs 持有一份纯 JS 镜像，
 * 修改本文件清单时必须同步修改该镜像。
 */

const EXACT_PROTECTED_RELS = new Set(["lawmind.policy.json"]);

const PROTECTED_REL_PREFIXES = [
  "lawmind/",
  "audit/",
  "sessions/",
  "tasks/",
  "matters/",
  // 草稿账本只经 commitDraft / persistDraft。通用写文件、文件页和脚本沙箱不能改 drafts/。
  "drafts/",
  // 钩子脚本一旦可写，下次提交就会执行。模型没有理由改 git 元数据。
  ".git/",
];

/** 任意深度下的同名文件（如 cases/<matterId>/.lawmind-dms.json、cases/<id>/RULES.md）。 */
const PROTECTED_BASENAMES = new Set([
  ".lawmind-dms.json",
  "RULES.md",
  "ethics-wall.json",
  ".signing-secret",
]);

/**
 * `.env` 家族（`.env`、`.env.lawmind`、`.env.local`、`.env.production` …）一律是密钥文件。
 *
 * 用前缀而不是枚举：枚举必然漏——此前只精确保护 `.env` / `.env.lawmind`，
 * 而「把 key 丢进 `.env.local`」是 Node 生态最顺手的习惯，那份文件当时是**可写**的。
 *
 * 任意深度：密钥文件不该因为被放进子目录就变得可写（与 `PROTECTED_BASENAMES` 同口径）。
 */
function isEnvSecretBasename(baseFold: string): boolean {
  return baseFold === ".env" || baseFold.startsWith(".env.");
}

function normalizeWorkspaceRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function isProtectedWorkspaceRel(rel: string): boolean {
  const norm = normalizeWorkspaceRel(rel);
  const folded = norm.toLowerCase();
  if (EXACT_PROTECTED_RELS.has(norm) || EXACT_PROTECTED_RELS.has(folded)) {
    return true;
  }
  if (
    PROTECTED_REL_PREFIXES.some(
      (prefix) => norm.startsWith(prefix) || folded.startsWith(prefix.toLowerCase()),
    )
  ) {
    return true;
  }
  const base = norm.split("/").pop() ?? norm;
  const baseFold = folded.split("/").pop() ?? folded;
  if (isEnvSecretBasename(baseFold)) {
    return true;
  }
  for (const name of PROTECTED_BASENAMES) {
    if (base === name || baseFold === name.toLowerCase()) {
      return true;
    }
  }
  return false;
}

export const PROTECTED_WORKSPACE_WRITE_REFUSAL =
  "该路径属于 LawMind 治理/审计数据（策略、MCP 配置、审计、会话、任务、案件真相源），不能通过写文书或文件接口修改；请使用对应的设置入口。";

/** 机器可读的拒写原因，与 fs-bridge.mjs 的同名常量一致。 */
export const PROTECTED_WORKSPACE_WRITE_CODE = "protected_workspace_path";
