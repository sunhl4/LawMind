/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindDeskDashboardSummary } from "./LawmindDeskDashboardSummary";
import type { LawyerDeskDashboard } from "../../../../src/lawmind/metrics/lawyer-dashboard.ts";

function makeDashboard(): LawyerDeskDashboard {
  return {
    capturedAt: "2026-09-03T10:00:00.000Z",
    items: [],
    totalPendingApprovals: 5,
    totalOverdueTasks: 2,
    todayActivityCount: 12,
    thisWeekFirstPassCount: 3,
  };
}

describe("LawmindDeskDashboardSummary", () => {
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

  it("渲染汇总指标", async () => {
    await act(async () => {
      root.render(<LawmindDeskDashboardSummary dashboard={makeDashboard()} />);
    });

    expect(host.textContent).toContain("5");
    expect(host.textContent).toContain("项待拍板");
    expect(host.textContent).toContain("12");
    expect(host.textContent).toContain("今日活动");
    expect(host.textContent).toContain("3");
    expect(host.textContent).toContain("本周一次过");
    expect(host.textContent).toContain("2");
    expect(host.textContent).toContain("项逾期");
  });

  it("加载状态显示占位", async () => {
    await act(async () => {
      root.render(<LawmindDeskDashboardSummary dashboard={null} loading />);
    });
    expect(host.textContent).toContain("仪表盘加载中");
  });

  it("无数据时不渲染", async () => {
    await act(async () => {
      root.render(<LawmindDeskDashboardSummary dashboard={null} />);
    });
    expect(host.textContent).toBe("");
  });
});
