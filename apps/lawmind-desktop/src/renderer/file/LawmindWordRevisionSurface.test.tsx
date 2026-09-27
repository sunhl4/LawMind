/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WordSurfaceSnapshot } from "../../../../../src/lawmind/drafts/word-surface.ts";

const apiGetJson = vi.fn();
const apiSendJson = vi.fn();

vi.mock("../api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { LawmindWordRevisionSurface } from "./LawmindWordRevisionSurface";

const snapshot: WordSurfaceSnapshot = {
  fileName: "补充协议.docx",
  relPath: "cases/m/补充协议.docx",
  root: "workspace",
  taskId: "task-1",
  updatedAt: "2026-09-27T00:00:00.000Z",
  paragraphs: [
    {
      segments: [
        { kind: "text", text: "甲方应于" },
        { kind: "revision", hunkId: "h1", before: "十日", after: "五日" },
        { kind: "text", text: "内付款。" },
      ],
    },
  ],
  hunks: [
    {
      hunkId: "h1",
      before: "十日",
      after: "五日",
      status: "pending",
      sectionHeading: "付款",
      placed: true,
    },
  ],
  summary: { pending: 1, accepted: 0, rejected: 0 },
};

describe("LawmindWordRevisionSurface", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    apiGetJson.mockReset();
    apiSendJson.mockReset();
  });

  it("shows the revision and accepts it", async () => {
    apiGetJson.mockResolvedValue({ ok: true, ...snapshot });
    apiSendJson.mockResolvedValue({ ok: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindWordRevisionSurface
          apiBase="http://127.0.0.1:9"
          root="workspace"
          relPath="cases/m/补充协议.docx"
          fileName="补充协议.docx"
          onOpenWithSystem={() => undefined}
          onRevealSource={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("预览");
    expect(host.textContent).toContain("十日");
    expect(host.textContent).toContain("五日");
    const accept = host.querySelector("[data-testid='lm-word-accept-h1']");
    expect(accept).toBeTruthy();
    const exportButton = host.querySelector("[data-testid='lm-word-surface-export']");
    expect(exportButton).toBeInstanceOf(HTMLButtonElement);
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    expect(exportButton?.textContent).toContain("导出");
    await act(async () => {
      accept?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/drafts/task-1/redline/hunks/h1/resolve",
      "POST",
      { decision: "accept" },
    );
    root.unmount();
  });
});
