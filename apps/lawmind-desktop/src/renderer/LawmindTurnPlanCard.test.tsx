/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LawmindTurnPlanCard } from "./LawmindTurnPlanCard";
import type { AgentTurnPlan } from "../../../../src/lawmind/agent/turn-plan-model.ts";

const plan: AgentTurnPlan = {
  items: [
    { step: "读钉选合同", status: "completed" },
    { step: "标风险条款", status: "in_progress" },
    { step: "给出修订建议", status: "pending" },
  ],
  updatedAt: "2026-09-13T00:00:00.000Z",
};

describe("LawmindTurnPlanCard", () => {
  it("shows a lawyer-facing checklist with progress", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<LawmindTurnPlanCard plan={plan} />);
    });
    expect(host.querySelector("[data-testid='lm-turn-plan']")?.textContent).toContain("本轮步骤");
    expect(host.textContent).toContain("1/3");
    expect(host.textContent).toContain("读钉选合同");
    expect(host.textContent).toContain("标风险条款");
    expect(host.querySelector("[aria-current='step']")?.textContent).toContain("标风险条款");
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
