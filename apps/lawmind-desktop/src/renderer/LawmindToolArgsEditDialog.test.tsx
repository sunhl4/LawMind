/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LawmindToolArgsEditDialog } from "./LawmindToolArgsEditDialog";

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
    expect(host.querySelector('[data-document-write="true"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-tool-args-edit-doc-redirect"]')).toBeTruthy();
    expect(host.querySelector('[data-size="compact"]')).toBeTruthy();
    expect(host.textContent).toContain("全文请用「文书台」");
    expect(host.querySelector("h2")?.textContent).toBe("改参数");
    expect(host.querySelector('textarea[aria-label="文书正文"]')).toBeNull();
    expect(host.querySelector('textarea[aria-label="正文"]')).toBeNull();
    expect(host.querySelector('input[aria-label="保存位置"]')).toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-tool-args-edit-approve"]')?.click();
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
    expect(host.querySelector("h2")?.textContent).toBe("改拟稿");
    expect(host.querySelector('[data-document-write="true"]')).toBeNull();
    root.unmount();
    host.remove();
  });
});
