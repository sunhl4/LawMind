/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LawmindReviewDeliveryBar } from "./LawmindReviewDeliveryBar";

describe("LawmindReviewDeliveryBar", () => {
  it("writing variant routes signoff to 在办 and hides 通过/驳回/需修改", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onOpenAgentsDesk = vi.fn();
    await act(async () => {
      root.render(
        <LawmindReviewDeliveryBar
          reviewStatus="pending"
          acceptance={null}
          actionBusy={false}
          onApprove={() => undefined}
          onReject={() => undefined}
          onModify={() => undefined}
          onReopen={() => undefined}
          onExportWord={() => undefined}
          variant="writing"
          onOpenAgentsDesk={onOpenAgentsDesk}
        />,
      );
    });
    expect(host.textContent).toContain("回到在办签批");
    expect(host.textContent).toContain("改稿、批注并预览");
    const labels = Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(labels).not.toContain("通过");
    expect(labels).not.toContain("驳回");
    expect(labels).not.toContain("需修改");
    const back = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("回到在办签批"),
    );
    expect(back).toBeTruthy();
    await act(async () => {
      back?.click();
    });
    expect(onOpenAgentsDesk).toHaveBeenCalledTimes(1);
    root.unmount();
    host.remove();
  });

  it("signoff variant keeps 通过/驳回/需修改", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindReviewDeliveryBar
          reviewStatus="pending"
          acceptance={null}
          actionBusy={false}
          onApprove={() => undefined}
          onReject={() => undefined}
          onModify={() => undefined}
          onReopen={() => undefined}
          onExportWord={() => undefined}
          variant="signoff"
        />,
      );
    });
    const labels = Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(labels).toContain("通过");
    expect(labels).toContain("驳回");
    expect(labels).toContain("需修改");
    root.unmount();
    host.remove();
  });
});
