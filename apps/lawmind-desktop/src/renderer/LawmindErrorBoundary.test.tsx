/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  });
});
