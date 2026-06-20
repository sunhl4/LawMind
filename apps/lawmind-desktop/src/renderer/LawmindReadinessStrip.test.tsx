/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindReadinessStrip } from "./LawmindReadinessStrip";

describe("LawmindReadinessStrip", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders nothing when all readiness checks pass", async () => {
    await act(async () => {
      root.render(
        <LawmindReadinessStrip
          health={{
            modelConfigured: true,
            modelName: "test-model",
            doctor: { workspaceStandard: { ok: true } },
          }}
          workspaceDir="/tmp/ws"
          apiReachable
          modelCatalog={[
            {
              id: "m1",
              kind: "builtin",
              label: "Test",
              group: "default",
              provider: "openai",
              model: "test-model",
              baseUrl: "http://localhost",
              configured: true,
              verifiedAt: new Date().toISOString(),
            },
          ]}
          selectedModelId="m1"
          onOpenApiWizard={vi.fn()}
        />,
      );
    });
    expect(host.textContent?.trim()).toBe("");
  });

  it("shows configure API action when model is missing", async () => {
    const onOpenApiWizard = vi.fn();
    await act(async () => {
      root.render(
        <LawmindReadinessStrip
          health={{ modelConfigured: false, doctor: { workspaceStandard: { ok: false } } }}
          workspaceDir="/tmp/ws"
          apiReachable
          onOpenApiWizard={onOpenApiWizard}
        />,
      );
    });
    expect(host.textContent).toContain("模型");
    const btn = host.querySelector("button");
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenApiWizard).toHaveBeenCalledOnce();
  });
});
