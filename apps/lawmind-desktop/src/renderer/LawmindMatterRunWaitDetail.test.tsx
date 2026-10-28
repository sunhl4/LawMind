/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindMatterRunWaitDetail } from "./LawmindMatterRunWaitDetail";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";

type Wait = NonNullable<AgentRunSummary["matterRunWait"]>;

function wait(patch: Partial<Wait> = {}): Wait {
  return {
    runId: "run_wait",
    stepId: "s1",
    reason: "court_filing",
    stepTitle: "等法院立案",
    dueAt: "2026-10-28T00:00:00.000Z",
    escalatedAt: "2026-10-29T00:00:00.000Z",
    ...patch,
  };
}

describe("LawmindMatterRunWaitDetail", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(props: Partial<React.ComponentProps<typeof LawmindMatterRunWaitDetail>> = {}) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onExtend = vi.fn();
    const onSkip = vi.fn();
    act(() => {
      root.render(
        <LawmindMatterRunWaitDetail
          wait={wait()}
          title="等法院立案"
          onExtend={onExtend}
          onSkip={onSkip}
          {...props}
        />,
      );
    });
    return { onExtend, onSkip };
  }

  it("shows what the step is waiting for and both decisions", () => {
    const { onExtend, onSkip } = render();
    expect(host.textContent).toContain("等法院文书");
    expect(host.textContent).toContain("等法院立案");
    expect(host.textContent).toContain("原定到期");
    expect(host.querySelector('[data-testid="lm-matter-wait-extend"]')?.textContent).toContain(
      "再等 3 天",
    );

    act(() => {
      (host.querySelector('[data-testid="lm-matter-wait-extend"]') as HTMLButtonElement).click();
    });
    expect(onExtend).toHaveBeenCalledTimes(1);

    act(() => {
      (host.querySelector('[data-testid="lm-matter-wait-skip"]') as HTMLButtonElement).click();
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("disables both decisions while a request is in flight", () => {
    render({ busy: true });
    const extend = host.querySelector('[data-testid="lm-matter-wait-extend"]') as HTMLButtonElement;
    const skip = host.querySelector('[data-testid="lm-matter-wait-skip"]') as HTMLButtonElement;
    expect(extend.disabled).toBe(true);
    expect(skip.disabled).toBe(true);
  });

  it("lists the run's steps with status and attempts", () => {
    render({
      wait: wait({
        steps: [
          { stepId: "wait_job", title: "等待后台工作流完成", status: "done", attempts: 1 },
          { stepId: "collect", title: "收集本次产出的草稿", status: "waiting", attempts: 2 },
          { stepId: "render", title: "补齐未导出的稿子", status: "failed", attempts: 1 },
        ],
      }),
    });
    expect(host.querySelector('[data-testid="lm-matter-wait-steps"]')).toBeTruthy();
    expect(host.textContent).toContain("等待后台工作流完成");
    expect(host.textContent).toContain("已完成");
    expect(host.textContent).toContain("收集本次产出的草稿");
    expect(host.textContent).toContain("等待中");
    expect(host.textContent).toContain("第 2 次");
    expect(host.textContent).toContain("失败");
  });

  it("falls back to a hint when the row carries no wait payload", () => {
    render({ wait: null });
    expect(host.textContent).toContain("到期没等到");
    expect(host.querySelector('[data-testid="lm-matter-wait-extend"]')).toBeNull();
  });
});
