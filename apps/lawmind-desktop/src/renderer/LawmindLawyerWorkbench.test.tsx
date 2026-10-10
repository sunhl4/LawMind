/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGetJson, apiSendJson } from "./api-client";
import { LawmindLawyerWorkbench } from "./LawmindLawyerWorkbench";

const openDeliverableInWps = vi.fn(async (..._args: unknown[]) => ({ ok: true as const }));
const openDocxInReviewSurface = vi.fn(async (..._args: unknown[]) => undefined);
const requestOpenContractRevision = vi.fn((..._args: unknown[]) => undefined);
const requestOpenWorkspaceFile = vi.fn((..._args: unknown[]) => undefined);

vi.mock("./canvas/host-actions", async () => {
  const actual = await vi.importActual<typeof import("./canvas/host-actions")>("./canvas/host-actions");
  return {
    ...actual,
    openDeliverableInWps: (...args: unknown[]) => openDeliverableInWps(...args),
  };
});

vi.mock("./lawmind-open-contract-revision", async () => {
  const actual =
    await vi.importActual<typeof import("./lawmind-open-contract-revision")>(
      "./lawmind-open-contract-revision",
    );
  return {
    ...actual,
    openDocxInReviewSurface: (...args: unknown[]) => openDocxInReviewSurface(...args),
  };
});

