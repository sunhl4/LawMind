/**
 * @vitest-environment jsdom
 *
 * 律师主路径（审核台元信息列）不得出现工程师语言：
 * 文件路径（assistants/…、*.md）与「产出 Agent」等内部概念不对律师渲染。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { ReviewWorkbenchMetaColumn } from "./ReviewWorkbenchMetaColumn";

const detail: ArtifactDraft = {
  taskId: "task-1",
  matterId: "m-1",
  title: "买卖合同",
  output: "docx",
  templateId: "contract.review",
  summary: "初审",
  sections: [{ heading: "范围", body: "设备买卖。" }],
  reviewNotes: [],
  reviewStatus: "pending",
  createdAt: "2026-08-01T10:00:00.000Z",
};

function renderMetaColumn(host: HTMLDivElement, root: Root) {
  return act(async () => {
    root.render(
      <ReviewWorkbenchMetaColumn
        apiBase="http://127.0.0.1:8765"
        assistantId="default"
        detail={detail}
        selectedTaskId="task-1"
        acceptance={null}
        citationIntegrity={null}
        gateDecisions={[]}
        executionState={null}
        memorySources={null}
        learningQueue={[]}
        learningBusy={null}
        onAdoptSuggestion={vi.fn()}
        onDismissSuggestion={vi.fn()}
        onDraftUpdated={vi.fn()}
        deferMemoryWrites={false}
        onDeferMemoryWritesChange={vi.fn()}
        selectedLabels={new Set()}
        onSelectedLabelsChange={vi.fn()}
        appendToProfile={false}
        onAppendToProfileChange={vi.fn()}
        appendToLawyerProfile={false}
        onAppendToLawyerProfileChange={vi.fn()}
        actionBusy={false}
        lastExportPath={null}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onModify={vi.fn()}
        onReopen={vi.fn()}
        onExportWord={vi.fn()}
        onExportTrackedWord={vi.fn()}
        packExportEnabled={false}
        onDownloadPack={vi.fn()}
        packBusy={false}
        revisionDispatchNote=""
        onRevisionDispatchNoteChange={vi.fn()}
        revisionDispatchBusy={false}
        onSubmitRevisionJob={vi.fn()}
        actionMsg={null}
        note=""
        onNoteChange={vi.fn()}
        paneClassName=""
        paneStyle={{}}
      />,
    );
  });
}

describe("ReviewWorkbenchMetaColumn 律师语言", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 404 })),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("责任与交付权限使用律师语言（处理助手：默认助手）", async () => {
    await renderMetaColumn(host, root);
    expect(host.textContent).toContain("处理助手：默认助手");
    expect(host.textContent).not.toContain("产出 Agent");
  });

  it("渲染文本不含文件路径与内部档案名", async () => {
    await renderMetaColumn(host, root);
    expect(host.textContent).not.toContain("assistants/");
    expect(host.textContent).not.toContain("PROFILE.md");
    expect(host.textContent).not.toContain("LAWYER_PROFILE");
    expect(host.textContent).toContain("将本条审核摘要记入本助手档案（供后续案件参考）");
    expect(host.textContent).toContain("将本条审核摘要记入工作区律师档案「八、个人积累」");
  });

  it("签批双路径文案统一：本台签批明示与在办同一记录", async () => {
    await renderMetaColumn(host, root);
    expect(host.textContent).toContain("高级 · 签批（与在办同一记录）");
    expect(host.textContent).toContain("在此签批");
    expect(host.textContent).toContain("与「在办」的签批是同一记录：此处通过后，在办对应待办即办结；批注随签批一并提交。");
    expect(host.textContent).not.toContain("本台直接签批");
    const noteArea = host.querySelector<HTMLTextAreaElement>(".lm-review-note textarea");
    expect(noteArea?.placeholder).toBe("批注（可选；在本台签批时一并提交）");
    expect(noteArea?.placeholder).not.toContain("回在办");
  });
});
