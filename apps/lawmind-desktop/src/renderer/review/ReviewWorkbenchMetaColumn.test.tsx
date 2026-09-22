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
      <ReviewWorkbenchMetaColumn        apiBase="http://127.0.0.1:8765"
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

/**
 * G3 欠账二：待定夺项的旁路展示**必须真的挂在这里**。
 *
 * 这一组测试防的是本仓反复出现的那类缺陷——**组件写好了、没人挂**。
 * 之前 `LawmindJudgmentEscalationCard` / `LawmindDecisionHeader` 都只在单测里被渲染过，
 * 应用里没有任何调用点；只测组件本身永远发现不了这件事。
 */
describe("ReviewWorkbenchMetaColumn · 待定夺项旁路展示", () => {
  let host: HTMLDivElement;
  let root: Root;

  /**
   * 只对判定明细路由给数据，其余仍走既有 404 口径（不干扰其它子组件）。
   *
   * 失败刺激用 **404** 而不是 5xx：`fetchApi` 会对 5xx 做指数退避重试
   * （`DEFAULT_MAX_RETRIES = 1`，退避 1s），重试链比断言窗口还长，
   * 会让「读不到」这一态看起来像「没反应」——那是测试的假象，不是产品行为。
   * 404 是不可重试的非 2xx，正好是「路由在、但这件读不出来」的干净刺激。
   */
  function stubJudgmentFetch(payload: Record<string, unknown> | "error"): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/api/judgment/")) {
          return new Response(JSON.stringify({ ok: false }), { status: 404 });
        }
        if (payload === "error") {
          return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 404 });
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  }

  /**
   * 等子组件把异步读取落地。
   *
   * `Response.json()` 走的是流读取，落点在**宏任务**队列上——只 flush 微任务
   * （`await Promise.resolve()`）是等不到的，会看到尚在 `loading` 的中间态，
   * 断言就变成「时序巧合」而不是「行为正确」。所以这里用真实的轮询等待。
   */
  async function settle(predicate: () => boolean): Promise<void> {
    await vi.waitFor(() => {
      expect(predicate()).toBe(true);
    });
  }

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
    vi.unstubAllGlobals();
  });

  it("有待定夺项时**在列里出现**（`advisory` 下律师能看见系统没替他决定的事）", async () => {
    stubJudgmentFetch({
      ok: true,
      escalationChannel: "on",
      escalationPosture: "advisory",
      escalation: [{ label: "责任上限的水平", reason: "属商业风险分配" }],
    });
    await renderMetaColumn(host, root);
    await settle(() => host.querySelector('[data-testid="lm-judgment-escalation"]') !== null);
    const el = host.querySelector('[data-testid="lm-judgment-escalation"]');
    expect(el?.getAttribute("data-variant")).toBe("inline");
    expect(el?.getAttribute("data-posture")).toBe("advisory");
    expect(el?.textContent).toContain("责任上限的水平");
    expect(el?.textContent).toContain("不打断当前流程");
  });

  it("没有待定夺项时**整块不出现**（不给每份稿子加噪声）", async () => {
    stubJudgmentFetch({ ok: true, escalationChannel: "on", escalationPosture: "advisory", escalation: [] });
    await renderMetaColumn(host, root);
    // 反向等待：先确认它**没有**出现过（读取完成后仍为空）。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(host.querySelector('[data-testid="lm-judgment-escalation"]')).toBeNull();
  });

  it("读不到时**出声**（故障不得在这条律师主路径上冒充「没有」）", async () => {
    stubJudgmentFetch("error");
    await renderMetaColumn(host, root);
    await settle(
      () =>
        host.querySelector('[data-testid="lm-judgment-escalation"]')?.getAttribute("data-state") ===
        "error",
    );
    const el = host.querySelector('[data-testid="lm-judgment-escalation"]');
    expect(el?.textContent).toContain("读不到");
  });
});
