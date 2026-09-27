/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { soloEditionFeatures } from "../../../../src/lawmind/policy/edition-features.js";

const editionState = {
  current: {
    edition: "solo" as "solo" | "firm",
    label: "独立律师版",
    source: "default" as const,
    features: { ...soloEditionFeatures() },
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
      features: { ...soloEditionFeatures(), complianceAuditExport: false },
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
    const details = host.querySelector("details.lm-settings-advanced");
    expect(details).toBeTruthy();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(host.textContent).toMatch(/独立律师版/);
  });

  it("Firm shows export actions when compliance is on", async () => {
    editionState.current = {
      ...editionState.current,
      edition: "firm",
      label: "律所协作版",
      features: {
        ...soloEditionFeatures(),
        complianceAuditExport: true,
        auditIntegrityExport: true,
        qualityDashboardJsonExport: true,
      },
    };
    await act(async () => {
      root.render(<LawmindSettingsEdition apiBase="http://127.0.0.1:8765" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/导出合规审计|校验完整性/);
  });
});
