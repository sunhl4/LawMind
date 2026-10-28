/**
 * 本所剧本与三色分流接口。
 *
 * GET    /api/playbooks        列出工作区里的剧本（没有文件就是空列表）
 * POST   /api/playbooks        新建或覆盖一份剧本（请求体即剧本 JSON）
 * DELETE /api/playbooks/:id    删除一份剧本
 * POST   /api/playbooks/triage 按剧本分流；引用先回读工作区核对，再出结论
 *
 * 观测（每条条件的结论 + 引用）由调用方给出；这里不替模型猜结论，
 * 也不把「引用的句子找不到」当成通过。
 */

import { z } from "zod";
import { describePlaybookTriage } from "../../../src/lawmind/deliverables/playbook-triage.js";
import { triageWithVerifiedEvidence } from "../../../src/lawmind/deliverables/playbook-triage-verify.js";
import {
  deleteWorkspacePlaybook,
  listWorkspacePlaybooks,
  loadWorkspacePlaybook,
  PlaybookInputSchema,
  saveWorkspacePlaybook,
} from "../../../src/lawmind/deliverables/playbook-store.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

const evidenceSchema = z.object({
  quote: z.string().max(4_000),
  locator: z.string().trim().max(200),
  filePath: z.string().trim().max(2_000).optional(),
});

const observationSchema = z.object({
  criterionId: z.string().trim().min(1).max(120),
  result: z.enum(["PASS", "FLAG", "FAIL"]),
  evidence: evidenceSchema.optional(),
  reasonZh: z.string().max(2_000).optional(),
});

const overrideSchema = z.object({
  by: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(1_000),
  at: z.string().trim().min(1).max(64),
});

const triageSchema = z.object({
  playbookId: z.string().trim().min(1).max(128),
  observations: z.array(observationSchema).max(100).default([]),
  override: overrideSchema.optional(),
});

export function handlePlaybookRoutes({
  ctx,
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): boolean | Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/playbooks" && req.method === "GET") {
    sendJson(res, 200, { ok: true, playbooks: listWorkspacePlaybooks(workspaceDir) }, c);
    return true;
  }

  if (pathname === "/api/playbooks" && req.method === "POST") {
    return (async () => {
      let body: z.infer<typeof PlaybookInputSchema>;
      try {
        body = await parseJsonBodyZod(req, PlaybookInputSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
          return true;
        }
        throw err;
      }
      const saved = saveWorkspacePlaybook(workspaceDir, body);
      sendJson(res, 200, { ok: true, playbook: saved }, c);
      return true;
    })();
  }

  const itemMatch = pathname.match(/^\/api\/playbooks\/([^/]+)$/);
  if (itemMatch && req.method === "GET") {
    const id = decodeURIComponent(itemMatch[1] ?? "");
    let playbook;
    try {
      playbook = loadWorkspacePlaybook(workspaceDir, id);
    } catch {
      sendJsonError(res, 400, "invalid_playbook_id", "剧本编号格式不正确。", c);
      return true;
    }
    if (!playbook) {
      sendJsonError(res, 404, "playbook_not_found", "没有找到这份剧本。", c);
      return true;
    }
    sendJson(res, 200, { ok: true, playbook }, c);
    return true;
  }

  if (itemMatch && req.method === "DELETE") {
    const id = decodeURIComponent(itemMatch[1] ?? "");
    try {
      if (!deleteWorkspacePlaybook(workspaceDir, id)) {
        sendJsonError(res, 404, "playbook_not_found", "没有找到这份剧本。", c);
        return true;
      }
    } catch {
      sendJsonError(res, 400, "invalid_playbook_id", "剧本编号格式不正确。", c);
      return true;
    }
    sendJson(res, 200, { ok: true, id }, c);
    return true;
  }

  if (pathname === "/api/playbooks/triage" && req.method === "POST") {
    return (async () => {
      let body: z.infer<typeof triageSchema>;
      try {
        body = await parseJsonBodyZod(req, triageSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
          return true;
        }
        throw err;
      }

      const playbook = loadWorkspacePlaybook(workspaceDir, body.playbookId);
      if (!playbook) {
        sendJsonError(res, 404, "playbook_not_found", "没有找到这份剧本。", c);
        return true;
      }

      const triage = await triageWithVerifiedEvidence({
        workspaceDir,
        playbook,
        observations: body.observations,
        ...(body.override ? { override: body.override } : {}),
      });
      sendJson(
        res,
        200,
        { ok: true, triage, summaryZh: describePlaybookTriage(triage) },
        c,
      );
      return true;
    })();
  }

  return false;
}
