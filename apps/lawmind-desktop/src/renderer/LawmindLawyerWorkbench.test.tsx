/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGetJson, apiSendJson } from "./api-client";
import { LawmindLawyerWorkbench } from "./LawmindLawyerWorkbench";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async (_base: string, path: string) => {
    if (path === "/api/desk/today") {
      return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
    }
    if (path.startsWith("/api/desk/matters")) {
      return { ok: true, matters: [] };
    }
    return { ok: true };
  }),
  apiSendJson: vi.fn(async () => ({ ok: true })),
  errorMessage: (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback),
  fetchApi: vi.fn(),
}));

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("LawmindLawyerWorkbench", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
      }
      if (path.startsWith("/api/desk/matters")) {
        return { ok: true, matters: [] };
      }
      return { ok: true };
    });
    vi.mocked(apiSendJson).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders 工作台 chrome and today composer", async () => {
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          workspaceDir="/Users/shl/nvidia/LawMind"
          selectedMatterId={null}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();
    expect(host.querySelector('[data-testid="lm-lawyer-workbench"]')).toBeTruthy();
    expect(host.textContent).toContain("工作台");
    expect(host.querySelector('[data-testid="lm-lawyer-desk-kicker"]')?.textContent).toMatch(
      /LawMind · 0 个案件/,
    );
    expect(host.querySelector('[data-testid="lm-lawyer-cockpit"]')).toBeTruthy();
    expect(host.querySelectorAll(".lm-desk-col")).toHaveLength(3);
    expect(host.querySelector(".lm-desk-col--matters")).toBeTruthy();
    expect(host.querySelector('[aria-label="本案列表"]')).toBeTruthy();
    expect(host.textContent).toContain("本案动作");
    expect(host.textContent).toContain("贴传票");
    expect(host.textContent).not.toContain("打开对话");
    expect(host.querySelector(".lm-lawyer-fab")).toBeNull();
    expect(host.querySelector('[data-testid="lm-lawyer-today-plan-input"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-lawyer-today-progress"]')?.textContent).toContain("0");
    expect(host.querySelector('[data-testid="lm-lawyer-matter-empty"]')).toBeTruthy();
  });

  it("offers reconnect when the local service is unreachable", async () => {
    vi.mocked(apiGetJson).mockRejectedValue(
      new Error("无法连接本地服务，请检查网络与本机 LawMind 进程是否运行。"),
    );
    const onReconnect = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId={null}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
          onReconnectLocalService={onReconnect}
        />,
      );
    });
    await flush();
    await flush();
    expect(host.querySelector('[data-testid="lm-lawyer-reconnect"]')).toBeTruthy();
    expect(host.textContent).toContain("无法连接本地服务");
    expect(onReconnect).toHaveBeenCalledTimes(1);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-lawyer-reconnect"]')?.click();
    });
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("groups today items and lets mail jump to the matter", async () => {
    const onSelectMatter = vi.fn();
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return {
          ok: true,
          today: {
            date: "2026-09-09",
            items: [
              { id: "p1", kind: "plan", title: "写代理词", done: false },
              { id: "mail:1", kind: "mail", title: "待回复 · 催稿", done: false, matterId: "m1", sourceRef: "msg-1" },
              {
                id: "deadline:1",
                kind: "deadline",
                title: "举证期限",
                done: false,
                matterId: "m1",
                dueAt: "2026-09-09T17:00:00",
              },
            ],
            progress: { done: 0, total: 3 },
          },
        };
      }
      if (path.startsWith("/api/desk/matters")) {
        return {
          ok: true,
          matters: [
            {
              matterId: "m1",
              title: "买卖合同纠纷",
              status: "open",
              matterKind: "litigation",
              matterKindLabel: "诉讼",
              openDeadlineCount: 1,
              nextHearingAt: "2026-09-20T09:00:00",
              daysUntilHearing: 11,
              docket: { caseNo: "（2024）沪01民初1号", court: "上海一中院" },
            },
          ],
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          workspaceDir="/tmp/ws"
          selectedMatterId={null}
          onSelectMatter={onSelectMatter}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();

    expect(host.textContent).toContain("今日进度 0/3");
    expect(host.textContent).toContain("写代理词");
    expect(host.textContent).toContain("待回复");
    expect(host.textContent).toContain("买卖合同纠纷");
    expect(host.querySelector('[data-testid="lm-lawyer-desk-kicker"]')?.textContent).toMatch(/ws · 1 个案件/);
    expect(host.querySelector('[data-testid="lm-lawyer-stat-mail"]')?.textContent).toContain("1");
    expect(host.querySelector('[data-testid="lm-lawyer-progress-board"]')).toBeNull();
    expect(host.textContent).toContain("还有 11 天开庭");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-lawyer-today-item-mail-done"]')?.click();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/desk/plan/source-done",
      "POST",
      { source: "mail", sourceRef: "msg-1" },
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-lawyer-today-item-mail"]')?.click();
    });
    expect(onSelectMatter).toHaveBeenCalledWith("m1");
  });

  it("completes a carried plan against its origin date", async () => {
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return {
          ok: true,
          today: {
            date: "2026-09-17",
            items: [
              {
                id: "p-yest",
                kind: "plan",
                title: "改代理词",
                done: false,
                originDate: "2026-09-16",
              },
              { id: "mail:1", kind: "mail", title: "待回复 · 催稿", done: false, sourceRef: "msg-1" },
            ],
            progress: { done: 0, total: 2 },
          },
        };
      }
      if (path.startsWith("/api/desk/matters")) {
        return { ok: true, matters: [] };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          workspaceDir="/tmp/ws"
          selectedMatterId={null}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();

    expect(host.textContent).toContain("未结 · 自 9月16日");
    expect(host.textContent).toContain("含 1 项未结");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-lawyer-today-item-plan-carried"]')?.click();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/desk/plan/items/p-yest",
      "PATCH",
      { done: true, date: "2026-09-16" },
    );
  });

  it("reloads matter list when matterRefreshVersion bumps", async () => {
    const getJson = vi.mocked(apiGetJson);
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId={null}
          matterRefreshVersion={0}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();
    const callsBefore = getJson.mock.calls.filter((c) => c[1].startsWith("/api/desk/matters")).length;
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId={null}
          matterRefreshVersion={2}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();
    const callsAfter = getJson.mock.calls.filter((c) => c[1].startsWith("/api/desk/matters")).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("opens 谈话 pane and shows intake facts after a matter is selected", async () => {
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
      }
      if (path.startsWith("/api/desk/matters")) {
        return {
          ok: true,
          matters: [
            {
              matterId: "m1",
              title: "买卖合同纠纷",
              status: "open",
              matterKind: "litigation",
              matterKindLabel: "诉讼",
              openDeadlineCount: 0,
            },
          ],
        };
      }
      if (path.includes("/pulse")) {
        return {
          ok: true,
          pulse: {
            title: "买卖合同纠纷",
            status: "active",
            statusLabel: "进行中",
            clientId: "甲公司",
            counterparty: "乙公司",
            causeOfAction: "买卖合同纠纷",
            counts: { documents: 1, tasks: 1, files: 0, deadlines: 0, mail: 0, approvals: 0 },
            daysUntilHearing: null,
            documents: [{ id: "d1", title: "起诉状草稿", status: "待审核", taskId: "t1" }],
            tasks: [{ taskId: "t1", title: "起草起诉状", status: "drafted", updatedAt: "2026-09-09T10:00:00" }],
            files: [],
            mail: [],
            nextActions: ["补转账记录"],
          },
        };
      }
      if (path.includes("/intake-brief")) {
        return {
          ok: true,
          brief: {
            clientNeeds: ["要解除合同"],
            coreFacts: ["已付定金未交货"],
            issues: ["能否解除"],
            causeCandidates: [{ label: "买卖合同纠纷", reason: "词表命中" }],
            evidenceGaps: ["缺付款凭证"],
            nextActions: ["补转账记录"],
          },
        };
      }
      if (path.includes("/similar-cases")) {
        return { ok: true, hits: [] };
      }
      if (path.includes("/deadlines")) {
        return { ok: true, deadlines: [] };
      }
      return { ok: true };
    });
    vi.mocked(apiSendJson).mockResolvedValue({ ok: true, standards: [] });

    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId="m1"
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".lm-matter-card")?.click();
    });
    await flush();
    expect(host.textContent).toContain("买卖合同纠纷");
    expect(host.textContent).toContain("卷宗");
    expect(host.querySelector(".lm-matter-file")).toBeTruthy();
    expect(host.querySelector(".lm-overview")).toBeTruthy();
    expect(host.querySelector(".lm-status-table")).toBeNull();
    expect(host.querySelector(".lm-matter-hero-badges")).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-lawyer-pulse-bar"]')).toBeTruthy();
    expect(host.textContent).toContain("案件信息");
    expect(host.textContent).toContain("文书清单");
    expect(host.textContent).toContain("起诉状草稿");
    expect(host.textContent).toContain("乙公司");
    expect(host.textContent).toContain("本案下一步");
    expect(host.querySelector(".lm-overview-next-item")).toBeTruthy();
    expect(host.textContent).toContain("补转账记录");
    // 下一步应排在案件信息之前（动作优先）
    expect(host.querySelector('[data-testid="lm-lawyer-matter-parties"]')).toBeTruthy();
    expect(host.textContent).toContain("委托人");
    expect(host.querySelector('[data-testid="lm-lawyer-matter-party-card"]')?.textContent).toContain("甲公司");
    const overview = host.querySelector(".lm-overview")?.textContent ?? "";
    expect(overview.indexOf("本案下一步")).toBeLessThan(overview.indexOf("本案进展"));
    expect(overview.indexOf("本案进展")).toBeLessThan(overview.indexOf("当事人"));
    expect(overview.indexOf("当事人")).toBeLessThan(overview.indexOf("案件信息"));

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#lm-lawyer-tab-docket")?.click();
    });
    expect(host.querySelector('[data-testid="lm-lawyer-matter-parties-editor"]')).toBeTruthy();

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#lm-lawyer-tab-intake")?.click();
    });
    expect(host.querySelector('[data-testid="lm-lawyer-talk-input"]')).toBeTruthy();
    expect(host.textContent).toContain("要件事实");
    expect(host.textContent).toContain("已付定金未交货");
    expect(host.textContent).toContain("缺付款凭证");
    expect(host.querySelector('[data-testid="lm-lawyer-talk-drop"]')).toBeTruthy();
  });

  it("deadlines pane keeps confirm-write after extract preview", async () => {
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
      }
      if (path.startsWith("/api/desk/matters")) {
        return {
          ok: true,
          matters: [
            {
              matterId: "m1",
              title: "买卖合同纠纷",
              status: "open",
              matterKind: "litigation",
              matterKindLabel: "诉讼",
              openDeadlineCount: 0,
            },
          ],
        };
      }
      if (path.includes("/pulse")) {
        return {
          ok: true,
          pulse: {
            title: "买卖合同纠纷",
            status: "active",
            statusLabel: "进行中",
            counts: { documents: 0, tasks: 0, files: 0, deadlines: 0, mail: 0, approvals: 0 },
            daysUntilHearing: null,
            documents: [],
            tasks: [],
            files: [],
            mail: [],
            nextActions: [],
          },
        };
      }
      if (path.includes("/deadlines")) {
        return { ok: true, deadlines: [] };
      }
      if (path.includes("/intake-brief") || path.includes("/similar-cases")) {
        return { ok: true, brief: null, hits: [] };
      }
      return { ok: true };
    });
    vi.mocked(apiSendJson).mockImplementation(async (_base, path) => {
      if (path === "/api/desk/events/extract") {
        return {
          ok: true,
          events: [
            {
              eventKind: "hearing",
              title: "开庭",
              dueAt: "2026-10-12T01:00:00.000Z",
              confidence: "high",
            },
          ],
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId="m1"
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".lm-matter-card")?.click();
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>("#lm-lawyer-tab-deadlines")?.click();
    });
    await flush();
    expect(host.querySelector('[data-testid="lm-lawyer-deadlines-drop"]')).toBeTruthy();
    const ta = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="抽取期限材料"]');
    expect(ta).toBeTruthy();
    await act(async () => {
      if (!ta) {
        return;
      }
      ta.value = "传票：2026年10月12日开庭";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const btn = Array.from(host.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("抽出期限"),
      );
      btn?.click();
    });
    await flush();
    expect(host.textContent).toMatch(/确认写入/);
  });

  it("shows a read-only matter timeline and a first-class 材料 tab", async () => {
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
      }
      if (path.startsWith("/api/desk/matters")) {
        return {
          ok: true,
          matters: [
            {
              matterId: "m1",
              title: "买卖合同纠纷",
              status: "open",
              matterKind: "litigation",
              matterKindLabel: "诉讼",
              openDeadlineCount: 1,
            },
          ],
        };
      }
      if (path.includes("/pulse")) {
        return {
          ok: true,
          pulse: {
            title: "买卖合同纠纷",
            status: "active",
            statusLabel: "进行中",
            counts: {
              documents: 1,
              tasks: 0,
              files: 1,
              deadlines: 1,
              mail: 1,
              approvals: 0,
              materials: 1,
            },
            daysUntilHearing: 11,
            documents: [{ id: "d1", title: "起诉状草稿", status: "待审核", taskId: "t1" }],
            tasks: [],
            files: [{ label: "artifacts/起诉状.docx" }],
            materials: [
              {
                relPath: "materials/合同.docx",
                fileName: "合同.docx",
                size: 2048,
                updatedAt: "2026-09-08T10:00:00",
              },
            ],
            mail: [
              {
                id: "mail-1",
                subject: "请尽快确认要点",
                from: "wang@example.com",
                receivedAt: "2026-09-09T08:22:00",
                label: "needs_reply",
                labelZh: "待回复",
              },
            ],
            timeline: [
              {
                id: "deadline:h1",
                kind: "hearing",
                title: "开庭",
                at: "2026-09-20T09:00:00",
                meta: "开庭",
              },
              {
                id: "mail:mail-1",
                kind: "mail",
                title: "请尽快确认要点",
                at: "2026-09-09T08:22:00",
                meta: "待回复",
              },
              {
                id: "doc:d1",
                kind: "document",
                title: "起诉状草稿",
                at: "2026-09-08T10:00:00",
                meta: "待审核",
              },
            ],
            nextActions: [],
          },
        };
      }
      if (path.includes("/deadlines")) {
        return {
          ok: true,
          deadlines: [
            {
              deadlineId: "h1",
              title: "开庭",
              dueAt: "2026-09-20T09:00:00",
              status: "open",
              eventKind: "hearing",
              source: "document_extract",
              sourceLabel: "传票抽取",
              released: true,
            },
            {
              deadlineId: "a1",
              title: "上诉期限",
              dueAt: "2026-10-05T09:00:00",
              status: "open",
              eventKind: "limitation",
              source: "document_extract",
              sourceLabel: "传票抽取",
              released: false,
              waitingOnTitle: "开庭",
              dependsOnDeadlineId: "h1",
            },
          ],
        };
      }
      return { ok: true };
    });

    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId="m1"
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
          onShowArtifact={vi.fn()}
        />,
      );
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".lm-matter-card")?.click();
    });
    await flush();

    expect(host.querySelector('[data-testid="lm-lawyer-matter-timeline"]')).toBeTruthy();
    expect(host.textContent).toContain("本案进展");
    expect(host.textContent).toContain("开庭");
    expect(host.querySelector("#lm-lawyer-tab-materials")).toBeTruthy();
    const overview = host.querySelector(".lm-overview")?.textContent ?? "";
    expect(overview.indexOf("本案进展")).toBeLessThan(overview.indexOf("案件信息"));

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-lawyer-matter-timeline-item"]')?.click();
    });
    await flush();
    expect(host.querySelector("#lm-lawyer-pane-deadlines")).toBeTruthy();
    expect(host.textContent).toContain("期限 / 开庭");
    expect(host.textContent).toContain("传票抽取");
    expect(host.textContent).toContain("等「开庭」完成");
    expect(host.querySelector(".lm-deadline-depends")).toBeTruthy();

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#lm-lawyer-tab-docs")?.click();
    });
    await flush();
    expect(host.querySelector("#lm-lawyer-pane-docs")?.textContent).not.toContain("本案文件");

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#lm-lawyer-tab-materials")?.click();
    });
    await flush();
    const materials = host.querySelector('[data-testid="lm-lawyer-matter-materials"]');
    expect(materials).toBeTruthy();
    expect(materials?.textContent).toContain("合同.docx");
    expect(materials?.textContent).toContain("出稿路径");
    expect(materials?.textContent).toContain("artifacts/起诉状.docx");
    expect(host.querySelector("#lm-lawyer-tab-docket")).toBeTruthy();
  });

  it("lets mail without a matter still jump to chat", async () => {
    const onGoToChat = vi.fn();
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return {
          ok: true,
          today: {
            date: "2026-09-09",
            items: [{ id: "mail:orphan", kind: "mail", title: "待回复 · 询证函", done: false }],
            progress: { done: 0, total: 1 },
          },
        };
      }
      if (path.startsWith("/api/desk/matters")) {
        return { ok: true, matters: [] };
      }
      return { ok: true };
    });
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId={null}
          onSelectMatter={vi.fn()}
          onGoToChat={onGoToChat}
        />,
      );
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-lawyer-today-item-mail"]')?.click();
    });
    expect(onGoToChat).toHaveBeenCalledWith({
      prompt: expect.stringContaining("询证函"),
    });
  });

  it("opens 本案卷宗 from focus even if the list has not loaded the case yet", async () => {
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
      }
      if (path.startsWith("/api/desk/matters")) {
        return { ok: true, matters: [] };
      }
      if (path.includes("/pulse")) {
        return {
          ok: true,
          pulse: {
            matterId: "新收租赁案",
            title: "新收租赁案",
            status: "intake",
            statusLabel: "收案",
            counts: { documents: 0, tasks: 0, files: 0, deadlines: 0, mail: 0, approvals: 0 },
            daysUntilHearing: null,
            documents: [],
            tasks: [],
            files: [],
            mail: [],
            nextActions: [],
          },
        };
      }
      return { ok: true };
    });
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId={null}
          deskMatterFocus={{ id: "新收租赁案", n: 1 }}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();
    await flush();
    expect(host.querySelector('[data-testid="lm-lawyer-matter-dossier"]')).toBeTruthy();
    expect(host.textContent).toContain("新收租赁案");
    expect(host.textContent).not.toContain("选一个案件");
  });
});
