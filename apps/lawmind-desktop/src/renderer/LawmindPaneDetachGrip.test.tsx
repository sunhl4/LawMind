/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindPaneDetachGrip } from "./LawmindPaneDetachGrip";

describe("LawmindPaneDetachGrip", () => {
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

  it("opens on click so the gesture also works without dragging", async () => {
    const onDetach = vi.fn();
    await act(async () => {
      root.render(<LawmindPaneDetachGrip pane="chat" label="对话" onDetach={onDetach} />);
    });
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-pane-detach-grip-chat"]',
    );
    expect(button?.getAttribute("aria-label")).toContain("拖出对话");
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("stays inert when disabled", async () => {
    const onDetach = vi.fn();
    await act(async () => {
      root.render(
        <LawmindPaneDetachGrip pane="middle" label="中栏" onDetach={onDetach} disabled />,
      );
    });
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-pane-detach-grip-middle"]',
    );
    expect(button?.disabled).toBe(true);
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(onDetach).not.toHaveBeenCalled();
  });

  it("opens after a drag past the threshold is released", async () => {
    const onDetach = vi.fn();
    await act(async () => {
      root.render(<LawmindPaneDetachGrip pane="chat" label="对话" onDetach={onDetach} />);
    });
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-pane-detach-grip-chat"]',
    );
    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
      button?.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 10 }),
      );
      button?.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 100, clientY: 10 }),
      );
      await Promise.resolve();
    });
    expect(onDetach).toHaveBeenCalledTimes(1);
  });
});
