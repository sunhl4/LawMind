/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindAgentFleetDetail, type LawmindAgentFleetDetailProps } from "./LawmindAgentFleetDetail";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import type { LawMindRequiresAction } from "./lawmind-requires-action";
import { openContractRevisionForTask } from "./lawmind-open-contract-revision";

vi.mock("./lawmind-open-contract-revision", () => ({
  openContractRevisionForTask: vi.fn(async () => ({ ok: true as const })),
  prepareWorkspaceForFileOpen: vi.fn(),
}));

function sendRun(): AgentRunSummary {
  return {
    id: "automation-send:inbox-9",
    kind: "automation_send",
    status: "awaiting_approval",
    title: "待发信",
    queueItemId: "inbox-9",
    updatedAt: "2026-09-28T00:00:00.000Z",
    createdAt: "2026-09-28T00:00:00.000Z",
    priority: 1,
  };
}

function draftRun(): AgentRunSummary {
  return {
    id: "draft-1",
    kind: "pending_review",
    status: "awaiting_review",
    title: "合同修订",
    taskId: "task-1",
    updatedAt: "2026-09-28T00:00:00.000Z",
    createdAt: "2026-09-28T00:00:00.000Z",
    priority: 1,
  };
}

function hostGrantRun(): AgentRunSummary {
  return {
    id: "chat:s1",
    kind: "chat",
    status: "awaiting_approval",
    title: "读取本机文件",
    sessionId: "s1",
    updatedAt: "2026-09-28T00:00:00.000Z",
    createdAt: "2026-09-28T00:00:00.000Z",
    priority: 1,
  };
}

function hostGrantAction(): LawMindRequiresAction {
  return {
    id: "grant-1",
    kind: "tool_approval",
    threadId: "m:t:s",
    title: "读取本机文件",
    summary: "需要读取本机文件。",
    toolName: "read_host_file",
    decisions: ["approve", "reject"],
    createdAt: "2026-09-28T00:00:00.000Z",
  };
}

function renderDetail(
  root: Root,
  extra: Partial<LawmindAgentFleetDetailProps> & Pick<LawmindAgentFleetDetailProps, "current">,
) {
  const onPrimary = extra.onPrimary ?? vi.fn();
  const onRejectApproval = extra.onRejectApproval ?? vi.fn();
  const onSnooze = extra.onSnooze ?? vi.fn();
  act(() => {
    root.render(
      <LawmindAgentFleetDetail
        displayTitle={extra.current?.title ?? ""}
        readingMode={false}
        approvalDoc={null}
        isDraftReview={false}
        showForm={false}
        allActions={[]}
        clarificationDraft={{}}
        onClarificationDraftChange={() => undefined}
        deskChecklistView={null}
        deskChecklistChecked={{}}
        deskChecklistLoading={false}
        deskChecklistComplete={false}
        onDeskChecklistCheckedChange={() => undefined}
        onClearError={() => undefined}
        busy={false}
        primaryLabel="批准发送"
        primaryDisabled={false}
        clarifyComplete
        onPrimary={onPrimary}
        onDraftReview={() => undefined}
        onRejectApproval={onRejectApproval}
        onSnooze={onSnooze}
        approvalAction={null}
        approvalIsDocWrite={false}
        approvalLinkedTaskId={null}
        showArgsEdit={false}
        argsEditOpen={false}
        argsEditError={null}
        onArgsEditOpenChange={() => undefined}
        onArgsEditErrorChange={() => undefined}
        onApproveTool={() => undefined}
        onApproveToolEdit={() => undefined}
        onRejectTool={() => undefined}
        onRespondClarification={() => undefined}
        onResolveMatterApproval={() => undefined}
        onOpenChatSession={() => undefined}
        postApproveExport={null}
        onPostApproveExport={() => undefined}
        onPostApproveDismiss={() => undefined}
        onOpenError={() => undefined}
        {...extra}
      />,
    );
  });
}

