/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindSideExplorerSkeleton } from "./LawmindSideExplorerSkeleton";

describe("LawmindSideExplorerSkeleton", () => {
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

  it("renders placeholder lines for explorer host", async () => {
    await act(async () => {
      root.render(<LawmindSideExplorerSkeleton />);
    });
    expect(host.querySelector(".lm-side-explorer-skeleton")).not.toBeNull();
    expect(host.querySelectorAll(".lm-side-explorer-skeleton-line").length).toBeGreaterThan(2);
  });
});
