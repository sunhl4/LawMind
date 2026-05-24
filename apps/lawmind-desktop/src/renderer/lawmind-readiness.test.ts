import { describe, expect, it } from "vitest";
import { buildReadinessSnapshot } from "./lawmind-readiness";
import { MODEL_NOT_CONFIGURED_USER_HINT } from "./api-client";

describe("buildReadinessSnapshot", () => {
  it("marks all ready when api, model verified, and workspace are ok", () => {
    const s = buildReadinessSnapshot({
      health: { modelConfigured: true, modelName: "qwen-plus" },
      workspaceDir: "/Users/me/workspace",
      apiReachable: true,
      modelCatalog: [
        {
          id: "builtin:qwen-plus",
          kind: "builtin",
          label: "Qwen Plus",
          group: "通义",
          provider: "dashscope",
          model: "qwen-plus",
          baseUrl: "https://example.com",
          configured: true,
          verifiedAt: "2026-01-01T00:00:00.000Z",
          verifiedLatencyMs: 120,
        },
      ],
      selectedModelId: "builtin:qwen-plus",
    });
    expect(s.allReady).toBe(true);
    expect(s.modelVerified).toBe(true);
    expect(s.needsApiWizard).toBe(false);
    expect(s.pills.find((p) => p.id === "model")?.label).toContain("模型可用");
  });

  it("needs wizard when model not configured", () => {
    const s = buildReadinessSnapshot({
      health: { modelConfigured: false },
      workspaceDir: "/Users/me/workspace",
      apiReachable: true,
    });
    expect(s.needsApiWizard).toBe(true);
    expect(s.allReady).toBe(false);
    const model = s.pills.find((p) => p.id === "model");
    expect(model?.title).toBe(MODEL_NOT_CONFIGURED_USER_HINT);
  });

  it("treats browser-only dev workspace as ready without a workspace pill", () => {
    const s = buildReadinessSnapshot({
      health: { modelConfigured: true, modelName: "qwen-plus" },
      workspaceDir: "(browser dev / E2E - use Electron for full config)",
      apiReachable: true,
      modelCatalog: [
        {
          id: "builtin:qwen-plus",
          kind: "builtin",
          label: "Qwen Plus",
          group: "通义",
          provider: "dashscope",
          model: "qwen-plus",
          baseUrl: "https://example.com",
          configured: true,
          verifiedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      selectedModelId: "builtin:qwen-plus",
    });
    expect(s.allReady).toBe(true);
    expect(s.pills.some((p) => p.id === "workspace")).toBe(false);
  });

  it("shows pending verification when configured but not verified", () => {
    const s = buildReadinessSnapshot({
      health: { modelConfigured: true },
      workspaceDir: "/Users/me/workspace",
      apiReachable: true,
      modelCatalog: [
        {
          id: "builtin:qwen-plus",
          kind: "builtin",
          label: "Qwen Plus",
          group: "通义",
          provider: "dashscope",
          model: "qwen-plus",
          baseUrl: "https://example.com",
          configured: true,
        },
      ],
      selectedModelId: "builtin:qwen-plus",
    });
    expect(s.modelVerified).toBe(false);
    expect(s.pills.find((p) => p.id === "model")?.label).toBe("模型待验证");
  });
});
