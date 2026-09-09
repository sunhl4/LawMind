/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContractFastLaneOpen } from "./lawmind-contract-fast-lane-bus";
import { LawmindDeskWorkPanel } from "./LawmindDeskWorkPanel";

vi.mock("./lawmind-contract-fast-lane-bus", () => ({
  requestContractFastLaneOpen: vi.fn(),
}));

describe("LawmindDeskWorkPanel", () => {
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

  it("opens contract lane when there are no materials", async () => {
    const onFillComposer = vi.fn();
    const onPick = vi.fn();
    await act(async () => {
      root.render(
        <LawmindDeskWorkPanel
          onFillComposer={onFillComposer}
          onOpenWriteMaterials={vi.fn()}
          onPick={onPick}
        />,
      );
    });
    expect(host.textContent).toContain("先附材料，再选流程");
    expect(host.textContent).toContain("合同审查");
    expect(host.textContent).toContain("诉讼文书");
    expect(host.textContent).toContain("谈话整理");
    expect(host.textContent).toContain("函件起草");
    expect(host.textContent).toContain("法律快问");
    expect(host.textContent).toContain("检索研究");
    expect(host.textContent).toContain("写材料");
    const more = host.querySelector('[data-testid="lm-desk-work-more"]') as HTMLDetailsElement;
    expect(more).toBeTruthy();
    expect(more.open).toBe(false);
    expect(host.querySelector('[data-testid="lm-desk-work-litigation"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-period"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-invoice"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-court-sms"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-ip"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-ma"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-family"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-capital"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-governance"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-work-ads"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-empty-open-mail-fast-lane"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-empty-open-automations"]')).toBeTruthy();
    await act(async () => {
      (host.querySelector('[data-testid="lm-desk-work-contract"]') as HTMLButtonElement).click();
    });
    expect(requestContractFastLaneOpen).toHaveBeenCalledWith({ preferCompact: true });
    expect(onPick).toHaveBeenCalled();
  });

  it("locks a process into the composer when materials are already attached", async () => {
    const onFillComposer = vi.fn();
    await act(async () => {
      root.render(
        <LawmindDeskWorkPanel
          onFillComposer={onFillComposer}
          onOpenWriteMaterials={vi.fn()}
          hasMaterials
        />,
      );
    });
    await act(async () => {
      (host.querySelector('[data-testid="lm-desk-work-contract"]') as HTMLButtonElement).click();
    });
    expect(onFillComposer).toHaveBeenCalledWith(expect.stringContaining("【办件】能力：contract.review"));
    await act(async () => {
      (host.querySelector('[data-testid="lm-empty-verb-draft"]') as HTMLButtonElement).click();
    });
    expect(onFillComposer).toHaveBeenCalledWith(expect.stringContaining("【办件】能力：letter.draft"));
  });

  it("renders dashboard summary when apiBase is provided", async () => {
    const dashboardBody = {
      ok: true,
      dashboard: {
        capturedAt: "2026-09-03T10:00:00.000Z",
        items: [],
        totalPendingApprovals: 3,
        totalOverdueTasks: 0,
        todayActivityCount: 8,
        thisWeekFirstPassCount: 2,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(dashboardBody)),
        } as unknown as Response),
      ),
    );

    await act(async () => {
      root.render(
        <LawmindDeskWorkPanel
          onFillComposer={vi.fn()}
          onOpenWriteMaterials={vi.fn()}
          apiBase="http://localhost:9999"
        />,
      );
    });

    expect(host.textContent).toContain("3");
    expect(host.textContent).toContain("项待拍板");
    expect(host.textContent).toContain("8");
    expect(host.textContent).toContain("今日活动");
  });
});
