/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingView } from "./MeetingView";

vi.mock("../MatterTeamMeetingPanel", () => ({
  MatterTeamMeetingPanel: () => <div data-testid="lm-meeting-panel-stub">panel</div>,
}));

describe("MeetingView", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
  });

  it("renders page-owned scope groups without a page materials rail", async () => {
    await act(async () => {
      root.render(
        <MeetingView
          config={{ apiBase: "http://127.0.0.1:9", projectDir: "/tmp" } as never}
          shellAssistantId="default"
          matterOptions={[
            { id: "case-a", title: "甲案" },
            { id: "case-b", title: "乙案" },
          ]}
        />,
      );
    });

    expect(host.querySelector(".lm-meeting-wb-bar")).toBeNull();
    expect(host.querySelector('[data-testid="lm-meeting-materials-host"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-meeting-group-adhoc"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-meeting-group-matter"]')).toBeTruthy();
    expect(host.textContent).toContain("临时讨论");
    expect(host.textContent).toContain("案件会议");
  });

  it("selecting a matter row notifies shell scope", async () => {
    const onSelectMatterScope = vi.fn();
    await act(async () => {
      root.render(
        <MeetingView
          config={{ apiBase: "http://127.0.0.1:9", projectDir: "/tmp" } as never}
          shellAssistantId="default"
          matterOptions={[{ id: "case-a", title: "甲案" }]}
          onSelectMatterScope={onSelectMatterScope}
        />,
      );
    });

    const matterToggle = host.querySelector(
      '[data-testid="lm-meeting-group-matter"]',
    ) as HTMLButtonElement;
    await act(async () => {
      matterToggle.click();
    });

    const row = host.querySelector(
      '[data-testid="lm-meeting-scope-matter-case-a"]',
    ) as HTMLButtonElement;
    await act(async () => {
      row.click();
    });
    expect(onSelectMatterScope).toHaveBeenCalledWith("case-a");
  });
});
