/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindUnexpectedErrorHost } from "./LawmindUnexpectedErrorHost";

function errorEventWithCause(error: unknown): ErrorEvent {
  const event = new ErrorEvent("error", {
    message: error instanceof Error ? error.message : "",
  });
  Object.defineProperty(event, "error", { configurable: true, value: error });
  return event;
}

describe("LawmindUnexpectedErrorHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the handler error message and stack, and ignores abort", async () => {
    await act(async () => {
      root.render(<LawmindUnexpectedErrorHost />);
    });
    const abort = new DOMException("The operation was aborted", "AbortError");
    await act(async () => {
      window.dispatchEvent(errorEventWithCause(abort));
    });
    expect(host.querySelector("[data-testid='lm-error-report-dialog']")).toBeNull();

    const error = new TypeError("model id missing");
    error.stack = "TypeError: model id missing\n    at connectModel (models.ts:12:3)";
    await act(async () => {
      window.dispatchEvent(errorEventWithCause(error));
    });
    const body = host.querySelector("[data-testid='lm-error-report-body']")?.textContent ?? "";
    expect(body).toContain("位置：未捕获的异常");
    expect(body).toContain("类型：TypeError");
    expect(body).toContain("说明：model id missing");
    expect(body).toContain("at connectModel (models.ts:12:3)");
  });
});
