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
    expect(host.textContent).toContain("函件起草");
    expect(host.textContent).toContain("检索研究");
    expect(host.textContent).toContain("写材料");
    const more = host.querySelector('[data-testid="lm-desk-work-more"]') as HTMLDetailsElement;
    expect(more).toBeTruthy();
    expect(more.open).toBe(false);
    expect(host.querySelector('[data-testid="lm-desk-work-litigation"]')).toBeTruthy();
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
});
