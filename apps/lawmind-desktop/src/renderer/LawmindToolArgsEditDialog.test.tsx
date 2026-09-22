/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindToolArgsEditDialog } from "./LawmindToolArgsEditDialog";

afterEach(() => {
  document.body.querySelectorAll('[data-testid="lm-tool-args-edit-backdrop"]').forEach((el) => {
    el.remove();
  });
});

describe("LawmindToolArgsEditDialog", () => {
  it("document write does not expose full content editor and keeps original content", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onApprove = vi.fn();
    const original = "# 原文\n\n不可在此改的长正文";
    await act(async () => {
      root.render(
        <LawmindToolArgsEditDialog
          open
          toolArgs={{
            file_path: "drafts/demo.md",
            content: original,
            title: "demo",
          }}
          onCancel={() => undefined}
          onApprove={onApprove}
        />,
      );
    });
    // 弹层经 createPortal 挂到 document.body（消息行 contentVisibility 会裁剪行内弹层）。
    expect(document.body.querySelector('[data-document-write="true"]')).toBeTruthy();
    expect(
      document.body.querySelector('[data-testid="lm-tool-args-edit-doc-redirect"]'),
    ).toBeTruthy();
    expect(document.body.querySelector('[data-size="compact"]')).toBeTruthy();
    expect(document.body.textContent).toContain("短字段；全文请改稿");
    expect(
      document.body.querySelector('[data-testid="lm-tool-args-edit-dialog"] h2')?.textContent,
    ).toBe("改参数");
    expect(document.body.querySelector('textarea[aria-label="文书正文"]')).toBeNull();
    expect(document.body.querySelector('textarea[aria-label="正文"]')).toBeNull();
    expect(document.body.querySelector('input[aria-label="保存位置"]')).toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="lm-tool-args-edit-approve"]')
        ?.click();
    });
    expect(onApprove).toHaveBeenCalledWith(
      expect.objectContaining({
        content: original,
        file_path: "drafts/demo.md",
        title: "demo",
      }),
    );
    root.unmount();
    host.remove();
  });

  it("short-field edit still titled 改拟稿", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindToolArgsEditDialog
          open
          toolArgs={{ workflowId: "nda" }}
          onCancel={() => undefined}
          onApprove={() => undefined}
        />,
      );
    });
    expect(
      document.body.querySelector('[data-testid="lm-tool-args-edit-dialog"] h2')?.textContent,
    ).toBe("改拟稿");
    expect(document.body.querySelector('[data-document-write="true"]')).toBeNull();
    root.unmount();
    host.remove();
  });
});
