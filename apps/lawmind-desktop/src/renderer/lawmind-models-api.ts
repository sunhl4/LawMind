import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import { apiGetJson, readJsonFromResponse } from "./api-client";

export type ModelCatalogEntry = {
  id: string;
  kind: "builtin" | "custom" | "platform";
  label: string;
  description?: string;
  group: string;
  provider: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  providerKeyHint?: string;
  contextTokens?: number;
  tags?: string[];
  verifiedAt?: string;
  verifiedLatencyMs?: number;
};

export type ProviderKeyStatus = {
  provider: string;
  label: string;
  configured: boolean;
  envKeys: string[];
};

export type PlatformProviderKeyStatus = {
  provider: string;
  label: string;
  configured: boolean;
  mode: "proxy" | "platform_key" | "none";
};

export type ModelsCatalogPayload = {
  ok?: boolean;
  models: ModelCatalogEntry[];
  defaultModelId: string;
  workerModelId?: string | null;
  draftWithModelEnabled?: boolean;
  providers: ProviderKeyStatus[];
  platformProviders?: PlatformProviderKeyStatus[];
  platformMode?: "proxy" | "platform_key" | "none";
};

export type ModelTestResult = {
  ok: boolean;
  modelId?: string;
  model?: string;
  baseUrl?: string;
  latencyMs?: number;
  verifiedAt?: string;
  code?: string;
  message?: string;
};

export async function fetchModelsCatalog(apiBase: string): Promise<ModelsCatalogPayload> {
  return apiGetJson<ModelsCatalogPayload>(apiBase, "/api/models");
}

export async function setDefaultModelId(apiBase: string, modelId: string): Promise<void> {
  const res = await fetch(`${apiBase}/api/models/default`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify({ modelId }),
  });
  const body = await readJsonFromResponse<{ ok?: boolean }>(res);
  if (!res.ok || body.ok === false) {
    throw new Error("设置默认模型失败");
  }
}

/** E7: optional fast worker model for tool-loop rounds. Pass null/empty to clear. */
export async function setWorkerModelIdApi(
  apiBase: string,
  modelId: string | null,
): Promise<string | null> {
  const res = await fetch(`${apiBase}/api/models/worker`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify({ modelId }),
  });
  const body = await readJsonFromResponse<{ ok?: boolean; workerModelId?: string | null }>(res);
  if (!res.ok || body.ok === false) {
    throw new Error("设置 Worker 模型失败");
  }
  return body.workerModelId ?? null;
}

export async function setDraftWithModelEnabled(
  apiBase: string,
  enabled: boolean,
): Promise<{ draftWithModelEnabled: boolean; draftWithModelActive: boolean }> {
  const res = await fetch(`${apiBase}/api/models/draft-with-model`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify({ enabled }),
  });
  const body = await readJsonFromResponse<{
    ok?: boolean;
    draftWithModelEnabled?: boolean;
    draftWithModelActive?: boolean;
    message?: string;
  }>(res);
  if (!res.ok || body.ok === false) {
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "更新起草模型设置失败";
    throw new Error(message);
  }
  return {
    draftWithModelEnabled: body.draftWithModelEnabled === true,
    draftWithModelActive: body.draftWithModelActive === true,
  };
}

export async function addCustomModel(
  apiBase: string,
  input: {
    label: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    setAsDefault?: boolean;
    keyStorage?: "keychain" | "env";
    /** Optional stop sequences (comma-separated or array). */
    stop?: string | string[];
  },
): Promise<ModelCatalogEntry> {
  const res = await fetch(`${apiBase}/api/models/custom`, {
    method: "POST",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify(input),
  });
  const body = await readJsonFromResponse<{ ok?: boolean; model?: ModelCatalogEntry; message?: string; error?: string }>(res);
  if (!res.ok || body.ok === false || !body.model) {
    const message =
      (typeof body.message === "string" && body.message.trim())
        ? body.message.trim()
        : (typeof body.error === "string" && body.error.trim())
          ? body.error.trim()
          : "添加自定义模型失败";
    throw new Error(message);
  }
  return body.model;
}

export async function testModelConnection(
  apiBase: string,
  modelId: string,
): Promise<ModelTestResult> {
  const res = await fetch(`${apiBase}/api/models/test`, {
    method: "POST",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify({ modelId }),
  });
  const body = await readJsonFromResponse<ModelTestResult>(res);
  if (!res.ok || ! body.ok) {
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "连接测试失败";
    throw new Error(message);
  }
  return body;
}

export async function createDelegation(
  apiBase: string,
  input: {
    fromAssistantId: string;
    toAssistantId: string;
    task: string;
    matterId?: string;
    parentSessionId?: string;
    modelId?: string;
    priority?: "normal" | "high" | "low";
  },
): Promise<{ delegationId: string; message?: string }> {
  const res = await fetch(`${apiBase}/api/delegations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify(input),
  });
  const body = await readJsonFromResponse<{
    ok?: boolean;
    delegationId?: string;
    message?: string;
    error?: string;
  }>(res);
  if (!res.ok || body.ok === false || !body.delegationId) {
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : typeof body.error === "string"
          ? body.error
          : "创建委派失败";
    throw new Error(message);
  }
  return { delegationId: body.delegationId, message: body.message };
}

export async function deleteCustomModel(apiBase: string, modelId: string): Promise<void> {
  const id = encodeURIComponent(modelId);
  const res = await fetch(`${apiBase}/api/models/custom/${id}`, {
    method: "DELETE",
    headers: { ...apiAuthHeaders() },
  });
  if (!res.ok) {
    const body = await readJsonFromResponse(res);
    throw new Error(typeof body.message === "string" ? body.message : "删除失败");
  }
}
