/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { canvasComposerDraft, openLawyerHref } from "./host-actions";
import { LAWMIND_OPEN_WORKSPACE_FILE_EVENT } from "../lawmind-workspace-file-open";

describe("canvasComposerDraft", () => {
  it("puts the canvas path in front of the question", () => {
    expect(canvasComposerDraft("请解释费用最高的一项", "canvas/核对-task.canvas.tsx")).toBe(
      "请看 [核对-task.canvas.tsx](canvas/核对-task.canvas.tsx)。\n请解释费用最高的一项",
    );
  });

  it("leaves the question alone when the path is not a canvas", () => {
    expect(canvasComposerDraft("继续", "../secret.canvas.tsx")).toBe("继续");
    expect(canvasComposerDraft("继续", "notes/memo.md")).toBe("继续");
  });
});

describe("openLawyerHref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens relative files under the given root", () => {
    const opened: Array<{ relPath?: string; root?: string }> = [];
    const onFile = (ev: Event) => {
      opened.push((ev as CustomEvent<{ relPath?: string; root?: string }>).detail ?? {});
    };
    window.addEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onFile);
    expect(openLawyerHref("notes/fee.md", "project")).toBe(true);
    window.removeEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onFile);
    expect(opened).toEqual([{ relPath: "notes/fee.md", root: "project" }]);
  });
});
