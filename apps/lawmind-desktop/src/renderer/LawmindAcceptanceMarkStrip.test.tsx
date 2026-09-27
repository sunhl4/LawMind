/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAcceptanceSheet } from "../../../../src/lawmind/acceptance-sheet/model.ts";
import type { ResearchBundle } from "../../../../src/lawmind/types.ts";
import { LawmindAcceptanceMarkStrip } from "./LawmindAcceptanceMarkStrip";

const bundle: ResearchBundle = {
  taskId: "task-1",
  query: "违约金",
  sources: [{ id: "src-1", title: "合同", kind: "contract", citation: "第 8 条", url: "cases/m/合同.pdf" }],
  claims: [
    {
      text: "违约金为百分之二十。",
      sourceIds: ["src-1"],
      confidence: 0.8,
      model: "legal",
    },
  ],
  riskFlags: [],
  missingItems: [],
  requiresReview: true,
  completedAt: "2026-09-27T00:00:00.000Z",
};

const sheet = buildAcceptanceSheet({
  taskId: "task-1",
  bundle,
  marks: {},
});
if (sheet) {
  sheet.claims[0].mark = "accepted";
}

const apiGetJson = vi.hoisted(() => vi.fn());

vi.mock("./api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
}));

describe("LawmindAcceptanceMarkStrip", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    apiGetJson.mockReset();
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

  it("shows sentences the lawyer already accepted", async () => {
    apiGetJson.mockResolvedValue({ ok: true, sheet });
    await act(async () => {
      root.render(<LawmindAcceptanceMarkStrip apiBase="http://127.0.0.1:9" taskId="task-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("已采信 1 条");
    expect(host.textContent).toContain("违约金为百分之二十。");
  });

  it("stays quiet when nothing was marked", async () => {
    apiGetJson.mockResolvedValue({ ok: true, sheet: null });
    await act(async () => {
      root.render(<LawmindAcceptanceMarkStrip apiBase="http://127.0.0.1:9" taskId="task-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='lm-acceptance-marks']")).toBeNull();
  });

  it("shows the sentence that was sent back as too strong", async () => {
    const returned = sheet
      ? {
          ...sheet,
          claims: sheet.claims.map((claim) => ({ ...claim, mark: "too_strong" as const })),
        }
      : null;
    apiGetJson.mockResolvedValue({ ok: true, sheet: returned });
    await act(async () => {
      root.render(<LawmindAcceptanceMarkStrip apiBase="http://127.0.0.1:9" taskId="task-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("已退回改弱 1 条");
    expect(host.textContent).toContain("违约金为百分之二十。");
  });
});
