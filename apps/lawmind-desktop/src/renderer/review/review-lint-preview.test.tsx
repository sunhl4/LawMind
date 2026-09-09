/**
 * @vitest-environment jsdom
 *
 * useReviewLintPreview：同输入重渲染不重复跑 lint；输入变化 debounce 后只跑一次。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";

const runLegalLintMock = vi.hoisted(() => vi.fn());
const previewSelfReviseMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../src/lawmind/lint/run-lint.ts", () => ({
  draftTextFromUnknown: (value: unknown) => {
    const d = value as { title?: string; sections?: Array<{ body?: string }> };
    return [d.title ?? "", ...(d.sections ?? []).map((s) => s.body ?? "")].join("\n");
  },
  runLegalLint: runLegalLintMock.mockImplementation((text: string) => ({
    schemaVersion: 1,
    findings: [],
    summaryZh: `lint:${text.length}`,
  })),
}));

vi.mock("../../../../../src/lawmind/lint/self-revise.ts", () => ({
  previewSelfRevise: previewSelfReviseMock.mockImplementation((text: string) => ({
    rounds: 1,
    applied: [],
    residual: [],
    text,
    summaryZh: "",
  })),
}));

import { useReviewLintPreview, REVIEW_LINT_DEBOUNCE_MS } from "./review-lint-preview";

function makeDetail(title: string, body: string): ArtifactDraft {
  return {
    taskId: "task-1",
    title,
    output: "docx",
    templateId: "contract.review",
    summary: "",
    sections: [{ heading: "正文", body }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: "2026-08-01T10:00:00.000Z",
  };
}

function Harness(props: { detail: ArtifactDraft }) {
  const { lintReport, selfRevisePreview } = useReviewLintPreview(props.detail);
  return (
    <output data-testid="lint-summary" data-self-revise={String(Boolean(selfRevisePreview))}>
      {lintReport.summaryZh}
    </output>
  );
}

describe("useReviewLintPreview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    runLegalLintMock.mockClear();
    previewSelfReviseMock.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it("连续渲染同输入不重复调用 lint（memo 按内容）", async () => {
    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", "设备买卖。")} />);
    });
    expect(runLegalLintMock).toHaveBeenCalledTimes(1);

    // 模拟批注击键导致的父级重渲染：新对象、同文本。
    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", "设备买卖。")} />);
    });
    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", "设备买卖。")} />);
    });
    expect(runLegalLintMock).toHaveBeenCalledTimes(1);
  });

  it("正文变化在 debounce 窗口内合并，结束后只重跑一次", async () => {
    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", "设备买卖。")} />);
    });
    expect(runLegalLintMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", "设备买卖与运输。")} />);
    });
    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", "设备买卖与运输安装。")} />);
    });
    // debounce 窗口内：仍用旧文本结果，未重跑
    expect(runLegalLintMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(REVIEW_LINT_DEBOUNCE_MS + 10);
    });
    expect(runLegalLintMock).toHaveBeenCalledTimes(2);
    expect(runLegalLintMock.mock.calls[1]?.[0]).toContain("设备买卖与运输安装。");
  });

  it("短正文不跑自检预览；长正文每次分析各跑一次", async () => {
    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", "短。")} />);
    });
    expect(previewSelfReviseMock).not.toHaveBeenCalled();

    const longBody = "本合同标的为设备买卖，含运输与安装。";
    await act(async () => {
      root.render(<Harness detail={makeDetail("买卖合同", longBody)} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(REVIEW_LINT_DEBOUNCE_MS + 10);
    });
    expect(previewSelfReviseMock).toHaveBeenCalledTimes(1);
  });
});
