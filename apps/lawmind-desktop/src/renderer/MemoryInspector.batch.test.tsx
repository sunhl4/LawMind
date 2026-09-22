/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchApiJsonMock = vi.fn();

vi.mock("./api-client-proxy.ts", () => ({
  fetchApiJson: (...args: unknown[]) => fetchApiJsonMock(...args),
}));

vi.mock("./LawmindMemoryTruthSources.js", () => ({
  LawmindMemoryTruthSources: () => null,
}));

import MemoryInspector from "./MemoryInspector.js";

const pendingItems = [
  {
    id: "s1",
    createdAt: "2026-09-20T00:00:00.000Z",
    state: "pending",
    scope: "lawyer",
    kind: "lawyer.profile_learning",
    payload: "风格：结论前置",
    origin: "engine",
  },
  {
    id: "s2",
    createdAt: "2026-09-19T00:00:00.000Z",
    state: "pending",
    scope: "firm",
    kind: "firm.preference",
    payload: "所内惯例：先票后款",
    origin: "engine",
  },
];

const batchPlan = {
  ok: true,
  applied: false,
  plan: {
    items: [
      {
        id: "s1",
        kind: "lawyer.profile_learning",
        scope: "lawyer",
        summary: "风格：结论前置",
        lowRiskStyle: true,
        preview: { changed: true, afterCharCount: 120, hunkCount: 2, targetPath: "LAWYER_PROFILE.md" },
      },
      {
        id: "s2",
        kind: "firm.preference",
        scope: "firm",
        summary: "所内惯例：先票后款",
        lowRiskStyle: true,
        preview: { changed: true, afterCharCount: 90, hunkCount: 1, targetPath: "FIRM_PROFILE.md" },
      },
    ],
    adoptableIds: ["s1", "s2"],
    note: "预览 2 条；确认后一次写入 2 条，未确认的一条都不写。",
  },
};

function jsonResponse(body: unknown) {
  return Promise.resolve(body);
}

describe("MemoryInspector · 批量采纳", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    fetchApiJsonMock.mockReset();
    fetchApiJsonMock.mockImplementation((url: string, init?: { body?: string }) => {
      if (url.includes("/api/memory/adoption/adopt-batch")) {
        const wanted = JSON.parse(init?.body ?? "{}") as { dryRun?: boolean };
        return jsonResponse(
          wanted.dryRun === false
            ? { ok: true, applied: true, result: { adopted: ["s1", "s2"], failed: [] } }
            : batchPlan,
        );
      }
      return jsonResponse({ ok: true, items: pendingItems });
    });
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

  async function render() {
    await act(async () => {
      root.render(<MemoryInspector baseUrl="http://127.0.0.1:1" />);
    });
  }

  function buttonByTestId(id: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("data-testid") === id,
    );
  }

  it("预览不发写入请求，确认后才一次落盘", async () => {
    await render();
    expect(host.textContent).toContain("风格：结论前置");

    const preview = buttonByTestId("lm-memory-batch-preview");
    expect(preview).toBeTruthy();
    await act(async () => {
      preview?.click();
    });

    // 预览文案可见，且这一步没有发 dryRun=false
    expect(host.textContent).toContain("确认后一次写入 2 条");
    const batchCalls = fetchApiJsonMock.mock.calls.filter((c) =>
      String(c[0]).includes("adopt-batch"),
    );
    expect(batchCalls).toHaveLength(1);
    const firstBatchBody = (batchCalls[0]?.[1] as { body?: string } | undefined)?.body ?? "{}";
    expect(JSON.parse(firstBatchBody)).toMatchObject({
      dryRun: true,
    });

    const confirm = buttonByTestId("lm-memory-batch-confirm");
    expect(confirm?.textContent).toContain("确认采纳 2 条");
    await act(async () => {
      confirm?.click();
    });

    const afterConfirm = fetchApiJsonMock.mock.calls
      .filter((c) => String(c[0]).includes("adopt-batch"))
      .map((c) => JSON.parse((c[1] as { body?: string }).body ?? "{}"));
    expect(afterConfirm).toHaveLength(2);
    expect(afterConfirm[1]).toMatchObject({ dryRun: false, mode: "low_risk_style" });
  });

  it("没有待确认项时不提供批量入口", async () => {
    fetchApiJsonMock.mockImplementation((url: string) => {
      if (url.includes("adopt-batch")) {
        return jsonResponse(batchPlan);
      }
      return jsonResponse({ ok: true, items: [] });
    });
    await render();
    const preview = buttonByTestId("lm-memory-batch-preview");
    expect(preview?.disabled).toBe(true);
  });
});
