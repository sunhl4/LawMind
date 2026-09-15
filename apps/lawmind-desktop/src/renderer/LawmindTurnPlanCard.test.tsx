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

  it("plan mode lets the lawyer skip a step before execute", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const edits: string[] = [];
    await act(async () => {
      root.render(
        <LawmindTurnPlanCard plan={plan} editable onLawyerEditPlan={(t) => edits.push(t)} />,
      );
    });
    expect(host.querySelector("[data-testid='lm-turn-plan']")?.getAttribute("data-editable")).toBe(
      "true",
    );
    expect(host.textContent).toContain("计划（可改）");
    const skip = host.querySelector("[data-testid='lm-turn-plan-include-1']") as HTMLInputElement;
    expect(skip.checked).toBe(true);
    await act(async () => {
      skip.click();
    });
    expect(edits.at(-1)).toContain("已跳过：标风险条款");
    expect(edits.at(-1)).toContain("读钉选合同");
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("plan mode lets the lawyer edit step text before execute", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const edits: string[] = [];
    await act(async () => {
      root.render(
        <LawmindTurnPlanCard plan={plan} editable onLawyerEditPlan={(t) => edits.push(t)} />,
      );
    });
    const field = host.querySelector("[data-testid='lm-turn-plan-edit-1']") as HTMLInputElement;
    expect(field.value).toBe("标风险条款");
    await act(async () => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      desc?.set?.call(field, "先标管辖条款");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(edits.at(-1)).toContain("先标管辖条款");
    expect(edits.at(-1)).toContain("读钉选合同");
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
