/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindWorkflowLibrary } from "./LawmindWorkflowLibrary";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn().mockResolvedValue({ templates: [] }),
  errorMessage: (e: unknown) => String(e),
}));

vi.mock("./lawmind-api-routes.ts", () => ({
  apiPost: vi.fn(),
}));

describe("LawmindWorkflowLibrary", () => {
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

  it("renders library shell with search controls", async () => {
    await act(async () => {
      root.render(<LawmindWorkflowLibrary apiBase="http://127.0.0.1:1" />);
    });
    expect(host.querySelector('input[aria-label="搜索工作流"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="业务领域"]')).not.toBeNull();
  });
});