vi.mock("./lawmind-workspace-file-open", async () => {
  const actual =
    await vi.importActual<typeof import("./lawmind-workspace-file-open")>(
      "./lawmind-workspace-file-open",
    );
  return {
    ...actual,
    requestOpenContractRevision: (...args: unknown[]) => requestOpenContractRevision(...args),
    requestOpenWorkspaceFile: (...args: unknown[]) => requestOpenWorkspaceFile(...args),
  };
});

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async (_base: string, path: string) => {
    if (path === "/api/desk/today") {
      return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
    }
    if (path.startsWith("/api/desk/matters")) {
      return { ok: true, matters: [] };
    }
    if (path.includes("/brief")) {
      return { ok: false, reason: "model_unconfigured" };
    }
    return { ok: true };
  }),
  apiSendJson: vi.fn(async (_base: string, path: string) => {
    if (path === "/api/desk/hotlines") {
      return { ok: false, reason: "model_unconfigured" };
    }
    return { ok: true };
  }),
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
    openDeliverableInWps.mockClear();
    openDocxInReviewSurface.mockClear();
    requestOpenContractRevision.mockClear();
    requestOpenWorkspaceFile.mockClear();
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

  it("opens on today's agenda, not the case list", async () => {
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
    expect(host.querySelector('[data-testid="lm-desk-agenda"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="今日提醒"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="案件"]')).toBeNull();
    expect(host.textContent).toContain("今日提醒");
    expect(host.textContent).not.toContain("本案动作");
    expect(host.querySelector(".lm-lawyer-fab")).toBeNull();
    expect(host.querySelector('[data-testid="lm-lawyer-today-plan-input"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-agenda-empty"]')).toBeTruthy();
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

  it("surfaces agenda items and opens case management from a reminder", async () => {
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
                dueAt: "2000-01-01T00:00:00.000Z",
                sourceRef: "dl-1",
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
            {
              matterId: "m2",
              title: "安静顾问",
              status: "open",
              matterKind: "general",
              matterKindLabel: "其他",
              openDeadlineCount: 0,
              daysUntilHearing: null,
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

    expect(host.querySelector('[data-testid="lm-desk-agenda"]')).toBeTruthy();
    expect(host.textContent).toContain("写代理词");
    expect(host.textContent).toContain("举证期限");
    expect(host.querySelector('[data-testid="lm-lawyer-desk-kicker"]')?.textContent).toMatch(/ws · 2 个案件/);
    expect(host.querySelector('[data-testid="lm-desk-urgency-strip"]')?.textContent).toContain("1 个期限已过");
    expect(host.querySelector('[data-testid="lm-desk-urgency-strip"]')?.textContent).toContain("1 封未回");
    expect(host.querySelector('[data-testid="lm-lawyer-today-plan-input"]')).toBeTruthy();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-desk-agenda-open-matter"]')?.click();
    });
    expect(onSelectMatter).toHaveBeenCalledWith("m1");

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
    await act(async () => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "全部案卷")?.click();
    });
    await flush();
    expect(host.querySelector('[aria-label="案件"]')).toBeTruthy();
    const rows = [...host.querySelectorAll('[data-testid="lm-matter-row"]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("买卖合同纠纷"),
      expect.stringContaining("安静顾问"),
    ]);
    expect(rows[0]?.querySelector('[data-testid="lm-matter-hotline"]')?.textContent).toBe("期限已过");
  });

  it("shows carried plans on the agenda home", async () => {
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
    expect(host.textContent).toContain("改代理词");
    expect(host.querySelector('[data-testid="lm-lawyer-today-plan-input"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-desk-urgency-strip"]')?.textContent).toContain("1 封未回");
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
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "全部案卷")?.click();
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".lm-matter-card")?.click();
    });
    await flush();
    expect(host.textContent).toContain("买卖合同纠纷");
    expect(host.textContent).toContain("接着办");
    expect(host.querySelector(".lm-matter-file")).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-matter-now"]')).toBeNull();
    expect(host.querySelector("#lm-lawyer-tab-overview")).toBeNull();
    expect(host.querySelector("#lm-lawyer-tab-deadlines")).toBeNull();
    expect(host.querySelector("#lm-lawyer-tab-volume")).toBeNull();
    expect(host.querySelector("#lm-lawyer-tab-materials")).toBeNull();
    expect(host.querySelector("#lm-lawyer-tab-docs")).toBeNull();
    expect(host.textContent).not.toContain("本案下一步");
    expect(host.textContent).not.toContain("文书清单");
    expect(host.textContent).toContain("我们写的");
    expect(host.textContent).toContain("起诉状草稿");
    expect(host.textContent).toContain("对方 乙公司");
    expect(host.querySelector('[data-testid="lm-lawyer-matter-parties"]')).toBeTruthy();
    expect(host.textContent).toContain("委托人");
    expect(host.querySelector('[data-testid="lm-lawyer-matter-party-card"]')?.textContent).toContain("甲公司");
    const archive = host.querySelector('[data-testid="lm-matter-archive"]');
    expect(archive).toBeTruthy();
    expect(archive?.querySelector("summary")?.textContent).toContain("档案");
    expect((archive as HTMLDetailsElement).open).toBe(false);

    expect(host.querySelector('[data-testid="lm-lawyer-matter-parties-editor"]')).toBeTruthy();
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
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "全部案卷")?.click();
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".lm-matter-card")?.click();
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

  it("shows one volume list and keeps the timeline in the archive", async () => {
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
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "全部案卷")?.click();
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".lm-matter-card")?.click();
    });
    await flush();

    expect(host.querySelector('[data-testid="lm-matter-now"]')).toBeTruthy();
    expect(host.textContent).toContain("去对话起草");
    expect(host.querySelector('[data-testid="lm-lawyer-matter-timeline"]')).toBeTruthy();
    expect(host.textContent).toContain("本案进展");
    expect(host.textContent).toContain("邀请同事");
    expect(host.querySelector("#lm-lawyer-tab-volume")).toBeNull();
    expect(host.querySelector("#lm-lawyer-pane-deadlines")).toBeTruthy();
    expect(host.textContent).toContain("全部期限");
    expect(host.textContent).toContain("传票抽取");
    expect(host.textContent).toContain("等「开庭」完成");
    expect(host.querySelector(".lm-deadline-depends")).toBeTruthy();

    const materials = host.querySelector('[data-testid="lm-lawyer-matter-materials"]');
    expect(materials).toBeTruthy();
    expect(materials?.textContent).toContain("来件");
    expect(materials?.textContent).toContain("合同.docx");
    expect(materials?.textContent).toContain("我们写的");
    expect(materials?.textContent).toContain("起诉状草稿");
    expect(materials?.textContent).toContain("其余");
    expect(materials?.textContent).toContain("artifacts/起诉状.docx");
    const volumeText = materials?.textContent ?? "";
    expect(volumeText.indexOf("来件")).toBeLessThan(volumeText.indexOf("我们写的"));
    expect(volumeText.indexOf("我们写的")).toBeLessThan(volumeText.indexOf("其余"));
    expect(materials?.textContent).toContain("预览核对");
    expect(materials?.textContent).toContain("用本机应用打开");
  });

  it("opens volume files via middle-panel preview or local app", async () => {
    const onOpenReview = vi.fn();
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
            counts: {
              documents: 1,
              tasks: 0,
              files: 1,
              deadlines: 0,
              mail: 0,
              approvals: 0,
              materials: 1,
            },
            daysUntilHearing: null,
            documents: [
              {
                id: "d1",
                title: "起诉状草稿",
                status: "待审核",
                taskId: "t1",
                outputPath: "cases/m1/artifacts/起诉状.docx",
              },
            ],
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
          selectedMatterId="m1"
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
          onOpenReview={onOpenReview}
        />,
      );
    });
    await flush();
    await act(async () => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "全部案卷")?.click();
    });
    await flush();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".lm-matter-card")?.click();
    });
    await flush();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-volume-doc-preview"]')?.click();
    });
    expect(onOpenReview).toHaveBeenCalledWith({ matterId: "m1", taskId: "t1" });

    await act(async () => {
      host.querySelectorAll<HTMLButtonElement>('[data-testid="lm-materials-file-open-app"]')[0]?.click();
    });
    expect(openDeliverableInWps).toHaveBeenCalledWith("cases/m1/materials/合同.docx");

    await act(async () => {
      host.querySelectorAll<HTMLButtonElement>('[data-testid="lm-materials-file-preview"]')[0]?.click();
    });
    expect(openDocxInReviewSurface).toHaveBeenCalledWith(
      expect.objectContaining({ relPath: "cases/m1/materials/合同.docx" }),
    );
  });

  it("counts unreplied mail on the strip even when it has no case", async () => {
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
    expect(host.querySelector('[data-testid="lm-desk-urgency-strip"]')?.textContent).toContain("1 封未回");
    expect(host.querySelector('[data-testid="lm-lawyer-today-item-mail"]')).toBeTruthy();
    expect(host.textContent).toContain("待回复 · 询证函");
    expect(onGoToChat).not.toHaveBeenCalled();
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
    const onDeleteMatter = vi.fn();
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId={null}
          deskMatterFocus={{ id: "新收租赁案", n: 1 }}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
          onDeleteMatter={onDeleteMatter}
        />,
      );
    });
    await flush();
    await flush();
    expect(host.querySelector('[data-testid="lm-lawyer-matter-dossier"]')).toBeTruthy();
    expect(host.textContent).toContain("新收租赁案");
    expect(host.textContent).toContain("接着办");
    expect(host.textContent).toContain("案由里的「合同纠纷」仍是诉讼");
    expect(host.textContent).not.toContain("选一个案件");
    expect(host.querySelector('[data-testid="lm-matter-now"]')).toBeNull();
    const deleteBtn = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "删除案件");
    expect(deleteBtn).toBeTruthy();
    await act(async () => {
      deleteBtn?.click();
    });
    expect(onDeleteMatter).toHaveBeenCalledWith("新收租赁案", "新收租赁案");
  });

  it("puts outbound at the top of 现在 and opens that block from a docs deep link", async () => {
    vi.mocked(apiGetJson).mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/desk/today") {
        return { ok: true, today: { date: "2026-09-09", items: [], progress: { done: 0, total: 0 } } };
      }
      if (path.startsWith("/api/action-summary")) {
        return {
          automationInbox: [
            {
              id: "in-1",
              automationId: "a",
              matterId: "m1",
              title: "发给对方的函",
              summary: "",
              status: "open",
              createdAt: "2026-09-09T00:00:00.000Z",
              pendingSend: { to: "wang@example.com", subject: "关于履行", body: "请查收", attachmentRelativePaths: [] },
            },
          ],
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
              matterKind: "contract",
              matterKindLabel: "合同",
              openDeadlineCount: 0,
            },
          ],
        };
      }
      if (path.includes("/pulse")) {
        return {
          ok: true,
          pulse: {
            matterId: "m1",
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
      return { ok: true };
    });
    await act(async () => {
      root.render(
        <LawmindLawyerWorkbench
          apiBase="http://127.0.0.1:9"
          selectedMatterId={null}
          deskMatterFocus={{ id: "m1", n: 1, pane: "docs" }}
          onSelectMatter={vi.fn()}
          onGoToChat={vi.fn()}
        />,
      );
    });
    await flush();
    await flush();
    const now = host.querySelector('[data-testid="lm-matter-now"]');
    expect(now).toBeTruthy();
    expect(now?.textContent).toContain("待发出");
    expect(now?.textContent).toContain("wang@example.com");
    const dossier = host.querySelector('[data-testid="lm-lawyer-matter-dossier"]');
    const nowIndex = dossier?.innerHTML.indexOf('data-testid="lm-matter-now"') ?? -1;
    const volumeIndex = dossier?.innerHTML.indexOf('data-testid="lm-lawyer-matter-materials"') ?? -1;
    expect(nowIndex).toBeGreaterThanOrEqual(0);
    expect(nowIndex).toBeLessThan(volumeIndex);
    expect(host.querySelector('[data-testid="lm-matter-hotline"]')).toBeNull();
  });
});
