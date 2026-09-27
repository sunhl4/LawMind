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

import {
  useReviewWorkbenchActions,
  type UseReviewWorkbenchActionsParams,
} from "./useReviewWorkbenchActions";

type HookReturn = ReturnType<typeof useReviewWorkbenchActions>;

function Harness(props: {
  checklistChecked: Record<string, boolean>;
  onReady: (api: HookReturn) => void;
  setActionMsg?: (msg: string | null) => void;
  applyDetailFromResponse?: UseReviewWorkbenchActionsParams["applyDetailFromResponse"];
  onShowArtifact?: UseReviewWorkbenchActionsParams["onShowArtifact"];
  onExportChecklistBlocked?: () => void;
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
    setActionMsg: props.setActionMsg ?? (() => undefined),
    setLastExportPath: () => undefined,
    applyDetailFromResponse: props.applyDetailFromResponse ?? (() => undefined),
    onShowArtifact: props.onShowArtifact,
    onExportChecklistBlocked: props.onExportChecklistBlocked,
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

describe("useReviewWorkbenchActions.submitRender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAutoExportOnApprove.mockReturnValue(false);
  });

  async function renderHook(opts?: {
    setActionMsg?: (msg: string | null) => void;
    applyDetailFromResponse?: UseReviewWorkbenchActionsParams["applyDetailFromResponse"];
    onShowArtifact?: UseReviewWorkbenchActionsParams["onShowArtifact"];
    onExportChecklistBlocked?: () => void;
  }) {
    let hook!: HookReturn;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Harness
          checklistChecked={{}}
          setActionMsg={opts?.setActionMsg}
          applyDetailFromResponse={opts?.applyDetailFromResponse}
          onShowArtifact={opts?.onShowArtifact}
          onExportChecklistBlocked={opts?.onExportChecklistBlocked}
          onReady={(api) => {
            hook = api;
          }}
        />,
      );
    });
    return {
      hook,
      cleanup: () => {
        root.unmount();
        host.remove();
      },
    };
  }

  it("sends includeProvenance when 导出来源批注 is on", async () => {
    mocks.apiSendJson.mockResolvedValue({ ok: true, outputPath: "out/memo.docx" });
    const setActionMsg = vi.fn();
    const { hook, cleanup } = await renderHook({ setActionMsg });
    await act(async () => {
      await hook.submitRender({ includeProvenance: true });
    });
    expect(mocks.apiSendJson).toHaveBeenCalledWith(
      "http://localhost:1",
      "/api/drafts/task-1/render",
      "POST",
      { includeProvenance: true },
    );
    expect(setActionMsg).toHaveBeenCalledWith("已生成 Word：out/memo.docx");
    cleanup();
  });

  it("surfaces a blocked export instead of swallowing it", async () => {
    const blocked = Object.assign(new Error("导出被拦截：出稿检查未齐，请在改稿页补齐后再导出。"), {
      body: {
        error: "checklist_incomplete",
        message: "导出被拦截：出稿检查未齐，请在改稿页补齐后再导出。",
        acceptance: { ready: false, blockerCount: 1, deliverableType: "memo.research" },
      },
    });
    mocks.apiSendJson.mockRejectedValue(blocked);
    const setActionMsg = vi.fn();
    const applyDetailFromResponse = vi.fn();
    const onExportChecklistBlocked = vi.fn();
    const { hook, cleanup } = await renderHook({
      setActionMsg,
      applyDetailFromResponse,
      onExportChecklistBlocked,
    });
    await act(async () => {
      await hook.submitRender({ includeProvenance: true });
    });
    expect(onExportChecklistBlocked).toHaveBeenCalledTimes(1);
    expect(setActionMsg).toHaveBeenCalledWith(
      "导出被拦截：出稿检查未齐，请在改稿页补齐后再导出。 右侧「高级 · 签批」已打开，勾齐出稿检查后再导出。",
    );
    expect(applyDetailFromResponse).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        acceptance: expect.objectContaining({ ready: false, blockerCount: 1 }),
      }),
    );
    cleanup();
  });

  it("shows the server sentence for a gate block without the error code", async () => {
    mocks.apiSendJson.mockRejectedValue(
      Object.assign(new Error("草稿未通过出稿检查 — acceptance_gate_blocked（服务返回 422）"), {
        body: {
          error: "acceptance_gate_blocked",
          message: "草稿未通过出稿检查，存在阻塞项；请补齐缺失章节或回答待确认问题后再导出。",
        },
      }),
    );
    const setActionMsg = vi.fn();
    const { hook, cleanup } = await renderHook({ setActionMsg });
    await act(async () => {
      await hook.submitRender({ includeProvenance: true });
    });
    expect(setActionMsg).toHaveBeenCalledWith(
      "草稿未通过出稿检查，存在阻塞项；请补齐缺失章节或回答待确认问题后再导出。",
    );
    cleanup();
  });

  it("keeps the export path and says when Finder cannot open the folder", async () => {
    mocks.apiSendJson.mockResolvedValue({
      ok: true,
      outputPath: "/Users/me/YX/计划书.docx",
    });
    const setActionMsg = vi.fn();
    const { hook, cleanup } = await renderHook({
      setActionMsg,
      onShowArtifact: async () => ({ ok: false, error: "outside_allowed_roots" }),
    });
    await act(async () => {
      await hook.submitRender({ includeProvenance: true });
    });
    const message = setActionMsg.mock.calls.map((call) => String(call[0])).join("\n");
    expect(message).toContain("已生成 Word：/Users/me/YX/计划书.docx");
    expect(message).toContain("不在当前可打开的范围");
    expect(message).not.toContain("outside_allowed_roots");
    cleanup();
  });
});
