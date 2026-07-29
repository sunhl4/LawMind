/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsModelRetrieval } from "./LawmindSettingsModelRetrieval";

describe("LawmindSettingsModelRetrieval", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 404 })),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  const baseProps = {
    config: {
      workspaceDir: "/tmp/ws",
      projectDir: null as string | null,
      retrievalMode: "single" as const,
    },
    retrievalLabel: "单模型",
    retrievalSaving: false,
    applyRetrievalMode: vi.fn(),
    onOpenApiWizard: vi.fn(),
  };

  it("shows live configured authority status from health (symmetric to Doctor)", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsModelRetrieval
          {...baseProps}
          health={{
            modelConfigured: true,
            authorityCorpus: {
              configured: true,
              status: "configured",
              endpointHost: "legal-api.example",
              message: "已配置权威检索端点（legal-api.example）。",
              envKey: "LAWMIND_AUTHORITY_ENDPOINT",
            },
          }}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-settings-authority-boundary"]');
    expect(pill?.getAttribute("data-status")).toBe("configured");
    expect(pill?.textContent).toContain("已配置");
    expect(pill?.textContent).toContain("legal-api.example");
    expect(host.textContent).toContain("已配置权威检索端点");
  });

  it("shows invalid authority endpoint as fail-closed", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsModelRetrieval
          {...baseProps}
          health={{
            modelConfigured: true,
            authorityCorpus: {
              configured: false,
              status: "invalid",
              endpointHost: null,
              message: "权威端点配置无效（fail-closed）：协议必须是 http/https",
              envKey: "LAWMIND_AUTHORITY_ENDPOINT",
            },
          }}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-settings-authority-boundary"]');
    expect(pill?.getAttribute("data-status")).toBe("invalid");
    expect(host.textContent).toContain("配置无效");
    expect(host.textContent).toContain("fail-closed");
  });

  it("shows sample-ready for open demo corpus", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsModelRetrieval
          {...baseProps}
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            authorityCorpus: {
              configured: true,
              status: "sample-ready",
              endpointHost: "local-corpus",
              provider: "open",
              message: "演示语料就绪：内置 sample 5 条。",
            },
          }}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-settings-authority-boundary"]');
    expect(pill?.getAttribute("data-status")).toBe("sample-ready");
    expect(host.textContent).toContain("演示语料就绪");
    const probe = host.querySelector('[data-testid="lm-settings-authority-probe"]');
    expect(probe?.textContent).toContain("探测开源语料");
    expect((probe as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it("shows lexis unimplemented distinctly from invalid", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsModelRetrieval
          {...baseProps}
          health={{
            modelConfigured: true,
            authorityCorpus: {
              configured: false,
              status: "unimplemented",
              endpointHost: "lexis.example",
              provider: "lexis",
              message: "provider=lexis 适配器尚未实现（闭源占位）",
              envKey: "LAWMIND_AUTHORITY_ENDPOINT",
            },
          }}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-settings-authority-boundary"]');
    expect(pill?.getAttribute("data-status")).toBe("unimplemented");
    expect(host.textContent).toContain("适配器未实现");
    expect(host.textContent).not.toMatch(/配置无效$/);
  });

  it("shows unset authority status and default 缺源 caption", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsModelRetrieval
          {...baseProps}
          health={{ modelConfigured: true }}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-settings-authority-boundary"]');
    expect(pill?.getAttribute("data-status")).toBe("unset");
    expect(pill?.textContent).toContain("未配置");
    expect(host.textContent).toContain("缺源");
    expect(host.textContent).toContain("不会编造");
  });
});
