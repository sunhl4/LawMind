/**
 * Acceptance Gate route — Deliverable-First Architecture surface for the desktop UI.
 *
 *   GET /api/drafts/:taskId/acceptance
 *     -> { ok, draft, acceptance: AcceptanceReport, spec?: { type, displayName, defaultOutput } }
 *
 *   GET /api/drafts/:taskId/acceptance-pack
 *     -> Markdown 验收包（默认 text/markdown）；?format=json 时返回 { ok, markdown }
 *        受 edition.features.acceptancePackExport 控制（Solo 不可用，返回 403）。
 *
 *   GET /api/deliverables/specs
 *     -> { ok, specs: Array<{ type, displayName, description, defaultOutput, defaultRiskLevel }> }
 *
 *   GET /api/policy/edition
 *     -> { ok, edition, label, source, features }
 *
 * 这些只是**只读**端点，新增端点不修改任何现有路由文件，方便多 agent 并行开发。
 * 注意：放在独立文件里，挂在 dispatch 中即可。
 */

import {
  getDeliverableSpec,
  listDeliverableSpecs,
  listExtraDeliverableSpecs,
  validateDraftAgainstSpec,
} from "../../../src/lawmind/deliverables/index.js";
import { buildDraftAcceptancePackMarkdown } from "../../../src/lawmind/delivery/draft-acceptance-pack.js";
import { listDrafts, readDraft } from "../../../src/lawmind/drafts/index.js";
import { resolveEdition } from "../../../src/lawmind/policy/index.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";

/**
 * Bridge the desktop's `LawMindPolicyFile` to the engine's `LawMindWorkspacePolicy`
 * — the two shapes already share keys; we only forward what we know is safe to read.
 */
function policyForEdition(
  policy: LawmindRouteContext["ctx"]["policy"],
): LawMindWorkspacePolicy | null {
  if (!policy.loaded) {
    return null;
  }
  const p = policy.policy as LawMindWorkspacePolicy & {
    edition?: LawMindWorkspacePolicy["edition"];
  };
  return {
    schemaVersion: p.schemaVersion,
    ...(p.allowWebSearch !== undefined ? { allowWebSearch: p.allowWebSearch } : {}),
    ...(p.retrievalMode ? { retrievalMode: p.retrievalMode } : {}),
    ...(p.enableCollaboration !== undefined ? { enableCollaboration: p.enableCollaboration } : {}),
    ...(p.edition ? { edition: p.edition } : {}),
  };
}

export async function handleAcceptanceRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, policy } = ctx;

  if (pathname === "/api/deliverables/specs" && req.method === "GET") {
    const extraTypes = new Set(listExtraDeliverableSpecs().map((s) => s.type));
    const specs = listDeliverableSpecs().map((s) => ({
      type: s.type,
      displayName: s.displayName,
      description: s.description,
      defaultOutput: s.defaultOutput,
      defaultRiskLevel: s.defaultRiskLevel,
      blockerSectionCount: s.requiredSections.filter((rs) => rs.severity === "blocker").length,
      acceptanceCriteriaCount: s.acceptanceCriteria.length,
      source: extraTypes.has(s.type) ? ("workspace" as const) : ("builtin" as const),
    }));
    sendJson(res, 200, { ok: true, specs }, c);
    return true;
  }

  // Bulk acceptance summary for the matter cockpit; lets MatterWorkbench paint
  // per-draft readiness badges without N+1 calls into /api/drafts/:taskId.
  // Optional ?matterId=... filter; without it summarises every draft in the workspace.
  if (pathname === "/api/acceptance-summary" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    const matterId = url.searchParams.get("matterId")?.trim() || null;
    const all = listDrafts(workspaceDir);
    const scoped = matterId ? all.filter((d) => d.matterId === matterId) : all;
    const items = scoped.map((draft) => {
      const report = validateDraftAgainstSpec(draft);
      const blockerCount = report.checks.filter((c) => c.severity === "blocker" && !c.ok).length;
      const warningCount = report.checks.filter((c) => c.severity === "warning" && !c.ok).length;
      return {
        taskId: draft.taskId,
        matterId: draft.matterId ?? null,
        title: draft.title,
        deliverableType: draft.deliverableType ?? null,
        reviewStatus: draft.reviewStatus,
        ready: report.ready,
        placeholderCount: report.placeholderCount,
        blockerCount,
        warningCount,
        hasSpec: report.deliverableType != null,
        outputPath: draft.outputPath ?? null,
      };
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        matterId,
        count: items.length,
        readyCount: items.filter((i) => i.ready).length,
        blockedCount: items.filter((i) => i.hasSpec && !i.ready).length,
        items,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/policy/edition" && req.method === "GET") {
    const edition = resolveEdition({ policy: policyForEdition(policy) });
    sendJson(
      res,
      200,
      {
        ok: true,
        edition: edition.edition,
        label: edition.label,
        source: edition.source,
        features: edition.features,
      },
      c,
    );
    return true;
  }

  const packMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/acceptance-pack$/);
  if (packMatch && req.method === "GET") {
    const raw = decodeURIComponent(packMatch[1] ?? "");
    if (!isSafeTaskIdSegment(raw)) {
      sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
      return true;
    }
    const edition = resolveEdition({ policy: policyForEdition(policy) });
    if (!edition.features.acceptancePackExport) {
      sendJson(
        res,
        403,
        {
          ok: false,
          error: "feature_disabled",
          feature: "acceptancePackExport",
          edition: edition.edition,
          hint: "Acceptance pack export 仅对 Firm / Private Deploy 可用。",
        },
        c,
      );
      return true;
    }
    const draft = readDraft(workspaceDir, raw);
    if (!draft) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const format = url.searchParams.get("format") ?? "markdown";
    const markdown = await buildDraftAcceptancePackMarkdown(workspaceDir, draft);
    if (format === "json") {
      sendJson(res, 200, { ok: true, taskId: raw, markdown }, c);
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="lawmind-acceptance-pack-${encodeURIComponent(raw)}.md"`,
    );
    res.end(markdown);
    return true;
  }

  const acceptanceMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/acceptance$/);
  if (acceptanceMatch && req.method === "GET") {
    const raw = decodeURIComponent(acceptanceMatch[1] ?? "");
    if (!isSafeTaskIdSegment(raw)) {
      sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
      return true;
    }
    const draft = readDraft(workspaceDir, raw);
    if (!draft) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    const report = validateDraftAgainstSpec(draft);
    const spec = getDeliverableSpec(draft.deliverableType);
    sendJson(
      res,
      200,
      {
        ok: true,
        draft,
        acceptance: report,
        ...(spec
          ? {
              spec: {
                type: spec.type,
                displayName: spec.displayName,
                defaultOutput: spec.defaultOutput,
                description: spec.description,
              },
            }
          : {}),
      },
      c,
    );
    return true;
  }

  return false;
}
