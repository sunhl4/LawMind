/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindMatterHealthCard } from "./LawmindMatterHealthCard";
import type { MatterHealthMetrics } from "../../../../../src/lawmind/metrics/lawyer-dashboard.ts";

function makeMetrics(overrides?: Partial<MatterHealthMetrics>): MatterHealthMetrics {
  return {
    matterId: "m-1",
    lintCoverageRate: 0.25,
    editRate: 0.5,
    firstPassRate: 0.33,
    pendingApprovals: 2,
    overdueTasks: 1,
    lastActivityAt: "2026-09-03T10:00:00.000Z",
    lintTriggerCount: 3,
    lintRuleCount: 12,
    lintFindingCount: 5,
    lawyerEditCount: 4,
    lawyerEditModifiedCount: 2,
    deliverCount: 3,
    deliverFirstPassCount: 1,
    pendingReviewCount: 1,
    phase: "draft",
    ...overrides,
  };
}

describe("LawmindMatterHealthCard", () => {
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

  it("渲染案件名、阶段、待拍板、覆盖率与最近活动", async () => {
    await act(async () => {
      root.render(
        <LawmindMatterHealthCard
          matterId="m-1"
          displayName="测试案件"
          metrics={makeMetrics()}
        />,
      );
    });

    expect(host.textContent).toContain("测试案件");
    expect(host.textContent).toContain("改稿");
    expect(host.textContent).toContain("2 项待拍板");
    expect(host.textContent).toContain("25% 已核对");
    expect(host.textContent).toContain("1 项逾期");
    expect(host.textContent).toContain("最近活动");
  });

  it("无待拍板与逾期时显示正常状态", async () => {
    await act(async () => {
      root.render(
        <LawmindMatterHealthCard
          matterId="m-2"
          metrics={makeMetrics({
            pendingApprovals: 0,
            overdueTasks: 0,
            lintCoverageRate: null,
            lastActivityAt: null,
          })}
        />,
      );
    });

    expect(host.textContent).toContain("无待拍板");
    expect(host.textContent).toContain("未核对");
    expect(host.textContent).not.toContain("项逾期");
  });

  it("点击触发 onClick", async () => {
    const onClick = vi.fn();
    await act(async () => {
      root.render(
        <LawmindMatterHealthCard
          matterId="m-1"
          displayName="可点击案件"
          metrics={makeMetrics()}
          onClick={onClick}
        />,
      );
    });

    const card = host.querySelector('[data-testid="lm-matter-health-card"]');
    expect(card).not.toBeNull();
    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
