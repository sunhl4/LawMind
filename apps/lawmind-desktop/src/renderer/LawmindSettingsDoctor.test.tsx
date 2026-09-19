/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsDoctor } from "./LawmindSettingsDoctor";

describe("LawmindSettingsDoctor", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/api/metrics/north-star")) {
          return new Response(
            JSON.stringify({
              ok: true,
              schemaVersion: 1,
              firstPassRate: 0.5,
              unattendedCompleteRate: null,
              reviewDurationMsMedian: null,
              lintEscapeRate: null,
              samples: {
                firstPassOk: 1,
                firstPassFail: 1,
                unattended: 0,
                attended: 0,
                lintEscapes: 0,
                deliveries: 2,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/api/metrics/team-growth")) {
          return new Response(
            JSON.stringify({
              ok: true,
              windowDays: 30,
              metrics: [
                {
                  id: "first_pass_rate",
                  label: "主力一次过率",
                  value: 0.5,
                  numerator: 1,
                  denominator: 2,
                  targetNote: "相对基线 ↑ ≥10pt",
                  baselineValue: null,
                  deltaPts: null,
                },
              ],
              baseline: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ ok: false }), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows reasoning graph coverage when doctor stats present", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              reasoningGraphCoverage: {
                requiredDraftCount: 4,
                withSnapshotCount: 3,
                ratio: 0.75,
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    expect(host.textContent).toContain("推理留痕覆盖");
    expect(host.textContent).toContain("75%");
    expect(host.textContent).toContain("应留痕 4 份");
  });

  it("shows no-sample label when ratio is null", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            doctor: {
              reasoningGraphCoverage: {
                requiredDraftCount: 0,
                withSnapshotCount: 0,
                ratio: null,
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    expect(host.textContent).toContain("无样本");
  });

  it("surfaces honest authority corpus boundary", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{ modelConfigured: true }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-doctor-authority-boundary"]')).toBeTruthy();
    expect(host.textContent).toContain("权威法条 / 类案库");
    expect(host.textContent).toContain("拒答");
    expect(host.textContent).toContain("缺源");
  });

  it("shows live configured vs unset authority status from health", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              authorityCorpus: {
                configured: true,
                status: "configured",
                endpointHost: "legal-api.example",
                message: "已配置权威检索端点（legal-api.example）。",
                envKey: "LAWMIND_AUTHORITY_ENDPOINT",
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-doctor-authority-status"]');
    expect(pill?.getAttribute("data-status")).toBe("configured");
    expect(pill?.textContent).toContain("已配置");
    expect(pill?.textContent).toContain("legal-api.example");
  });

  it("shows sample-ready pill for open demo corpus (not commercial 已配置)", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              authorityCorpus: {
                configured: true,
                status: "sample-ready",
                endpointHost: "local-corpus",
                provider: "open",
                message: "演示语料就绪：内置 sample 5 条（非正式完整法库）。",
                envKey: "LAWMIND_AUTHORITY_ENDPOINT",
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-doctor-authority-status"]');
    expect(pill?.getAttribute("data-status")).toBe("sample-ready");
    expect(pill?.textContent).toContain("演示语料就绪");
    expect(pill?.textContent).toContain("非正式权威库");
    expect(pill?.className).toContain("lm-pill-warn");
    expect(pill?.className).not.toContain("lm-pill-success");
    expect(pill?.textContent).not.toContain("已配置");
  });

  it("shows invalid authority endpoint as fail-closed", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              authorityCorpus: {
                configured: false,
                status: "invalid",
                endpointHost: null,
                message: "权威端点配置无效（fail-closed）：协议必须是 http/https",
                envKey: "LAWMIND_AUTHORITY_ENDPOINT",
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-doctor-authority-status"]');
    expect(pill?.getAttribute("data-status")).toBe("invalid");
    expect(host.textContent).toContain("配置无效");
    expect(host.textContent).toContain("fail-closed");
  });

  it("shows lexis unimplemented as warn pill (not 配置无效)", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              authorityCorpus: {
                configured: false,
                status: "unimplemented",
                endpointHost: "lexis.example",
                provider: "lexis",
                message: "provider=lexis 适配器尚未实现（闭源占位）",
                envKey: "LAWMIND_AUTHORITY_ENDPOINT",
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-doctor-authority-status"]');
    expect(pill?.getAttribute("data-status")).toBe("unimplemented");
    expect(pill?.className).toMatch(/lm-pill-warn/);
    expect(pill?.className).not.toMatch(/lm-pill-danger/);
    expect(pill?.textContent).toContain("适配器未实现");
    expect(host.textContent).not.toMatch(/配置无效（已拒外呼）/);
  });

  it("shows team-growth metrics table", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{ modelConfigured: true }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("交付北极星");
    expect(host.querySelector('[data-testid="lm-doctor-delivery-autonomy"]')?.textContent).toContain(
      "一键签批",
    );
    expect(host.querySelector('[data-testid="lm-doctor-north-star-first-pass"]')?.textContent).toContain(
      "50%",
    );
    expect(host.textContent).toContain("团队成长 · 内测指标");
    expect(host.textContent).toContain("主力一次过率");
    expect(host.textContent).toContain("50%");
    expect(host.querySelector('[data-testid="lm-doctor-team-growth-baseline"]')).toBeTruthy();
  });

  it("keeps judgment hard-controls inside collapsed admin details", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              judgmentHardControls: {
                intakeSoftAsk: true,
                updateDraftAmplitudeSoft: true,
                emptyRedlineHard: true,
                sendEmailApprovalHard: true,
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    const admin = host.querySelector('[data-testid="lm-doctor-admin"]') as HTMLDetailsElement | null;
    expect(admin).toBeTruthy();
    expect(admin?.open).toBe(false);
    expect(admin?.querySelector('[data-testid="lm-doctor-judgment-hard-controls"]')).toBeTruthy();
    expect(admin?.querySelector('[data-testid="lm-doctor-authority-boundary"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-doctor-skills-trust"]')).toBeTruthy();
    expect(
      host
        .querySelector('[data-testid="lm-doctor-skills-trust"]')
        ?.contains(host.querySelector('[data-testid="lm-doctor-judgment-hard-controls"]')),
    ).toBe(false);
  });

  it("offers 验证模型 when the stored key has not been probed", async () => {
    const onVerifyModel = vi.fn();
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{ modelConfigured: true, modelVerified: false }}
          onOpenApiWizard={vi.fn()}
          onVerifyModel={onVerifyModel}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    expect(host.textContent).toContain("待验证");
    const verify = host.querySelector('[data-testid="lm-doctor-verify-model"]');
    expect(verify?.textContent).toContain("验证模型");
    await act(async () => {
      verify?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onVerifyModel).toHaveBeenCalledOnce();
  });

  it("shows license state and never presents an expired trial as blocking", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              license: {
                status: "trial_expired",
                trialDaysLeft: 0,
                blocking: false,
                message: "试用已结束；功能照常可用，请激活。",
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-settings-license"]')).toBeTruthy();
    const status = host.querySelector('[data-testid="lm-license-status"]');
    expect(status?.getAttribute("data-status")).toBe("trial_expired");
    expect(status?.textContent).toContain("试用已结束");
    expect(host.textContent).toContain("功能照常可用");
    expect(host.querySelector('[data-testid="lm-license-code-input"]')).toBeTruthy();
  });

  it("shows an activated license with the licensee name", async () => {    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              license: {
                status: "licensed",
                licensee: "张三律师",
                edition: "solo",
                expiresAt: "2099-01-01T00:00:00.000Z",
                blocking: false,
                message: "已激活：张三律师（solo），有效期至 2099-01-01。",
              },
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    const status = host.querySelector('[data-testid="lm-license-status"]');
    expect(status?.getAttribute("data-status")).toBe("licensed");
    expect(status?.textContent).toContain("张三律师");
  });

  it("renders the lawyer scorecard rows and never fabricates a rate", async () => {
    await act(async () => {
      root.render(
        <LawmindSettingsDoctor
          apiBase="http://127.0.0.1:8765"
          health={{
            modelConfigured: true,
            doctor: {
              scorecardRows: [
                {
                  id: "first_pass",
                  label: "一次通过率",
                  value: "暂无样本",
                  rate: null,
                  detail: "样本 0/0",
                },
                {
                  id: "authority",
                  label: "法源",
                  value: "国家法律法规数据库（官方公开）",
                  rate: null,
                  detail: "引用可核验到官方法规库",
                },
              ],
            },
          }}
          onOpenApiWizard={vi.fn()}
          onOpenCollaborationPage={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-settings-scorecard"]')).toBeTruthy();
    expect(
      host.querySelector('[data-testid="lm-scorecard-first_pass"]')?.textContent,
    ).toContain("暂无样本");
    expect(host.querySelector('[data-testid="lm-scorecard-authority"]')?.textContent).toContain(
      "国家法律法规数据库",
    );
    // 诊断包需律师二次确认：先预览，再下载。
    expect(host.querySelector('[data-testid="lm-support-bundle-preview"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-support-bundle-download"]')).toBeNull();
  });
});
