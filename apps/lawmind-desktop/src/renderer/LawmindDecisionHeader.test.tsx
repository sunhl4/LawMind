/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LawmindDecisionHeader } from "./LawmindDecisionHeader";

describe("LawmindDecisionHeader", () => {
  it("shows the four lawyer lines and 需定夺", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindDecisionHeader
          header={{
            changed: "补全了送达地址",
            why: "与原合同对齐",
            risk: "机械核对仍有 1 项须处理。通过核对 ≠ 法律正确。",
            ready: "needs_decision",
          }}
        />,
      );
    });
    const el = host.querySelector('[data-testid="lm-decision-header"]');
    expect(el?.getAttribute("data-ready")).toBe("needs_decision");
    expect(el?.textContent).toContain("改了什么：补全了送达地址");
    expect(el?.textContent).toContain("为什么：与原合同对齐");
    expect(el?.textContent).toContain("风险：");
    expect(el?.textContent).toContain("需定夺");
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
