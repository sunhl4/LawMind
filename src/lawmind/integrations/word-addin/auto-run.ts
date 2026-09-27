/**
 * Word 插件「审这份」→ 桌面端自动跑（纯决策层，无 fs / 无引擎依赖）。
 *
 * 这里只回答三个问题，好让上层（本地服务 tick）做 I/O：
 * 1. 这份本机文件属于哪个案卷？对不唯一就如实回 `no_match`，不猜。
 * 2. 固定跑哪条流水线？（与邮件短路径同一套门禁：最短锚点 + craft_check + xmlQa，
 *    但硬禁外发工具——Word 就地改稿不是发信场景。）
 * 3. 授权留痕怎么写？
 *
 * 为什么可以自动跑：本仓库真正会打断律师的只有 `send_email`
 * （`src/lawmind/agent/dangerous-tool-policy.ts` → `toolRequiresLawyerPause`），
 * `apply_surgical_edits` / `render_tracked_draft` 本就不需要二次点击。
 * 所以「回桌面端点一次」不是审批，是多余手势；Word 里那次点击即授权动作。
 */

import path from "node:path";
import type { CollaborationWorkflow } from "../../agent/orchestrator/types.js";
import type { WordAddinReviewRequest, WordAddinRunAuthorization } from "./review-requests.js";

/** Word 就地改稿的固定步骤 id（与邮件短路径同名，便于在任务板上一眼认出）。 */
export const WORD_ADDIN_REDLINE_STEP_ID = "redline";
export const WORD_ADDIN_ASSIGNEE = "contract_review";
export const WORD_ADDIN_CREATED_BY = "word_addin";

/**
 * 模板级预批准白名单：只放「待拍板」类改稿/导出工具。
 * 刻意**不含** `prepare_outbound_mail`：Word 就地改稿不准备外发。
 */
export const WORD_ADDIN_PREAPPROVE_TOOL_NAMES: ReadonlyArray<string> = [
  "apply_surgical_edits",
  "render_tracked_draft",
];

/** 每个案卷最多回给 Word 窗格多少个候选（律师只会在少数案卷里选）。 */
export const WORD_ADDIN_MATTER_CANDIDATE_LIMIT = 40;

export type WordAddinMatterResolution =
  | { ok: true; matterId: string; source: "requested" | "path" }
  /**
   * 对不到案卷：**照样跑**（ad-hoc），只是不挂案卷。
   * 律师的诉求是「任何文件夹的文件打开就能操作」，所以这里不是错误分支——
   * 改稿链（analyze/draft/apply_surgical_edits/render_tracked_draft）不需要案卷；
   * 明确要求案卷的工具（`MATTER_SCOPE_REQUIRED`：search_matter / add_case_note / 邮件 / desk 写）
   * 都不在这条链上。产物仍写在源文件同目录。
   */
  | { ok: true; matterId: undefined; source: "adhoc"; candidates: string[] };

/**
 * 把本机文件路径对到案卷。三条规则，全部可解释：
 * 1. 插件已带 `matterId` 且该案卷存在 → 用它（律师在窗格里选过）；
 * 2. 文件落在 `cases/<matterId>/` 或 `matters/<matterId>/` 里 → 用那个案卷；
 * 3. 其余 → **ad-hoc 直跑，不猜案卷也不拦人**（候选仅用于窗格里「可选记到案卷」）。
 */
export function resolveWordAddinMatterForSource(params: {
  workspaceDir: string;
  sourceAbs: string;
  matterIds: ReadonlyArray<string>;
  requestedMatterId?: string;
}): WordAddinMatterResolution {
  const known = new Set(params.matterIds.filter((id) => id.trim()));
  const requested = params.requestedMatterId?.trim();
  if (requested && known.has(requested)) {
    return { ok: true, matterId: requested, source: "requested" };
  }
  const fromPath = matterIdFromWorkspacePath(params.workspaceDir, params.sourceAbs);
  if (fromPath && known.has(fromPath)) {
    return { ok: true, matterId: fromPath, source: "path" };
  }
  return {
    ok: true,
    matterId: undefined,
    source: "adhoc",
    candidates: [...known].toSorted().slice(0, WORD_ADDIN_MATTER_CANDIDATE_LIMIT),
  };
}

