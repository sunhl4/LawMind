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
  // eslint-disable-next-line typescript/unbound-method -- prototype setter, bound via .call
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
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

  it("enters edit on single click without selecting the whole cell", async () => {
    await act(async () => {
      root.render(
        <XlsxFileView
          apiBase="http://127.0.0.1:9"
          tab={xlsxTab()}
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

    await act(async () => {
      container.querySelector<HTMLTableCellElement>('[data-testid="lm-xlsx-cell-0-0"]')?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 12 }),
      );
    });
    const input = container.querySelector<HTMLInputElement>(".lm-xlsx-cell-input");
    expect(input).toBeTruthy();
    expect(input?.selectionStart).toBe(input?.selectionEnd);
    expect(input?.selectionStart).not.toBe(0);
    // collapsed caret — not a full-cell selection of "甲乙丙"
    expect(input?.selectionEnd === input?.selectionStart).toBe(true);
    expect((input?.selectionEnd ?? 0) - (input?.selectionStart ?? 0)).toBe(0);
  });

  it("edits a cell and saves via xlsx-save", async () => {
    apiSendJson.mockResolvedValue({ ok: true, mtimeMs: 200, applied: 1 });

    await act(async () => {
      root.render(
        <XlsxFileView
          apiBase="http://127.0.0.1:9"
          tab={xlsxTab()}
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

    await act(async () => {
      container.querySelector<HTMLTableCellElement>('[data-testid="lm-xlsx-cell-0-0"]')?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 20 }),
      );
    });
    const input = container.querySelector<HTMLInputElement>(".lm-xlsx-cell-input");
    expect(input).toBeTruthy();
    await act(async () => {
      if (!input) {
        return;
      }
      setNativeInputValue(input, "乙");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(container.textContent).toContain("未保存");
    const saveBtn = container.querySelector<HTMLButtonElement>('[data-testid="lm-xlsx-save"]');
    expect(saveBtn?.disabled).toBe(false);

    await act(async () => {
      saveBtn?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/fs/xlsx-save",
      "POST",
      expect.objectContaining({
        root: "project",
        path: "吉利项目价格拆解.xlsx",
        edits: [{ sheet: "中文", row: 1, col: 1, value: "乙" }],
      }),
    );
  });

  it("retries save on 409, then force-writes if still conflicting", async () => {
    const conflict = (mtimeMs: number) =>
      Object.assign(new Error("file was modified externally"), {
        name: "ApiRequestError",
        status: 409,
        body: { ok: false, conflict: true, error: "file was modified externally", mtimeMs },
      });
    apiSendJson
      .mockRejectedValueOnce(conflict(150))
      .mockRejectedValueOnce(conflict(160))
      .mockResolvedValueOnce({ ok: true, mtimeMs: 200, applied: 1 });

    await act(async () => {
      root.render(
        <XlsxFileView
          apiBase="http://127.0.0.1:9"
          tab={xlsxTab()}
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

    await act(async () => {
      container.querySelector<HTMLTableCellElement>('[data-testid="lm-xlsx-cell-0-0"]')?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 20 }),
      );
    });
    const input = container.querySelector<HTMLInputElement>(".lm-xlsx-cell-input");
    await act(async () => {
      if (!input) {
        return;
      }
      setNativeInputValue(input, "新");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="lm-xlsx-save"]')?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiSendJson).toHaveBeenCalledTimes(3);
    expect(apiSendJson.mock.calls[1]?.[3]).toMatchObject({ expectedMtimeMs: 150 });
    expect(apiSendJson.mock.calls[2]?.[3]).toMatchObject({ expectedMtimeMs: undefined });
    expect(container.textContent).not.toContain("冲突");
  });

  it("keeps bottom sheet tabs", async () => {
    await act(async () => {
      root.render(
        <XlsxFileView
          apiBase="http://127.0.0.1:9"
          tab={xlsxTab()}
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
    expect(container.querySelector('[data-testid="lm-xlsx-sheet-tab-1"]')?.textContent).toBe(
      "英文",
    );
  });
});
