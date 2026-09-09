/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewCampaign } from "./lawmind-review-campaign-api";
import { LawmindReviewCampaignPanel } from "./LawmindReviewCampaignPanel";
import type { MatterHealthMetrics } from "../../../../src/lawmind/metrics/lawyer-dashboard.ts";

vi.mock("./use-edition", () => ({
  useEdition: () => ({ loading: false, features: { reviewCampaignParallel: false } }),
}));

vi.mock("./matter/useMatterHealthMetrics", () => ({
  useMatterHealthMetrics: () => ({
    metrics: {
      lintTriggerCount: 4,
      lintFindingCount: 7,
      lawyerEditModifiedCount: 2,
    } satisfies Partial<MatterHealthMetrics>,
    loading: false,
    error: null,
  }),
}));

function makeCampaign(): ReviewCampaign {
  return {
    id: "c-1",
    matterId: "m-1",
    taskId: "t-1",
    playbookId: "standard-contract-review",
    playbookLabel: "标准合同审查",
    status: "completed",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T11:00:00.000Z",
    roles: [
      {
        roleId: "clause",
        label: "条款",
        status: "done",
        weight: 1,
        score: 80,
        findings: [
          { severity: "medium", title: "定义缺失", detail: "缺少定义条款" },
          { severity: "low", title: "结构偏简", detail: "条款编号较少" },
        ],
      },
      {
        roleId: "risk",
        label: "风险",
        status: "done",
        weight: 1,
        score: 70,
        findings: [{ severity: "high", title: "定金上限", detail: "超过法定上限" }],
      },
    ],
    safetyScore: { score: 75, high: 1, medium: 1, low: 1, negotiatePriority: [], computedAt: "2026-09-01T10:00:00.000Z" },
  };
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true })),
      } as unknown as Response),
    ),
  );
}

describe("LawmindReviewCampaignPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    stubFetch();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("不展示启发式 Safety Score，显示真实核对指标", async () => {
    await act(async () => {
      root.render(
        <LawmindReviewCampaignPanel
          apiBase="http://localhost:9999"
          taskId="t-1"
          matterId="m-1"
          campaign={makeCampaign()}
          onCampaignChange={vi.fn()}
        />,
      );
    });

    expect(host.textContent).not.toContain("Safety Score");
    expect(host.textContent).not.toContain("/ 100");
    expect(host.querySelector('[data-testid="lm-safety-score"]')).toBeNull();

    expect(host.textContent).toContain("覆盖 4 条规则");
    expect(host.textContent).toContain("发现 7 处问题");
    expect(host.textContent).toContain("已处理 2 处");

    // 保留 severity 计数作为参考
    expect(host.textContent).toContain("高 1");
    expect(host.textContent).toContain("中 1");
    expect(host.textContent).toContain("低 1");
  });
});
