/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { LawmindGlobalSearch } from "./LawmindGlobalSearch";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async () => ({ ok: true, matters: [], sessions: [], today: { items: [] } })),
}));
vi.mock("./lawmind-requires-action", () => ({
  loadActionSummary: vi.fn(async () => ({ automationInbox: [], toolApprovals: [] })),
}));

describe("LawmindGlobalSearch", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows command section when open with empty query", async () => {
    await act(async () => {
      root.render(
        <LawmindGlobalSearch
          open
          onClose={() => undefined}
          apiBase="http://127.0.0.1:9"
          actions={[{ id: "x", slash: "/desk", label: "工作台", run: () => undefined }]}
          onOpenMatterDossier={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="lm-global-search"]')).toBeTruthy();
    expect(host.textContent).toContain("命令");
    expect(host.textContent).toContain("工作台");
  });

  it("highlights the first command and Enter runs it", async () => {
    const run = vi.fn();
    await act(async () => {
      root.render(
        <LawmindGlobalSearch
          open
          onClose={() => undefined}
          apiBase="http://127.0.0.1:9"
          actions={[{ id: "x", slash: "/desk", label: "工作台", run }]}
          onOpenMatterDossier={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("工作台");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
