/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MatterWorkbenchTabs } from "./MatterWorkbenchTabs";

describe("MatterWorkbenchTabs", () => {
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

  it("daily matter keeps six lawyer tabs and hides duplicate 台帐/交付", async () => {
    await act(async () => {
      root.render(<MatterWorkbenchTabs panelTab="overview" onSelect={() => {}} />);
    });
    const labels = [...host.querySelectorAll('[role="tab"]')].map((el) => el.textContent);
    expect(labels).toEqual(["概览", "档案", "任务", "时间线", "审查矩阵", "经验"]);
    expect(host.textContent).not.toContain("任务台帐");
    expect(host.textContent).not.toContain("交付记录");
  });

  it("unlinked bucket can still show 台帐/交付", async () => {
    await act(async () => {
      root.render(
        <MatterWorkbenchTabs panelTab="ledger" onSelect={() => {}} showShellOps />,
      );
    });
    expect(host.textContent).toContain("任务台帐");
    expect(host.textContent).toContain("交付记录");
  });
});
