/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XlsxFileView } from "./XlsxFileView";
import type { OpenFileTab } from "./file-workbench-types";

const apiGetJson = vi.fn();
const apiSendJson = vi.fn();

vi.mock("../api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
  errorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  desc?.set?.call(input, value);
}

function xlsxTab(): OpenFileTab {
  return {
    id: "project:ledger.xlsx",
    root: "project",
    path: "吉利项目价格拆解.xlsx",
    name: "吉利项目价格拆解.xlsx",
    kind: "xlsx",
    content: "",
    savedContent: "",
    mtimeMs: 100,
  };
}

const previewBody = {
  ok: true as const,
  mtimeMs: 100,
  sheets: [
    {
      name: "中文",
      colCount: 1,
      colWidthsPx: [80],
      rowHeightsPx: [null],
      cells: [[{ v: "甲乙丙" }]],
      truncatedRows: false,
    },
    {
      name: "英文",
      colCount: 1,
      colWidthsPx: [80],
      rowHeightsPx: [null],
      cells: [[{ v: "A" }]],
      truncatedRows: false,
    },
  ],
  truncatedSheets: false,
};

describe("XlsxFileView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiGetJson.mockReset();
    apiSendJson.mockReset();
    apiGetJson.mockResolvedValue(previewBody);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function renderView(locator?: string): Promise<void> {
    await act(async () => {
      root.render(
        <XlsxFileView
          apiBase="http://127.0.0.1:9"
          tab={xlsxTab()}
          {...(locator ? { locator } : {})}
          actions={{
            onRevealSource: () => undefined,
            onOpenWithSystem: () => undefined,
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function editCell(value: string): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLTableCellElement>('[data-testid="lm-xlsx-cell-0-0"]')?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 20 }),
      );
    });
    const input = container.querySelector<HTMLInputElement>(".lm-xlsx-cell-input");
    expect(input).toBeTruthy();
    await act(async () => {
      if (!input) {return;}
      setNativeInputValue(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
  }

  it("enters edit on single click without selecting the whole cell", async () => {
    await renderView();
    await editCell("乙");
    const input = container.querySelector<HTMLInputElement>(".lm-xlsx-cell-input");
    expect(input?.selectionStart).toBe(input?.selectionEnd);
  });

  it("edits a cell and saves via xlsx-save", async () => {
    apiSendJson.mockResolvedValue({ ok: true, mtimeMs: 200, applied: 1 });
    await renderView();
    await editCell("乙");
    const saveBtn = container.querySelector<HTMLButtonElement>('[data-testid="lm-xlsx-save"]');
    expect(saveBtn?.disabled).toBe(false);
    await act(async () => saveBtn?.click());
    await act(async () => await Promise.resolve());
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/fs/xlsx-save",
      "POST",
      expect.objectContaining({ edits: [{ sheet: "中文", row: 1, col: 1, value: "乙" }] }),
    );
  });

  it("selects and scrolls to a rich evidence cell", async () => {
    await renderView("S1!A1");
    expect(container.querySelector('[data-testid="lm-xlsx-cell-0-0"]')?.className).toContain(
      "lm-xlsx-cell-selected",
    );
  });

  it("keeps bottom sheet tabs", async () => {
    await renderView();
    expect(container.querySelector('[data-testid="lm-xlsx-sheet-tab-1"]')?.textContent).toBe("英文");
  });
});