/**
 * 案卷在 workspace 里的两个目录都可能装 Word 原件：
 * - `cases/<matterId>/`：律师面案卷夹（材料、交付物、mail 附件）；
 * - `matters/<matterId>/`：存储面案卷目录。
 * 命中哪个都算，命中不了就返回 undefined（由调用方决定是否回 Word 让律师选）。
 */
export function matterIdFromWorkspacePath(workspaceDir: string, abs: string): string | undefined {
  const root = path.resolve(workspaceDir);
  const target = path.resolve(abs);
  for (const sub of ["cases", "matters"] as const) {
    const rel = path.relative(path.join(root, sub), target);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      continue;
    }
    const segment = rel.split(path.sep)[0]?.trim();
    if (segment) {
      return segment;
    }
  }
  return undefined;
}

/**
 * 只有**工作区之外**的文件才需要「本机目录授权」。
 *
 * 工作区内的文件（`cases/<id>/…`）本来就落在工作区根下，读写都不需要额外授权。
 * 反过来，若给它们也挂上一个 `projectDir`，本轮会多出一个本机挂载、
 * 并把「本机文件台账」打开（触发 per-tool 读取配额），与普通回合的行为不一致——
 * 那就变成「同一个文件，从 Word 发起和从桌面发起读到的不一样」。
 */
export function needsHostDirGrant(workspaceDir: string, sourceAbs: string): boolean {
  const rel = path.relative(path.resolve(workspaceDir), path.resolve(sourceAbs));
  return rel.startsWith("..") || path.isAbsolute(rel);
}

/**
 * Word 就地改稿的首轮指令。
 *
 * 三个必须点：
 * - 开头 `【Word 改稿】` → 引擎进 Word 改稿锁（硬禁 `render_document` 重建原件与外发）；
 * - `contract_edit_baseline_path` 用**绝对路径**（源文件可能在工作区外，靠本次运行的
 *   本机目录授权解析），并禁止模型再翻案卷找同一份文件；
 * - 显式要求「最短锚点 + 逐处依据」，与邮件短路径同一口径。
 */
export function buildWordAddinRedlineInstruction(params: {
  sourceAbs: string;
  /** 缺省 = ad-hoc 改稿（未挂案卷），指令里就不写 matterId，避免模型引用不存在的案卷。 */
  matterId?: string;
  instruction: string;
  /** 窗格上那句「正在用」的名字，写进指令，避免模型另猜立场。 */
  standardName?: string;
}): string {
  const baseline = params.sourceAbs.trim();
  const ask = params.instruction.trim() || "按本所标准审这份";
  const matterId = params.matterId?.trim();
  const standardName = params.standardName?.trim();
  return [
    "【Word 改稿】",
    ...(matterId ? [`matterId=\`${matterId}\``] : []),
    `默认 contract_edit_baseline_path=\`${baseline}\``,
    "",
    "## 审查要求",
    ask,
    ...(standardName ? [`本所标准：${standardName}`] : []),
    "",
    "## 执行约束（Word 就地改稿）",
    "- 基线就是上面这个本机文件（绝对路径已给）。不要再翻案卷或检索同名文件；核法条可用 `search_statute` / `search_case_law`。",
    "- 通读原文与批注/对方修订后再改；不要反复读同一文件。",
    // 无人值守的关键：一旦模型反问「审查重点/己方立场」，澄清门禁会把这一步停住，
    // 渲染就不会发生 → 律师在 Word 里只会看到一个没有结果的请求。邮件短路径同样明确禁止反问。
    standardName
      ? "- 路径、要求、基线与本所标准都已给出：不要再问「审查重点」「要不要改」。立场按本所标准，未覆盖处写进 note。"
      : "- 路径、要求与基线都已给出：不要再问「审查重点」「己方立场」「要不要改」这类问题；按合同文本本身的风险点直接出稿，立场未指明处按中性口径处理并在 note 里写明取值假设。",
    "- **最小修改（硬约束·条数不限）**：用 `apply_surgical_edits` 落改（附 `craft_check`），只标真正变动的字；一句话里改几个字就只改那几个字。",
    "- 整句/整段/整节删除重写会被硬门禁跳过；这些争点写进 deferred，不要硬塞。",
    "- 推荐路径：`analyze_document` → `draft_document`/`update_draft`（`contract_edit_baseline_path` + `seed_sections_from_baseline=true`）→ `apply_surgical_edits` → `render_tracked_draft` 写入源文件同目录（原名_日期_01.docx，不打开 Word）。",
    "- `redlinePending=0` 不得 `render_tracked_draft`。",
    "- 禁止 `render_document` 重建原件，禁止 `prepare_outbound_mail` / `send_email`——Word 这边只做就地改稿，外发另走桌面流程。",
  ].join("\n");
}

