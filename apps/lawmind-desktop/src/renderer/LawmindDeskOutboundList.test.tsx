/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindDeskOutboundList } from "./LawmindDeskOutboundList";

const revealDeliverableInFolder = vi.fn(async (..._args: unknown[]) => ({ ok: true as const }));
const openDeliverableInWps = vi.fn(async (..._args: unknown[]) => ({ ok: true as const }));
const openDocxInReviewSurface = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("./canvas/host-actions", () => ({
  openDeliverableInWps: (...args: unknown[]) => openDeliverableInWps(...args),
  revealDeliverableInFolder: (...args: unknown[]) => revealDeliverableInFolder(...args),
}));

vi.mock("./lawmind-open-contract-revision", () => ({
  openDocxInReviewSurface: (...args: unknown[]) => openDocxInReviewSurface(...args),
}));

describe("LawmindDeskOutboundList", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    revealDeliverableInFolder.mockClear();
    openDeliverableInWps.mockClear();
    openDocxInReviewSurface.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("lets the lawyer preview an attachment in the middle column or show it in Finder", async () => {
    await act(async () => {
      root.render(
        <LawmindDeskOutboundList
          apiBase="http://127.0.0.1:9"
          items={[
            {
              source: "inbox",
              id: "mail-1",
              matterId: "m1",
              title: "待发出",
              to: "a@b.com",
              subject: "审阅稿",
              attachments: ["cases/m1/函.docx"],
            },
          ]}
          onChanged={() => undefined}
        />,
      );
    });
    expect(host.querySelector("[data-testid='lm-desk-outbound-preview']")?.textContent).toContain(
      "预览核对",
    );
    expect(host.querySelector("[data-testid='lm-desk-outbound-reveal']")?.textContent).toContain(
      "在访达中显示",
    );
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='lm-desk-outbound-reveal']")?.click();
    });
    expect(revealDeliverableInFolder).toHaveBeenCalledWith("cases/m1/函.docx");
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='lm-desk-outbound-preview']")?.click();
    });
    expect(openDocxInReviewSurface).toHaveBeenCalledWith({
      relPath: "cases/m1/函.docx",
      apiBase: "http://127.0.0.1:9",
      workspaceDir: undefined,
    });
  });
});
