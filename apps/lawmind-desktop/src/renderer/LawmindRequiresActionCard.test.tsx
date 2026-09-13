/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LawmindRequiresActionCard } from "./LawmindRequiresActionCard";
import type { LawMindRequiresAction } from "./lawmind-requires-action";

function mailAction(extra: Partial<LawMindRequiresAction> = {}): LawMindRequiresAction {
  return {
    id: "a1",
    kind: "tool_approval",
    threadId: "m:t:s",
    title: "待批准：发送邮件",
    summary: "拟进行「发送邮件」。",
    toolName: "send_email",
    decisions: ["approve", "reject"],
    createdAt: "2026-08-30T00:00:00.000Z",
    recommendation: "先核对收件人再发",
    readyToUse: false,
    ...extra,
  };
}

describe("LawmindRequiresActionCard", () => {
  it("shows 建议 and keeps approve/reject when recommendation is present", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await act(async () => {
      root.render(<LawmindRequiresActionCard actions={[mailAction()]} />);
    });
    expect(host.querySelector('[data-testid="lm-requires-action-recommendation"]')?.textContent).toContain(
      "建议：先核对收件人再发",
    );
    expect(host.textContent).toContain("批准并继续");
    expect(host.textContent).toContain("暂不办理");
    const copy = host.querySelector(
      '[data-testid="lm-requires-action-recommendation-copy"]',
    ) as HTMLButtonElement;
    await act(async () => {
      copy.click();
    });
    expect(writeText).toHaveBeenCalledWith("先核对收件人再发");
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("hides the recommendation row when absent", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindRequiresActionCard
          actions={[mailAction({ recommendation: undefined, toolName: "render_document" })]}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-requires-action-recommendation"]')).toBeNull();
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("offers once/session/always for host file grants", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onApproveToolEdit = vi.fn();
    await act(async () => {
      root.render(
        <LawmindRequiresActionCard
          actions={[
            mailAction({
              toolName: "read_host_file",
              title: "待批准：阅读本机文件",
              summary: "拟进行「阅读本机文件」。",
              recommendation: undefined,
              toolArgs: { hit_id: "hit-1" },
            }),
          ]}
          onApproveToolEdit={onApproveToolEdit}
        />,
      );
    });
    expect(host.textContent).toContain("允许一次");
    expect(host.textContent).toContain("本会话允许");
    expect(host.textContent).toContain("始终允许");
    const session = host.querySelector('[data-testid="lm-host-grant-session"]') as HTMLButtonElement;
    await act(async () => {
      session.click();
    });
    expect(onApproveToolEdit).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "read_host_file" }),
      { hit_id: "hit-1", grant_duration: "session" },
    );
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