describe("LawmindAgentFleetDetail outbound send dock", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("rejects the pending send instead of a borrowed approval", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onRejectApproval = vi.fn();
    const onPrimary = vi.fn();
    renderDetail(root, {
      current: sendRun(),
      displayTitle: "待发信",
      primaryLabel: "批准发送",
      isOutboundSend: true,
      onPrimary,
      onRejectApproval,
    });
    const reject = host.querySelector<HTMLButtonElement>('[data-testid="lm-fleet-send-reject"]');
    expect(reject?.textContent).toContain("驳回");
    act(() => reject?.click());
    expect(onRejectApproval).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="lm-ceremony-primary"]')?.textContent).toContain(
      "批准发送",
    );
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-ceremony-primary"]')?.click();
    });
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("keeps the dock on the outbound batch when the open row is a draft or host grant", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onRejectApproval = vi.fn();
    const onPrimary = vi.fn();
    const onSnooze = vi.fn();
    const onDraftReview = vi.fn();
    const onApproveToolEdit = vi.fn();
    renderDetail(root, {
      current: draftRun(),
      isDraftReview: true,
      batchOutbound: true,
      primaryLabel: "批准发送 2",
      rejectLabel: "驳回 2",
      onPrimary,
      onRejectApproval,
      onSnooze,
      onDraftReview,
    });
    const dock = host.querySelector(".lm-agents-wb-dock");
    expect(dock?.textContent).toContain("批准发送 2");
    expect(dock?.textContent).toContain("驳回 2");
    expect(dock?.textContent).toContain("稍后");
    expect(dock?.textContent).not.toContain("签批");
    expect(dock?.textContent).not.toContain("允许一次");
    expect(host.querySelector('[data-testid="lm-fleet-draft-approve"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-host-grant-once"]')).toBeNull();
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-fleet-send-reject"]')?.click();
      host.querySelector<HTMLButtonElement>('[data-testid="lm-fleet-dock-snooze"]')?.click();
    });
    expect(onRejectApproval).toHaveBeenCalledOnce();
    expect(onSnooze).toHaveBeenCalledOnce();
    expect(onDraftReview).not.toHaveBeenCalled();

    renderDetail(root, {
      current: hostGrantRun(),
      batchOutbound: true,
      primaryLabel: "批准发送 2",
      rejectLabel: "驳回 2",
      approvalAction: hostGrantAction(),
      onPrimary,
      onApproveToolEdit,
    });
    expect(host.querySelector('[data-testid="lm-host-grant-once"]')).toBeNull();
    expect(host.querySelector(".lm-agents-wb-dock")?.textContent).not.toContain("允许一次");
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-ceremony-primary"]')?.click();
    });
    expect(onPrimary).toHaveBeenCalledOnce();
    expect(onApproveToolEdit).not.toHaveBeenCalled();
  });

  it("opens the revision window for 去核对 and does not show 签批", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onDraftReview = vi.fn();
    const onPrimary = vi.fn();
    renderDetail(root, {
      apiBase: "http://127.0.0.1:9",
      current: {
        id: "word-check:task-1",
        kind: "word_check",
        status: "awaiting_review",
        title: "服务合同.docx",
        subtitle: "2 处修订 · 待核对",
        taskId: "task-1",
        updatedAt: "2026-09-28T00:00:00.000Z",
        createdAt: "2026-09-28T00:00:00.000Z",
        priority: 0,
      },
      displayTitle: "服务合同.docx",
      primaryLabel: "去核对",
      isDraftReview: false,
      onPrimary,
      onDraftReview,
    });
    expect(host.textContent).toContain("去核对");
    expect(host.textContent).not.toContain("签批");
    expect(host.querySelector("[data-testid='lm-fleet-draft-approve']")).toBeNull();
    expect(host.querySelector("[data-testid='lm-fleet-primary-review']")).toBeNull();
    act(() => {
      host.querySelector<HTMLButtonElement>("[data-testid='lm-fleet-word-check']")?.click();
    });
    expect(openContractRevisionForTask).toHaveBeenCalledWith({
      apiBase: "http://127.0.0.1:9",
      taskId: "task-1",
      workspaceDir: undefined,
    });
    expect(onPrimary).not.toHaveBeenCalled();
    expect(onDraftReview).not.toHaveBeenCalled();
  });
});
