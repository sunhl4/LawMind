import path from "node:path";
import { emit } from "../../../src/lawmind/audit/index.js";
import { persistDraft } from "../../../src/lawmind/drafts/index.js";
import { ensureTaskRecord, updateTaskRecord } from "../../../src/lawmind/tasks/index.js";
import type { ArtifactDraft, ArtifactSection, TaskIntent } from "../../../src/lawmind/types.js";
import { isLawmindPackagedRuntime } from "./lawmind-local-api-auth.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

/** 仅未打包进程且显式打开时启用。打包态忽略该环境变量。 */
export function areE2eTestRoutesEnabled(): boolean {
  if (isLawmindPackagedRuntime()) {
    return false;
  }
  return process.env.LAWMIND_ENABLE_E2E_TEST_ROUTES === "1";
}

const E2E_ENABLED = areE2eTestRoutesEnabled();

type CreateDraftBody = {
  taskId?: string;
  matterId?: string;
  title?: string;
  summary?: string;
  sections?: Array<{ heading: string; body: string }>;
  output?: "docx" | "pptx";
  deliverableType?: string;
};

function parseCreateDraftBody(raw: unknown): CreateDraftBody {
  const body = typeof raw === "object" && raw !== null ? (raw as CreateDraftBody) : {};
  return {
    taskId: typeof body.taskId === "string" ? body.taskId.trim() : undefined,
    matterId: typeof body.matterId === "string" ? body.matterId.trim() : undefined,
    title: typeof body.title === "string" ? body.title.trim() : undefined,
    summary: typeof body.summary === "string" ? body.summary.trim() : undefined,
    sections: Array.isArray(body.sections)
      ? body.sections.filter(
          (s): s is { heading: string; body: string } =>
            s !== null &&
            typeof s === "object" &&
            typeof (s as { heading?: unknown }).heading === "string" &&
            typeof (s as { body?: unknown }).body === "string",
        )
      : undefined,
    output: body.output === "pptx" ? "pptx" : body.output === "docx" ? "docx" : undefined,
    deliverableType: typeof body.deliverableType === "string" ? body.deliverableType.trim() : undefined,
  };
}

export async function handleE2eTestRoute({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (!E2E_ENABLED) {
    return false;
  }

  const { workspaceDir } = ctx;

  if (pathname === "/api/e2e/create-draft" && req.method === "POST") {
    const body = parseCreateDraftBody(await readJsonBody(req));
    const now = new Date().toISOString();
    const taskId = body.taskId?.trim() || `e2e-draft-${Date.now()}`;
    const matterId = body.matterId?.trim() || undefined;
    const title = body.title?.trim() || "E2E 测试草稿";
    const summary = body.summary?.trim() || "E2E 测试摘要";
    const sections: ArtifactSection[] =
      body.sections && body.sections.length > 0
        ? body.sections.map((s) => ({ heading: s.heading.trim(), body: s.body.trim() }))
        : [{ heading: "审查结论", body: "E2E 测试结论：风险可控，建议签署。" }];
    const output: ArtifactDraft["output"] = body.output === "pptx" ? "pptx" : "docx";
    const deliverableType = body.deliverableType?.trim() || "contract.review";

    const intent: TaskIntent = {
      taskId,
      kind: "agent.instruction",
      output,
      instruction: summary,
      summary,
      riskLevel: "medium",
      requiresConfirmation: true,
      matterId,
      deliverableType,
      createdAt: now,
      models: ["general"],
    };
    ensureTaskRecord(workspaceDir, intent);
    updateTaskRecord(workspaceDir, taskId, {
      status: "drafted",
      title,
      deliverableType,
    });

    const draft: ArtifactDraft = {
      taskId,
      matterId,
      title,
      output,
      templateId: "word/legal-memo-default",
      deliverableType,
      summary,
      sections,
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    };
    persistDraft(workspaceDir, draft);

    sendJson(res, 200, { ok: true, taskId, matterId, title, output }, c);
    return true;
  }

  if (pathname === "/api/e2e/crash" && req.method === "POST") {
    const auditDir = path.join(workspaceDir, "audit");
    await emit(auditDir, {
      taskId: "system",
      kind: "safe_command",
      actor: "system",
      detail: "test: server crash requested",
    });
    // 短暂延迟后干净退出，确保响应先发出；Electron 监督层会探测到 exit 并指数退避重启。
    setTimeout(() => process.exit(1), 50);
    sendJson(res, 200, { ok: true, crashing: true }, c);
    return true;
  }

  return false;
}
