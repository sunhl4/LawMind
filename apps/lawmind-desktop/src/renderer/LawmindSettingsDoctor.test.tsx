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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
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
    expect(host.textContent).toContain("Legal Reasoning Graph");
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
});
