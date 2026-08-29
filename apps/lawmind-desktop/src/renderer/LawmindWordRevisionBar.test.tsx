/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertWordRevisionMarkers } from "../../../../src/lawmind/platform/word-revision-checklist.ts";
import { LawmindWordRevisionBar, shouldShowWordRevisionBar } from "./LawmindWordRevisionBar";

describe("LawmindWordRevisionBar", () => {
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

  it("shows when a Word is pinned and writes confirmation markers", async () => {
    expect(
      shouldShowWordRevisionBar({
        composeInput: "",
        filePills: [{ relPath: "设备采购合同.docx" }],
      }),
    ).toBe(true);
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <LawmindWordRevisionBar
          composeInput="请改合同"
          filePills={[{ relPath: "设备采购合同.docx" }]}
          onComposeInputChange={onChange}
        />,
      );
    });
    expect(host.textContent).toContain("采购供货");
    expect(host.textContent).toContain("股权并购");
    expect(host.textContent).toContain("公司章程");
    expect(host.querySelector('[data-testid="lm-word-rev-hint"]')?.textContent).toMatch(/采购供货/);
    await act(async () => {
      (host.querySelector('[data-testid="lm-word-rev-family-procurement"]') as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenLastCalledWith("改稿类型：采购供货\n请改合同");
  });

  it("marks confirmed type and stance chips as pressed", async () => {
    const composeInput = upsertWordRevisionMarkers("请改合同", {
      family: "procurement",
      stance: "甲方",
    });
    await act(async () => {
      root.render(
        <LawmindWordRevisionBar
          composeInput={composeInput}
          filePills={[{ relPath: "设备采购合同.docx" }]}
          onComposeInputChange={() => {}}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-word-rev-family-procurement"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(host.querySelector('[data-testid="lm-word-rev-stance-甲方"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides when there is no Word pin and no markers", () => {
    expect(shouldShowWordRevisionBar({ composeInput: "今天开庭", filePills: [] })).toBe(false);
  });
});
