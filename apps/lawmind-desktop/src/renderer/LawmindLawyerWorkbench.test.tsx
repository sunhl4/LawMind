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
          selectedMatterId={null}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();
    expect(host.querySelector('[data-testid="lm-lawyer-workbench"]')).toBeTruthy();
    expect(host.textContent).toContain("工作台");
    expect(host.querySelector('[data-testid="lm-lawyer-cockpit"]')).toBeTruthy();
    expect(host.querySelectorAll(".lm-desk-col")).toHaveLength(3);
    expect(host.textContent).toContain("快捷入口");
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
    expect(host.querySelector('[data-testid="lm-lawyer-stat-mail"]')?.textContent).toContain("1");
    expect(host.querySelector('[data-testid="lm-lawyer-progress-board"]')?.textContent).toContain("写代理词");
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
    expect(host.querySelector(".lm-status-table")).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-lawyer-pulse-bar"]')).toBeTruthy();
    expect(host.textContent).toContain("案件信息");
    expect(host.textContent).toContain("文书清单");
    expect(host.textContent).toContain("起诉状草稿");
    expect(host.textContent).toContain("乙公司");

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#lm-lawyer-tab-intake")?.click();
    });
    expect(host.querySelector('[data-testid="lm-lawyer-talk-input"]')).toBeTruthy();
    expect(host.textContent).toContain("要件事实");
    expect(host.textContent).toContain("已付定金未交货");
    expect(host.textContent).toContain("缺付款凭证");
  });
});
