import {
  addCustomModel,
  buildModelCatalog,
  probeAgentModel,
  recordVerification,
  removeCustomModel,
  resolveAgentModelById,
  resolveDraftReasoningLlmConfig,
  setDefaultModelId,
  setWorkerModelId,
  readModelsStore,
  setDraftWithModelEnabled,
} from "../../../src/lawmind/models/index.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  modelsCustomPostSchema,
  modelsDefaultPatchSchema,
  modelsDraftWithModelPatchSchema,
  modelsTestRequestSchema,
} from "./lawmind-api-schemas.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { z } from "zod";

const modelsWorkerPatchSchema = z.object({
  modelId: z.union([z.string().trim().max(200), z.null()]).optional(),
});

function lawMindRootFromCtx(ctx: LawmindRouteContext["ctx"]): string {
  return resolveLawMindRoot(ctx.workspaceDir, ctx.envFile);
}

export async function handleModelsRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const lawMindRoot = lawMindRootFromCtx(ctx);

  if (pathname === "/api/models" && req.method === "GET") {
    const catalog = buildModelCatalog(lawMindRoot);
    const workerModelId = readModelsStore(lawMindRoot).workerModelId ?? null;
    sendJson(
      res,
      200,
      {
        ok: true,
        models: catalog.models,
        defaultModelId: catalog.defaultModelId,
        workerModelId,
        providers: catalog.providers,
        platformProviders: catalog.platformProviders,
        platformMode: catalog.platformMode,
        draftWithModelEnabled: catalog.draftWithModelEnabled,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/models/test" && req.method === "POST") {
    const body = await parseJsonBodyZod(req, modelsTestRequestSchema);
    const modelId =
      body.modelId && body.modelId.length > 0
        ? body.modelId
        : buildModelCatalog(lawMindRoot).defaultModelId;
    const resolved = resolveAgentModelById(lawMindRoot, modelId);
    if (!resolved.model?.apiKey) {
      sendJsonError(
        res,
        503,
        resolved.error === "missing_platform_api_key"
          ? "missing_platform_api_key"
          : "missing_api_key",
        "该模型尚未配置，无法测试连接。",
        c,
      );
      return true;
    }
    const probe = await probeAgentModel(resolved.model);
    if (!probe.ok) {
      let msg = probe.error;
      if (resolved.resolvedModelId.startsWith("custom:") && /404|not.?found|model.*(exist|access)/i.test(probe.error || "")) {
        msg = `${probe.error}\n提示：自定义模型的「模型 ID」必须是该 Base URL 真正支持的名称（不是 custom:xxx）。请确认你填的模型名在该服务商/端点的模型列表中存在，且 Key 有权限。`;
      }
      sendJson(
        res,
        502,
        {
          ok: false,
          code: probe.code,
          message: msg,
          modelId: resolved.resolvedModelId,
        },
        c,
      );
      return true;
    }
    const verifiedAt = new Date().toISOString();
    try {
      recordVerification(lawMindRoot, resolved.resolvedModelId, {
        latencyMs: probe.latencyMs,
        model: probe.model,
        baseUrl: probe.baseUrl,
        verifiedAt,
      });
    } catch {
      /* persistence is best-effort; UI still reports a successful probe */
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        modelId: resolved.resolvedModelId,
        model: probe.model,
        baseUrl: probe.baseUrl,
        latencyMs: probe.latencyMs,
        verifiedAt,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/models/default" && req.method === "PATCH") {
    let body;
    try {
      body = await parseJsonBodyZod(req, modelsDefaultPatchSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "model_id_required", "请选择要设为默认的模型。", c);
        return true;
      }
      throw err;
    }
    const modelId = body.modelId;
    const catalog = buildModelCatalog(lawMindRoot);
    const row = catalog.models.find((m) => m.id === modelId);
    if (!row) {
      sendJsonError(res, 404, "unknown_model", "未找到该模型。", c);
      return true;
    }
    if (!row.configured) {
      sendJsonError(res, 400, "model_not_configured", "该模型尚未配置 API Key，无法设为默认。", c);
      return true;
    }
    setDefaultModelId(lawMindRoot, modelId);
    sendJson(res, 200, { ok: true, defaultModelId: modelId }, c);
    return true;
  }

  if (pathname === "/api/models/worker" && req.method === "PATCH") {
    let body;
    try {
      body = await parseJsonBodyZod(req, modelsWorkerPatchSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", "worker modelId 无效。", c);
        return true;
      }
      throw err;
    }
    const modelId = body.modelId?.trim() || undefined;
    if (modelId) {
      const catalog = buildModelCatalog(lawMindRoot);
      const row = catalog.models.find((m) => m.id === modelId);
      if (!row) {
        sendJsonError(res, 404, "unknown_model", "未找到该 Worker 模型。", c);
        return true;
      }
      if (!row.configured) {
        sendJsonError(res, 400, "model_not_configured", "该模型尚未配置，无法设为 Worker。", c);
        return true;
      }
    }
    setWorkerModelId(lawMindRoot, modelId);
    sendJson(res, 200, { ok: true, workerModelId: modelId ?? null }, c);
    return true;
  }

  if (pathname === "/api/models/draft-with-model" && req.method === "PATCH") {
    let body;
    try {
      body = await parseJsonBodyZod(req, modelsDraftWithModelPatchSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "enabled_required", "请指定是否开启起草阶段大模型。", c);
        return true;
      }
      throw err;
    }
    if (body.enabled) {
      const catalog = buildModelCatalog(lawMindRoot);
      const resolved = resolveAgentModelById(lawMindRoot, catalog.defaultModelId);
      if (!resolved.model?.apiKey?.trim()) {
        sendJsonError(
          res,
          400,
          "model_not_configured",
          "请先配置并验证对话模型，再开启起草阶段大模型。",
          c,
        );
        return true;
      }
    }
    setDraftWithModelEnabled(lawMindRoot, body.enabled);
    const draftWithModelActive = body.enabled && resolveDraftReasoningLlmConfig(lawMindRoot) !== null;
    sendJson(
      res,
      200,
      {
        ok: true,
        draftWithModelEnabled: body.enabled,
        draftWithModelActive,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/models/custom" && req.method === "POST") {
    const body = await parseJsonBodyZod(req, modelsCustomPostSchema);
    const rawApiKey = body.apiKey ?? "";
    const allowKeyless = body.keyStorage === "keychain" || rawApiKey === "";
    try {
      const stopRaw = body.stop;
      const stop =
        typeof stopRaw === "string"
          ? stopRaw
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : Array.isArray(stopRaw)
            ? stopRaw
            : undefined;
      const row = addCustomModel(lawMindRoot, {
        label: body.label ?? "",
        baseUrl: body.baseUrl ?? "",
        model: body.model ?? "",
        apiKey: rawApiKey,
        allowKeylessIfKeychain: allowKeyless,
        ...(stop && stop.length > 0 ? { stop } : {}),
      });
      if (body.setAsDefault === true) {
        setDefaultModelId(lawMindRoot, row.id);
      }
      const keyStorage = rawApiKey.trim() ? "store" : "keychain";
      sendJson(
        res,
        201,
        {
          ok: true,
          model: {
            id: row.id,
            kind: row.kind,
            label: row.label,
            model: row.model,
            baseUrl: row.baseUrl,
            configured: true,
            group: "自定义模型",
            provider: "custom",
          },
          keyStorage,
        },
        c,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "custom_model_fields_required") {
        sendJsonError(res, 400, "custom_model_fields_required", "请填写名称、Base URL、模型名与 API Key。", c);
        return true;
      }
      if (msg === "custom_model_invalid_model_name") {
        sendJsonError(res, 400, "custom_model_invalid_model_name", "模型 ID 不能使用 LawMind 内部 ID（custom: / builtin: 等），请填写该端点实际的模型名称（如 gpt-4o、qwen-plus）。", c);
        return true;
      }
      throw e;
    }
    return true;
  }

  const customDelete = pathname.match(/^\/api\/models\/custom\/([^/]+)$/);
  if (customDelete && req.method === "DELETE") {
    const rawId = decodeURIComponent(customDelete[1] ?? "");
    const modelId = rawId.startsWith("custom:") ? rawId : `custom:${rawId}`;
    const removed = removeCustomModel(lawMindRoot, modelId);
    if (!removed) {
      sendJsonError(res, 404, "unknown_model", "未找到该自定义模型。", c);
      return true;
    }
    sendJson(res, 200, { ok: true }, c);
    return true;
  }

  return false;
}
