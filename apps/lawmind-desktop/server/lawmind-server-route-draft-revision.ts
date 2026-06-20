/**
 * POST /api/drafts/:taskId/revision-job — 审核台「提交给助手」后台修订（与 handleReviewRoute 解耦，便于 dispatch 显式挂载）。
 */

import path from "node:path";
import { createLawMindAgent } from "../../../src/lawmind/agent/index.js";
import { finishLiveTurnProgress } from "../../../src/lawmind/agent/live-turn-progress.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import { emit } from "../../../src/lawmind/audit/index.js";
import {
  buildRoleDirectiveFromProfile,
  bumpAssistantStats,
  DEFAULT_ASSISTANT_ID,
  getAssistantById,
  loadAssistantProfiles,
  resolveLawMindRoot,
} from "../../../src/lawmind/assistants/store.js";
import { readDraft } from "../../../src/lawmind/drafts/index.js";
import {
  buildRevisionRetryInstruction,
  draftRevisionWasPersisted,
  snapshotDraftRevisionBaseline,
} from "../../../src/lawmind/drafts/revision-persisted.js";
import type { ArtifactDraft } from "../../../src/lawmind/types.js";
import { parseJsonBodyZod } from "./lawmind-api-parse.js";
import { draftRevisionJobPostSchema } from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isWebSearchForcedOffByPolicy } from "./lawmind-policy.js";
import {
  buildAgentConfig,
  getLawMindEngine,
  resolveDesktopActorId,
  safeOptionalProjectDir,
  sendJson,
} from "./lawmind-server-helpers.js";
import { isSafeAssistantIdSegment } from "./safe-assistant-id.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";

const REVISION_INSTRUCTION_MAX = 48_000;

function buildRevisionDispatchInstruction(draft: ArtifactDraft, supplementary: string): string {
  const notes = (draft.reviewNotes ?? []).filter((n) => typeof n === "string" && n.trim());
  const notesBlock =
    notes.length > 0
      ? notes.map((n, i) => `${i + 1}. ${n.trim()}`).join("\n")
      : "（签批阶段未留下文字备注；请以本节「补充说明」为准。）";
  const extra = supplementary.trim();
  const extraBlock = extra.length > 0 ? extra : "（律师未再写补充说明，请结合上文审核备注与草稿现状修订。）";
  const matterLine = draft.matterId?.trim()
    ? `- 关联案件 matterId：\`${draft.matterId.trim()}\`\n`
    : "";
  const core = `【审核台 · 后台修订请求】

律师已通过审核台将本草稿标为「需修改」，并请求你在**后台**根据下列意见修订交付草稿（任务 / 草稿 ID 与 taskId 一致）。

- 草稿 taskId：\`${draft.taskId}\`
- 标题：${draft.title}
${matterLine}- 输出形态：${draft.output ?? "（未声明）"}
- 已记入草稿的审核备注（按时间顺序）：
${notesBlock}

- 律师本次在审核台填写的**补充说明**（发给助手）：
${extraBlock}

**必须落盘，禁止只改聊天文字：** 律师已在审核台点击「提交给助手」，等同于已授权你写回工作区。你必须用工具把批注落实进 **同一条** 草稿（taskId \`${draft.taskId}\`），不能只写自然语言说明。

**推荐步骤（缺一不可）：**
1. 用 \`analyze_document\` 或 \`search_workspace\` 读取当前 \`drafts/${draft.taskId}.json\`，弄清现有结构（尤其 \`sections\`、\`summary\`）。
2. 根据「审核备注 + 补充说明」扩展/修订各章节正文，**保持同一 taskId**。
3. **优先**调用 \`update_draft\`：\`task_id\` 填 \`${draft.taskId}\`，传入更新后的 \`sections\`（每项含 heading、body，保留原有 citations 若仍适用）及必要的 \`summary\` / \`title\`。本条为审核台后台修订通道，**无需** \`__approved\`。
4. 若你更熟悉整文件写回，也可用 \`write_document\`，**必须**同时提供 \`file_path\` = \`drafts/${draft.taskId}.json\` 与完整合法 JSON \`content\`（不可省略 file_path）。
5. **禁止**调用 \`draft_document\` / \`execute_workflow\` 重新生成新草稿——会生成新 taskId，审核台仍打开旧稿，律师会看到「没变化」。

完成后用简短条目列出你改了哪些章节/字段。系统会在你成功写回 \`drafts/${draft.taskId}.json\` 后**自动**将草稿恢复为「待审核」，律师无需再手动点「恢复待审核」。`;
  return core.slice(0, REVISION_INSTRUCTION_MAX);
}

