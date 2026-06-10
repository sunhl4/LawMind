/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import { LawmindAcceptanceGate } from "./LawmindAcceptanceGate";

function sampleReport(overrides: Partial<AcceptanceReport> = {}): AcceptanceReport {
  return {
    taskId: "task-1",
    deliverableType: "contract.review",
    ready: false,
    checks: [
      {
        key: "citations",
        label: "引用完整性",
        passed: false,
        severity: "blocker",
        hint: "缺少来源锚点",
      },
    ],
    blockerCount: 1,
    warningCount: 0,
    placeholderCount: 0,
    placeholderSamples: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("LawmindAcceptanceGate", () => {
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

  it("shows ready summary when report.ready", async () => {
    await act(async () => {
      root.render(<LawmindAcceptanceGate report={sampleReport({ ready: true, blockerCount: 0 })} />);
    });
    expect(host.querySelector("#lm-review-acceptance-gate")?.textContent).toContain("已通过");
  });

  it("shows blocker copy and invokes onGoFillInChat", async () => {
    const onGoFillInChat = vi.fn();
    await act(async () => {
      root.render(
        <LawmindAcceptanceGate
          report={sampleReport()}
          defaultCollapsed={false}
          onGoFillInChat={onGoFillInChat}
        />,
      );
    });
    expect(host.textContent).toContain("未通过");
    expect(host.textContent).toContain("引用完整性");
    const btn = host.querySelector("button");
    expect(btn?.textContent).toContain("去对话补充");
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onGoFillInChat).toHaveBeenCalledOnce();
  });
});
