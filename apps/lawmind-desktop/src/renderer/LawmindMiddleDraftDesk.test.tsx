/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindMiddleDraftDesk } from "./LawmindMiddleDraftDesk";
import {
  clearPendingDraftDesk,
  requestOpenDraftDesk,
} from "./lawmind-open-contract-revision";
import { LAWMIND_OPEN_WORKSPACE_FILE_EVENT } from "./lawmind-workspace-file-open";

vi.mock("./ReviewWorkbench", () => ({
  ReviewWorkbench: (props: { initialTaskId?: string | null }) => (
    <div data-testid="lm-review-stub">{props.initialTaskId}</div>
  ),
}));

describe("LawmindMiddleDraftDesk", () => {
  const hosts: HTMLDivElement[] = [];

  afterEach(() => {
    clearPendingDraftDesk();
    for (const host of hosts.splice(0)) {
      host.remove();
    }
  });

  it("shows the draft after the open event, and a file open dismisses it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<LawmindMiddleDraftDesk apiBase="http://127.0.0.1:9" />);
    });
    expect(host.querySelector("[data-testid='lm-middle-draft-desk']")).toBeNull();
    await act(async () => {
      requestOpenDraftDesk("task-labor");
    });
    expect(host.querySelector("[data-testid='lm-review-stub']")?.textContent).toBe("task-labor");
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, {
          detail: { relPath: "劳动法检索备忘_20261016_01.docx", root: "project" },
        }),
      );
    });
    expect(host.querySelector("[data-testid='lm-middle-draft-desk']")).toBeNull();
    act(() => root.unmount());
  });
});
