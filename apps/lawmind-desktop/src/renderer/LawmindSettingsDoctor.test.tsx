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
    expect(host.textContent).toContain("推理图覆盖率");
    expect(host.textContent).toContain("75%");
    expect(host.textContent).toContain("需侧车 4 份");
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
    expect(host.textContent).toContain("团队成长 · 内测指标");
    expect(host.textContent).toContain("主力一次过率");
    expect(host.textContent).toContain("50%");
    expect(host.querySelector('[data-testid="lm-doctor-team-growth-baseline"]')).toBeTruthy();
  });
});
