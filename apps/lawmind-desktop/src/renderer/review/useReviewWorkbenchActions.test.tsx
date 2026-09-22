/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiPostDraftReview: vi.fn(),
  apiSendJson: vi.fn(),
  readAutoExportOnApprove: vi.fn(),
}));

vi.mock("../lawmind-api-routes.ts", () => ({
  apiPostDraftReview: (...args: unknown[]) => mocks.apiPostDraftReview(...args),
}));
vi.mock("../api-client", () => ({
  apiSendJson: (...args: unknown[]) => mocks.apiSendJson(...args),
  errorMessage: (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback),
  messageFromOkFalseBody: (_j: unknown, fallback: string) => fallback,
  userMessageFromApiError: (_e: unknown, fallback: string) => fallback,
}));
vi.mock("../lawmind-review-prefs", () => ({
  readAutoExportOnApprove: () => mocks.readAutoExportOnApprove(),
}));

import { useReviewWorkbenchActions } from "./useReviewWorkbenchActions";

type HookReturn = ReturnType<typeof useReviewWorkbenchActions>;

function Harness(props: {
  checklistChecked: Record<string, boolean>;
  onReady: (api: HookReturn) => void;
}) {
  const api = useReviewWorkbenchActions({
    apiBase: "http://localhost:1",
    assistantId: "asst",
    selectedTaskId: "task-1",
    detail: null,
    acceptance: null,
    note: "",
    setNote: () => undefined,
    selectedLabels: new Set<string>(),
    setSelectedLabels: () => undefined,
    deferMemoryWrites: false,
    setDeferMemoryWrites: () => undefined,
    appendToProfile: false,
    appendToLawyerProfile: false,
    renderTemplateId: "",
    revisionDispatchNote: "",
    revisionPrefilledForTaskRef: { current: null },
    checklistChecked: props.checklistChecked,
    setRevisionDispatchNote: () => undefined,
    setActionMsg: () => undefined,
    setLastExportPath: () => undefined,
    applyDetailFromResponse: () => undefined,
    loadDrafts: async () => undefined,
    loadDetail: async () => undefined,
    loadLearningQueue: async () => undefined,
    syncEditorFromDraft: () => undefined,
    clearEditorSaveError: () => undefined,
    setSelectedTaskId: () => undefined,
  });
  props.onReady(api);
  return null;
}

describe("useReviewWorkbenchActions.submitReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAutoExportOnApprove.mockReturnValue(false);
    mocks.apiPostDraftReview.mockResolvedValue({
      ok: true,
      draft: { taskId: "task-1", reviewStatus: "approved" },
    });
  });

  it("sends the latest checklistChecked after ticks change (no stale closure)", async () => {
    let hook!: HookReturn;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness checklistChecked={{ "item-a": true }} onReady={(api) => (hook = api)} />);
    });
    await act(async () => {
      await hook.submitReview("approved");
    });
    expect(mocks.apiPostDraftReview).toHaveBeenCalledTimes(1);
    expect(mocks.apiPostDraftReview.mock.calls[0]?.[2]).toMatchObject({
      status: "approved",
      checklistChecked: { "item-a": true },
    });

    // 律师继续勾选第二项后再点「通过」：请求体必须带上最新勾选（修复前闭包过期会仍发旧值）。
    await act(async () => {
      root.render(
        <Harness
          checklistChecked={{ "item-a": true, "item-b": true }}
          onReady={(api) => (hook = api)}
        />,
      );
    });
    await act(async () => {
      await hook.submitReview("approved");
    });
    expect(mocks.apiPostDraftReview).toHaveBeenCalledTimes(2);
    expect(mocks.apiPostDraftReview.mock.calls[1]?.[2]).toMatchObject({
      status: "approved",
      checklistChecked: { "item-a": true, "item-b": true },
    });

    root.unmount();
    host.remove();
  });
});