export async function handleDraftRevisionJobRoute({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, envFile } = ctx;
  const revisionJobMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/revision-job$/);
  if (!revisionJobMatch || req.method !== "POST") {
    return false;
  }
  const raw = decodeURIComponent(revisionJobMatch[1] ?? "");
  if (!isSafeTaskIdSegment(raw)) {
    sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
    return true;
  }
  const draft = readDraft(workspaceDir, raw);
  if (!draft) {
    sendJson(
      res,
      404,
      {
        ok: false,
        error: "draft_not_found",
        message: "未找到该草稿文件（workspace/drafts/<taskId>.json）。请确认工作区一致后刷新审核台再试。",
      },
      c,
    );
    return true;
  }
  if (draft.reviewStatus !== "modified") {
    sendJson(
      res,
      400,
      {
        ok: false,
        error: "revision_job_requires_modified",
        message: "请先将签批标为「需修改」，再使用「提交给助手（后台执行）」。",
      },
      c,
    );
    return true;
  }
  const body = await parseJsonBodyZod(req, draftRevisionJobPostSchema);
  const supplementary = (body.instruction ?? "").slice(0, 12_000);
  const assistantKey = body.assistantId?.trim() ? body.assistantId.trim() : DEFAULT_ASSISTANT_ID;
  if (!isSafeAssistantIdSegment(assistantKey)) {
    sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
    return true;
  }
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
  let profile = getAssistantById(lawMindRoot, assistantKey) ?? getAssistantById(lawMindRoot, DEFAULT_ASSISTANT_ID);
  if (!profile) {
    const all = loadAssistantProfiles(lawMindRoot);
    profile = all[0];
  }
  if (!profile) {
    sendJson(res, 500, { ok: false, error: "no_assistant_profile" }, c);
    return true;
  }
  const built = buildAgentConfig(workspaceDir, { envFile: ctx.envFile });
  const missingAgentModel =
    !built.config ||
    built.error === "missing_api_key" ||
    built.error === "missing_provider_api_key" ||
    built.error === "missing_platform_api_key";
  if (missingAgentModel) {
    sendJson(
      res,
      503,
      {
        ok: false,
        error: "missing_api_key",
        message: "未配置模型 API，无法向助手派发后台修订任务。",
      },
      c,
    );
    return true;
  }
  const desktopActor = resolveDesktopActorId();
  const role = buildRoleDirectiveFromProfile(profile);
  let allowWebSearch = false;
  if (isWebSearchForcedOffByPolicy()) {
    allowWebSearch = false;
  }
  const config: AgentConfig = {
    ...built.config,
    actorId: `${desktopActor}|asst:${profile.assistantId}`,
    assistantId: profile.assistantId,
    roleTitle: role.roleTitle,
    roleIntroduction: role.roleIntroduction,
    roleDirective: role.roleDirective,
    allowWebSearch,
    enableCollaboration: built.config.enableCollaboration !== false,
    /**
     * 审核台「提交给助手」为律师显式授权的后台修订；须允许 write_document 直接写回 drafts/
     * 。否则在 strictDangerousToolApproval 下工具会停在 awaiting_approval，磁盘草稿不变。
     */
    strictDangerousToolApproval: false,
    allowDangerousToolsWithoutApproval: true,
    maxToolCalls: Math.max(built.config.maxToolCalls ?? 16, 24),
  };
  const auditDir = path.join(workspaceDir, "audit");
  const matterIdForChat = draft.matterId?.trim() || undefined;
  const instruction = buildRevisionDispatchInstruction(draft, supplementary);
  await emit(auditDir, {
    taskId: raw,
    kind: "draft.revision_dispatched",
    actor: "lawyer",
    actorId: desktopActor,
    detail: JSON.stringify({
      assistantId: profile.assistantId,
      supplementaryLen: supplementary.length,
      title: draft.title,
    }).slice(0, 4000),
  });
  const agent = createLawMindAgent(config);
  const preSession = agent.newSession({
    matterId: matterIdForChat,
    title: `[审核修订] ${draft.title}`.slice(0, 200),
  });
  const projectDirForAgent = safeOptionalProjectDir(body.projectDir);
  const bumpRoot = lawMindRoot;
  const bumpAssistantId = profile.assistantId;
  const revisionBaseline = snapshotDraftRevisionBaseline(workspaceDir, raw);
  void (async () => {
    const chatOpts = {
      sessionId: preSession.sessionId,
      matterId: matterIdForChat,
      assistantId: profile.assistantId,
      linkedTaskId: raw,
      allowWebSearch,
      projectDir: projectDirForAgent,
      sessionTitleHint: `审核修订 ${raw.slice(0, 12)}`,
      liveProgressSessionId: preSession.sessionId,
    } as const;
    try {
      let result = await agent.chat(instruction, chatOpts);
      let persisted = draftRevisionWasPersisted(
        workspaceDir,
        raw,
        revisionBaseline,
        result.turn,
      );
      if (!persisted) {
        result = await agent.chat(buildRevisionRetryInstruction(raw), chatOpts);
        persisted = draftRevisionWasPersisted(
          workspaceDir,
          raw,
          revisionBaseline,
          result.turn,
        );
      }
      if (!persisted) {
        finishLiveTurnProgress(preSession.sessionId, "failed");
        throw new Error(
          "revision_not_persisted: 助手未将修订写入 drafts 文件，请查看对话后重试或手动恢复待审核。",
        );
      }
      bumpAssistantStats(bumpRoot, bumpAssistantId, { newSession: true, turn: true });
      const engine = getLawMindEngine(workspaceDir);
      const reopened = await engine.reopenDraftReview(raw, {
        actorId: `${desktopActor}|revision-agent`,
      });
      if (reopened) {
        await emit(auditDir, {
          taskId: raw,
          kind: "draft.revision_completed",
          actor: "system",
          actorId: desktopActor,
          detail: JSON.stringify({
            assistantId: profile.assistantId,
            sessionId: preSession.sessionId,
            title: reopened.title,
          }).slice(0, 4000),
        });
      }
    } catch (err) {
      finishLiveTurnProgress(preSession.sessionId, "failed");
      const msg = err instanceof Error ? err.message : String(err);
      await emit(auditDir, {
        taskId: raw,
        kind: "draft.revision_agent_failed",
        actor: "system",
        detail: msg.slice(0, 4000),
      });
    }
  })();

  sendJson(
    res,
    200,
    {
      ok: true,
      queued: true,
      sessionId: preSession.sessionId,
      assistantId: profile.assistantId,
    },
    c,
  );
  return true;
}
