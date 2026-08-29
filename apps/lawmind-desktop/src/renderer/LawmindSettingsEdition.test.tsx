/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const editionState = {
  current: {
    edition: "solo" as "solo" | "firm",
    label: "独立律师版",
    source: "default" as const,
    features: {
      acceptanceGateStrict: true,
      citationGateStrict: true,
      crossMatterRoadmap: false,
      crossMatterAcceptanceDashboard: false,
      collaborationSummary: false,
      complianceAuditExport: false,
      auditIntegrityExport: false,
      securitySbomPanel: false,
      qualityDashboardJsonExport: false,
      customDeliverableSpec: false,
      acceptancePackExport: false,
      strictDangerousToolApproval: false,
      reviewCampaignParallel: true,
      forcePeerReview: false,
    },
    citationMode: "assisted" as const,
    loading: false,
  },
};

vi.mock("./use-edition", () => ({
  useEdition: () => editionState.current,
}));

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async () => ({ ok: true, specs: [] })),
  errorMessage: (e: unknown, f: string) => (e instanceof Error ? e.message : f),
}));

vi.mock("./lawmind-api-auth", () => ({
  apiAuthHeaders: () => ({}),
}));

import { LawmindSettingsEdition } from "./LawmindSettingsEdition";

describe("LawmindSettingsEdition", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    editionState.current = {
      ...editionState.current,
      edition: "solo",
      label: "独立律师版",
      features: { ...editionState.current.features, complianceAuditExport: false },
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("Solo keeps matrix inside a single collapsed admin details", async () => {
    await act(async () => {
      root.render(<LawmindSettingsEdition apiBase="http://127.0.0.1:8765" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("独立律师版");
    const admin = host.querySelector('[data-testid="lm-edition-admin"]') as HTMLDetailsElement | null;
    expect(admin?.tagName).toBe("DETAILS");
    expect(admin?.open).toBe(false);
    expect(admin?.textContent).toContain("本版能力");
    expect(admin?.textContent).toContain("可用文书类型");
  });

  it("Firm shows admin body without requiring details wrapper", async () => {
    editionState.current = {
      ...editionState.current,
      edition: "firm",
      label: "律所版",
    };
    await act(async () => {
      root.render(<LawmindSettingsEdition apiBase="http://127.0.0.1:8765" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const admin = host.querySelector('[data-testid="lm-edition-admin"]');
    expect(admin?.tagName).toBe("DIV");
    expect(host.textContent).toContain("本版能力一览");
  });
});