/**
 * 固定流水线：单步、自动过审、只预批准改稿/导出工具。
 * 刻意复刻邮件短路径的 `apply_surgical_edits` → `render_tracked_draft` 口径，
 * 而不是自由 chat turn——按钮点击要可复现、可回归。
 */
export function buildWordAddinRedlineWorkflow(params: {
  workflowId: string;
  /** 缺省 = ad-hoc（不挂案卷）。 */
  matterId?: string;
  instruction: string;
  at?: Date;
}): CollaborationWorkflow {
  const at = (params.at ?? new Date()).toISOString();
  const matterId = params.matterId?.trim();
  return {
    workflowId: params.workflowId,
    name: "Word 就地审查改稿",
    description: "Word 插件「审这份」就地改稿：最短锚点修订轨写回源文件同目录；不外发。",
    ...(matterId ? { matterId } : {}),
    steps: [
      {
        stepId: WORD_ADDIN_REDLINE_STEP_ID,
        assignee: WORD_ADDIN_ASSIGNEE,
        assigneeRoleId: WORD_ADDIN_ASSIGNEE,
        task: params.instruction,
        dependsOn: [],
        // 无互审步骤；工具放行靠 preApproveToolNames（白名单在 executor 再过滤一次）。
        autoApprove: true,
        status: "pending",
      },
    ],
    status: "draft",
    createdBy: WORD_ADDIN_CREATED_BY,
    createdAt: at,
    updatedAt: at,
    preApproveToolNames: [...WORD_ADDIN_PREAPPROVE_TOOL_NAMES],
  };
}

/**
 * 本次运行的授权留痕（写进请求文件，与审计同级可见）。
 *
 * `grantedDir` 由调用方决定（见 `needsHostDirGrant`）：工作区内文件不需要额外授权，
 * 传 `""` 表示「这次没有授予任何本机目录」。
 */
export function buildWordAddinRunAuthorization(params: {
  request: WordAddinReviewRequest;
  actorId: string;
  /** 来源客户端（本机 API 已认证身份）。留空时回落到请求上登记的那一个。 */
  clientId?: string;
  /** 缺省 = ad-hoc（未挂案卷）。 */
  matterId?: string;
  sourceHash: string;
  grantedDir: string;
  at?: Date;
}): WordAddinRunAuthorization {
  const matterId = params.matterId?.trim() ?? "";
  const clientId = params.clientId?.trim() || params.request.clientId?.trim() || "unknown";
  return {
    at: (params.at ?? new Date()).toISOString(),
    actorId: params.actorId,
    clientId,
    sourcePath: params.request.sourcePath,
    sourceHash: params.sourceHash,
    grantedDir: params.grantedDir,
    matterId,
    instruction: params.request.instruction,
  };
}
