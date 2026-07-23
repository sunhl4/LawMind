/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CLARIFY_ATTACHMENTS_KEY } from "../../../../src/lawmind/platform/clarification-fields.ts";
import { LawmindClarificationForm } from "./LawmindClarificationForm";

describe("LawmindClarificationForm", () => {
  it("desk variant uses compact textarea and shows attachments strip", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <LawmindClarificationForm
          formKey="t1"
          variant="desk"
          questions={[
            { key: "name", question: "当事人？", inputType: "text" },
            {
              key: "court",
              question: "管辖？",
              inputType: "enum",
              options: ["北京", "上海"],
            },
          ]}
          onSubmitAnswers={onSubmit}
        />,
      );
    });
    expect(host.querySelector('[data-variant="desk"]')).toBeTruthy();
    expect(host.querySelector(".lm-clarify-stack")).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-clarify-attachments"]')).toBeTruthy();
    const nameInput = host.querySelector(
      'textarea[aria-label="当事人？"]',
    ) as HTMLTextAreaElement;
    expect(nameInput).toBeTruthy();
    expect(nameInput.rows).toBeLessThanOrEqual(4);
    expect(nameInput.className).toContain("lm-clarify-field-input--compact");
    const select = host.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      const proto = window.HTMLTextAreaElement.prototype;
      const native = Object.getOwnPropertyDescriptor(proto, "value");
      native?.set?.call(nameInput, "甲公司");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      const selNative = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
      selNative?.set?.call(select, "北京");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-clarify-submit"]')?.click();
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "甲公司", court: "北京" }),
    );
    root.unmount();
    host.remove();
  });

  it("file field encodes workspace pin", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onSubmit = vi.fn();
    const encoded = "【材料】workspace:file:evidence/a.pdf";
    await act(async () => {
      root.render(
        <LawmindClarificationForm
          formKey="t2"
          variant="desk"
          questions={[{ key: "scan", question: "扫描件", inputType: "file", required: true }]}
          values={{ scan: encoded }}
          onSubmitAnswers={onSubmit}
        />,
      );
    });
    expect(host.textContent).toContain("evidence/a.pdf");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-clarify-submit"]')?.click();
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        scan: encoded,
      }),
    );
    root.unmount();
    host.remove();
  });

  it("attachments strip shows chips from reserved draft key", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindClarificationForm
          formKey="t3"
          variant="desk"
          questions={[{ key: "note", question: "说明", inputType: "text", required: false }]}
          values={{
            note: "",
            [CLARIFY_ATTACHMENTS_KEY]: "【材料】workspace:file:evidence/b.pdf",
          }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-clarify-attachments"]')).toBeTruthy();
    expect(host.textContent).toContain("evidence/b.pdf");
    expect(host.textContent).toContain("文件");
    root.unmount();
    host.remove();
  });
});
