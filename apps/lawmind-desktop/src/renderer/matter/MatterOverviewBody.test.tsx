/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatterOverviewBody } from "./MatterOverviewBody";
import { resetMatterOverviewViewStoreForTest } from "../stores/matter-overview-view-store";
import type { MatterSummary } from "../../../../../src/lawmind/types.ts";
import type { WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";

vi.mock("./useMatterHealthMetrics", () => ({
  useMatterHealthMetrics: () => ({ metrics: null, loading: false, error: null }),
}));

const summary: MatterSummary = {
  headline: "星辉精密诉环宇科技 · 买卖合同纠纷",
  statusLine: "交办",
  keyRisks: ["付款期限争议"],
  nextActions: ["核对买卖合同第 8 条"],
  recentActivity: ["已收起诉状"],
};

const queueItem: WorkQueueItem = {
  queueItemId: "q-1",
  matterId: "xinghui-sale-876",
  kind: "need_lawyer_review",
  status: "open",
  priority: "high",
  title: "核对待审起诉状",
  relatedTaskId: "t-1",
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

function emptyInteraction() {
  return {
    total: 0,
    reviewOpenCount: 0,
    memorySaveCount: 0,
    caseWriteCount: 0,
    dominantActionLabel: "",
    dominantActionHint: "",
    topLabels: [],
  };
}

describe("MatterOverviewBody daily surface", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetMatterOverviewViewStoreForTest();
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

  it("shows 下一步 + 待办, hides duplicate 下一步 card and folded insights", async () => {
    await act(async () => {
      root.render(
        <MatterOverviewBody
          apiBase=""
          matterId="xinghui-sale-876"
          summary={summary}
          profile={null}
          selectedOverview={null}
          showWorkspaceAcceptanceDashboard={false}
          workspaceAcceptance={null}
          workspaceAcceptanceErr={null}
          reviewSummaryCards={[]}
          openReviewFromMatter={() => {}}
          blockingExplanations={[]}
          handleBlockingAction={() => {}}
          queueItems={[]}
          approvalRequests={[]}
          matterInteractionSummary={emptyInteraction()}
          showCrossMatterRoadmap={false}
          convergenceSuggestions={[]}
          handleConvergenceSuggestion={() => {}}
          recentMatterInteractions={[]}
          filteredQueueItems={[queueItem]}
          filteredApprovalRequests={[]}
          filteredDrafts={[]}
          draftCitationByTask={{}}
          acceptanceByTask={{}}
        />,
      );
    });

    expect(host.textContent).toContain("本案下一步");
    expect(host.textContent).toContain("核对买卖合同第 8 条");
    expect(host.textContent).toContain("待办");
    expect(host.textContent).toContain("核对待审起诉状");
    expect(host.textContent).toContain("更多洞察");
    expect(host.querySelector("[data-testid='lm-matter-next-actions']")).not.toBeNull();
    expect(host.querySelectorAll("h3")).toHaveLength(2);
    const headings = [...host.querySelectorAll("h3")].map((el) => el.textContent);
    expect(headings).toEqual(["待办", "工作队列"]);
    expect(host.textContent).not.toContain("关键风险");
    expect(host.textContent).not.toContain("律师行为摘要");
    expect(host.textContent).not.toContain("当前处理视角");
  });

  it("reveals risks only after expanding 更多洞察", async () => {
    await act(async () => {
      root.render(
        <MatterOverviewBody
          apiBase=""
          matterId="xinghui-sale-876"
          summary={summary}
          profile={null}
          selectedOverview={null}
          showWorkspaceAcceptanceDashboard={false}
          workspaceAcceptance={null}
          workspaceAcceptanceErr={null}
          reviewSummaryCards={[]}
          openReviewFromMatter={() => {}}
          blockingExplanations={[]}
          handleBlockingAction={() => {}}
          queueItems={[]}
          approvalRequests={[]}
          matterInteractionSummary={emptyInteraction()}
          showCrossMatterRoadmap={false}
          convergenceSuggestions={[]}
          handleConvergenceSuggestion={() => {}}
          recentMatterInteractions={[]}
          filteredQueueItems={[]}
          filteredApprovalRequests={[]}
          filteredDrafts={[]}
          draftCitationByTask={{}}
          acceptanceByTask={{}}
        />,
      );
    });

    expect(host.textContent).toContain("无待办");
    expect(host.textContent).not.toContain("付款期限争议");

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='lm-matter-overview-more']")?.click();
    });

    expect(host.textContent).toContain("关键风险");
    expect(host.textContent).toContain("付款期限争议");
    expect(host.textContent).toContain("近期进展");
  });
});
