import type { HealthPayload } from "./lawmind-app-data";
import { MODEL_NOT_CONFIGURED_USER_HINT } from "./api-client";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { findCatalogEntry, isModelEntryVerified } from "./lawmind-model-verify";

export type ReadinessPillState = "ok" | "warn" | "unknown" | "off";

export type ReadinessPill = {
  id: "api" | "model" | "workspace";
  label: string;
  state: ReadinessPillState;
  title: string;
};

export type ReadinessSnapshot = {
  pills: ReadinessPill[];
  allReady: boolean;
  needsApiWizard: boolean;
  modelVerified: boolean;
};

function workspaceLabel(workspaceDir: string | undefined): {
  label: string;
  ok: boolean;
  omitPill: boolean;
} {
  const raw = workspaceDir?.trim() ?? "";
  if (!raw) {
    return { label: "工作区未连接", ok: false, omitPill: false };
  }
  if (raw.startsWith("(")) {
    return { label: "工作区未连接", ok: false, omitPill: false };
  }
  const name = raw.split(/[\\/]/).filter(Boolean).pop() ?? raw;
  return { label: `工作区：${name}`, ok: true, omitPill: false };
}

/** Aggregates health + config; UI strip only renders when not {@link ReadinessSnapshot.allReady}. */
export function buildReadinessSnapshot(input: {
  health: HealthPayload | null | undefined;
  workspaceDir: string | undefined;
  apiReachable: boolean;
  modelCatalog?: ModelCatalogEntry[];
  selectedModelId?: string;
}): ReadinessSnapshot {
  const { health, workspaceDir, apiReachable, modelCatalog = [], selectedModelId = "" } = input;
  const ws = workspaceLabel(workspaceDir);

  const apiPill: ReadinessPill = {
    id: "api",
    label: apiReachable ? "本地服务已连接" : "本地服务未连接",
    state: apiReachable ? "ok" : "warn",
    title: apiReachable
      ? "LawMind 桌面后端可访问"
      : "请确认应用已启动；可在设置中检查工作区与连接",
  };

  const configured = health?.modelConfigured === true;
  const activeRow = findCatalogEntry(modelCatalog, selectedModelId);
  const verified = configured && isModelEntryVerified(activeRow);
  const modelName =
    (typeof health?.modelName === "string" && health.modelName.trim()) ||
    activeRow?.model ||
    activeRow?.label ||
    "";

  let modelState: ReadinessPillState = "unknown";
  if (!configured) {
    modelState = health?.modelConfigured === false ? "warn" : "unknown";
  } else if (verified) {
    modelState = "ok";
  } else {
    modelState = "warn";
  }

  const latency =
    typeof activeRow?.verifiedLatencyMs === "number" ? ` · ${activeRow.verifiedLatencyMs}ms` : "";

  const modelPill: ReadinessPill = {
    id: "model",
    label: !configured
      ? "模型未配置"
      : verified
        ? modelName
          ? `模型可用 · ${modelName}${latency}`
          : `模型已验证${latency}`
        : "模型待验证",
    state: modelState,
    title: !configured
      ? MODEL_NOT_CONFIGURED_USER_HINT
      : verified
        ? modelName
          ? `已验证可用：${modelName}${latency}`
          : "主对话模型已通过连接测试"
        : "已写入 Key 但尚未验证。请点「验证模型」或在对话栏测试连接。",
  };

  const workspacePill: ReadinessPill = {
    id: "workspace",
    label: ws.label,
    state: ws.ok ? "ok" : "warn",
    title: ws.ok ? workspaceDir ?? "" : "请选择或创建工作区目录",
  };

  const pills = ws.omitPill ? [apiPill, modelPill] : [apiPill, modelPill, workspacePill];
  const needsApiWizard = !configured;
  const allReady = apiReachable && ws.ok && verified;

  return { pills, allReady, needsApiWizard, modelVerified: verified };
}
