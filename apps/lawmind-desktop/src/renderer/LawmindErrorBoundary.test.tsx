/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindErrorBoundary } from "./LawmindErrorBoundary";

function Boom(): null {
  throw new Error("boom-for-boundary");
}

describe("LawmindErrorBoundary", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: typeof console.error;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    consoleError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    console.error = consoleError;
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("shows recovery UI instead of blanking the tree", async () => {
    await act(async () => {
      root.render(
        <LawmindErrorBoundary label="工作台">
          <Boom />
        </LawmindErrorBoundary>,
      );
    });
    expect(host.querySelector('[data-testid="lm-error-boundary"]')?.textContent).toContain("工作台");
    expect(host.textContent).toContain("boom-for-boundary");
    expect(host.textContent).toContain("重试");
    expect(host.querySelector("[data-testid='lm-error-report-dialog']")).toBeTruthy();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='lm-error-report-copy']")?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledOnce();
    const copied = String(writeText.mock.calls[0]?.[0]);
    const shown = host.querySelector("[data-testid='lm-error-report-body']")?.textContent ?? "";
    expect(shown).toBe(copied);
    expect(copied).toContain("位置：工作台");
    expect(copied).toContain("类型：Error");
    expect(copied).toContain("说明：boom-for-boundary");
    expect(copied).toContain("组件：");
    expect(copied).toContain("Boom");
    expect(copied).toContain("堆栈：");
    expect(copied).not.toContain("案件");
    expect(host.textContent).toContain("已复制");
  });

  it("retry renders children again after the throw is gone", async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) {
        throw new Error("clientId is not defined");
      }
      return <p>ok</p>;
    }
    await act(async () => {
      root.render(
        <LawmindErrorBoundary label="工作台">
          <Flaky />
        </LawmindErrorBoundary>,
      );
    });
    expect(host.textContent).toContain("clientId is not defined");
    shouldThrow = false;
    await act(async () => {
      const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "重试");
      retry?.click();
    });
    expect(host.textContent).toContain("ok");
    expect(host.querySelector('[data-testid="lm-error-boundary"]')).toBeNull();
  });
});
