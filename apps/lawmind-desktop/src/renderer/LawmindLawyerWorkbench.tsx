/**
 * 工作台：今日计划、案件门类、期限与谈话摘要。律师打开 LawMind 先看这里。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage, fetchApi } from "./api-client";
import { triggerBrowserDownload } from "./review/review-workbench-helpers";
import { LEGAL_EVENT_KIND_LABELS, type ExtractedLegalEvent } from "../../../../src/lawmind/desk/legal-event-extract.ts";
import { MATTER_KIND_LABELS, type MatterKind } from "../../../../src/lawmind/desk/matter-kind.ts";
import { taskLifecycleLabel } from "./matter/matter-display-labels";

type TodayItemKind = "plan" | "mail" | "deadline" | "approval";

type TodayItem = {
  id: string;
  kind: TodayItemKind;
  title: string;
  done: boolean;
  matterId?: string;
  dueAt?: string;
  sourceRef?: string;
};

type TodaySnapshot = {
  date: string;
  items: TodayItem[];
  progress: { done: number; total: number };
};

type DeskMatterRow = {
  matterId: string;
  title: string;
  status: string;
  matterKind: MatterKind;
  matterKindLabel: string;
  clientId?: string;
  openDeadlineCount: number;
  nextHearingAt?: string;
  daysUntilHearing?: number | null;
  openTaskCount?: number;
  docket?: { caseNo?: string; court?: string; instance?: string; standing?: string; hearingAt?: string };
};

type DeadlineRow = {
  deadlineId: string;
  title: string;
  dueAt: string;
  status: string;
  eventKind?: string;
};

type IntakeBriefView = {
  clientNeeds: string[];
  coreFacts: string[];
  issues?: string[];
  causeCandidates: Array<{ label: string; reason: string }>;
  evidenceGaps: string[];
  nextActions: string[];
  confirmedAt?: string;
};

type SimilarHit = {
  matterId: string;
  score: number;
  snippet: string;
  causeOfAction?: string;
  evidenceHints: string[];
  displayWarning: string;
};

type AppliedStandard = { id: string; title: string };

type MatterPulseView = {
  title: string;
  status: string;
  statusLabel: string;
  clientId?: string;
  counterparty?: string;
  causeOfAction?: string;
  ownerLawyerId?: string;
  createdAt?: string;
  counts: {
    documents: number;
    tasks: number;
    files: number;
    deadlines: number;
    mail: number;
    approvals: number;
  };
  daysUntilHearing: number | null;
  documents: Array<{ id: string; title: string; status: string; at?: string; taskId?: string; outputPath?: string }>;
  tasks: Array<{ taskId: string; title: string; status: string; updatedAt: string }>;
  files: Array<{ label: string }>;
  mail: Array<{ id: string; subject: string; from: string; receivedAt: string; label: string; labelZh: string }>;
  nextActions: string[];
  intakeConfirmedAt?: string;
};

type MatterPaneId = "overview" | "docket" | "docs" | "deadlines" | "intake" | "review";

export type LawmindLawyerWorkbenchProps = {
  apiBase: string;
  selectedMatterId: string | null;
  onSelectMatter: (matterId: string) => void;
  onGoToChat: (opts: { matterId?: string; prompt?: string }) => void;
  onOpenNeedsDecision?: (matterId?: string) => void;
  onCreateMatter?: () => void;
  onOpenReview?: (opts: { matterId: string; taskId?: string }) => void;
  onShowArtifact?: (relPath: string) => void;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
};

const KIND_FILTERS: Array<{ id: "all" | MatterKind; label: string }> = [
  { id: "all", label: "全部" },
  { id: "contract", label: "合同" },
  { id: "litigation", label: "诉讼" },
  { id: "general", label: "其他" },
];

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function formatDeskDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map((part) => Number(part));
  if (!y || !m || !d) {
    return isoDate;
  }
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 周${WEEKDAYS[dt.getDay()]}`;
}

function formatDueShort(dueAt?: string): string {
  if (!dueAt) {
    return "";
  }
  return dueAt.slice(0, 16).replace("T", " ");
}

function formatClock(dueAt?: string): string {
  if (!dueAt) {
    return "全天";
  }
  const clock = dueAt.slice(11, 16);
  if (clock && clock !== "00:00") {
    return clock;
  }
  return dueAt.slice(5, 10);
}

function isOverdue(dueAt: string | undefined, now = new Date()): boolean {
  if (!dueAt) {
    return false;
  }
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  return due.getTime() < now.getTime();
}

function countKind(items: TodayItem[], kind: TodayItemKind, openOnly = false): number {
  return items.filter((item) => item.kind === kind && (!openOnly || !item.done)).length;
}

function eventKindLabel(eventKind: string | undefined): string {
  if (!eventKind) {
    return "期限";
  }
  return LEGAL_EVENT_KIND_LABELS[eventKind as keyof typeof LEGAL_EVENT_KIND_LABELS] ?? eventKind;
}

function matterStatusZh(status: string | undefined): string {
  if (!status) {
    return "未标";
  }
  const labels: Record<string, string> = {
    intake: "收案",
    active: "进行中",
    open: "进行中",
    waiting_on_client: "等客户",
    waiting_on_firm: "等所内",
    under_review: "审查中",
    delivered: "已交付",
    closed: "已结",
  };
  return labels[status] ?? status;
}

function hearingCountdown(days: number | null | undefined): string | null {
  if (days === null || days === undefined) {
    return null;
  }
  if (days < 0) {
    return `开庭已过 ${-days} 天`;
  }
  if (days === 0) {
    return "今天开庭";
  }
  return `还有 ${days} 天开庭`;
}

function todayKindZh(kind: TodayItemKind): string {
  if (kind === "plan") {
    return "计划";
  }
  if (kind === "mail") {
    return "邮件";
  }
  if (kind === "deadline") {
    return "期限";
  }
  return "拍板";
}

function mailSourceRef(item: TodayItem): string | undefined {
  const explicit = item.sourceRef?.trim();
  if (explicit) {
    return explicit;
  }
  const tail = item.id.replace(/^mail:/, "");
  const colon = tail.lastIndexOf(":");
  return (colon >= 0 ? tail.slice(colon + 1) : tail).trim() || undefined;
}

function DeskServiceAlert({
  err,
  onReconnect,
  reconnecting,
}: {
  err: string | null;
  onReconnect?: () => void | Promise<void>;
  reconnecting?: boolean;
}): ReactNode {
  if (!err) {
    return null;
  }
  return (
    <div className="lm-lawyer-alert" role="alert">
      <p className="lm-error">{err}</p>
      {onReconnect ? (
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          data-testid="lm-lawyer-reconnect"
          disabled={reconnecting}
          onClick={() => void onReconnect()}
        >
          {reconnecting ? "连接中…" : "重新连接"}
        </button>
      ) : null}
    </div>
  );
}

export function LawmindLawyerWorkbench(props: LawmindLawyerWorkbenchProps): ReactNode {
  const {
    apiBase,
    selectedMatterId,
    onSelectMatter,
    onGoToChat,
    onOpenNeedsDecision,
    onCreateMatter,
    onOpenReview,
    onShowArtifact,
    onReconnectLocalService,
    localServiceReconnecting,
  } = props;
  const [kind, setKind] = useState<"all" | MatterKind>("all");
  const [matterPane, setMatterPane] = useState<MatterPaneId>("overview");
  const [today, setToday] = useState<TodaySnapshot | null>(null);
  const [matters, setMatters] = useState<DeskMatterRow[]>([]);
  const [planDraft, setPlanDraft] = useState("");
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [brief, setBrief] = useState<IntakeBriefView | null>(null);
  const [similar, setSimilar] = useState<SimilarHit[]>([]);
  const [standards, setStandards] = useState<AppliedStandard[]>([]);
  const [extractText, setExtractText] = useState("");
  const [extracted, setExtracted] = useState<ExtractedLegalEvent[]>([]);
  const [talk, setTalk] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [docket, setDocket] = useState({ caseNo: "", court: "", instance: "", standing: "", hearingAt: "" });
  const [clientId, setClientId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [pulse, setPulse] = useState<MatterPulseView | null>(null);
  const [matterKind, setMatterKind] = useState<MatterKind>("general");
  const [desk, setDesk] = useState<"cockpit" | "matter">("cockpit");
  const [openedMatterId, setOpenedMatterId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const autoReconnectRef = useRef(false);
  const reconnectRef = useRef(onReconnectLocalService);
  reconnectRef.current = onReconnectLocalService;

  const viewingId = desk === "matter" ? (openedMatterId ?? selectedMatterId) : null;
  const selected = useMemo(
    () => matters.find((m) => m.matterId === viewingId) ?? null,
    [matters, viewingId],
  );

  const todayItems = today?.items ?? [];
  const actionItems = todayItems.filter((item) => item.kind === "plan" || item.kind === "mail" || item.kind === "approval");
  const deadlineItems = todayItems.filter((item) => item.kind === "deadline");
  const mailOpen = countKind(todayItems, "mail", true);
  const deadlineOpen = countKind(todayItems, "deadline", true);
  const approvalOpen = countKind(todayItems, "approval", true);
  const actionOpen = actionItems.filter((item) => !item.done).length;
  const progressDone = today?.progress?.done ?? 0;
  const progressTotal = today?.progress?.total ?? 0;
  const openDeadlines = deadlines.filter((d) => d.status === "open" || d.status === "snoozed").length;
  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const shownActions = actionItems.filter((item) => matches(item.title));
  const shownDeadlines = deadlineItems.filter((item) => matches(item.title));
  const shownMatters = matters
    .filter(
      (row) =>
        matches(row.title) ||
        matches(row.matterKindLabel) ||
        matches(row.docket?.caseNo ?? "") ||
        matches(row.docket?.court ?? ""),
    )
    .slice()
    .toSorted((a, b) => {
      const rank = (row: DeskMatterRow) => {
        if (row.status === "closed" || row.status === "delivered") {
          return 800;
        }
        if (typeof row.daysUntilHearing === "number") {
          return row.daysUntilHearing;
        }
        if ((row.openDeadlineCount ?? 0) > 0) {
          return 60;
        }
        if (row.status === "intake") {
          return 200;
        }
        return 120;
      };
      return rank(a) - rank(b);
    });

  const reloadToday = useCallback(async () => {
    const j = await apiGetJson<{ ok?: boolean; today?: TodaySnapshot }>(apiBase, "/api/desk/today");
    if (j.ok && j.today) {
      setToday(j.today);
    }
  }, [apiBase]);

  const reloadMatters = useCallback(async () => {
    const q = kind === "all" ? "" : `?kind=${kind}`;
    const j = await apiGetJson<{ ok?: boolean; matters?: DeskMatterRow[] }>(apiBase, `/api/desk/matters${q}`);
    if (j.ok && j.matters) {
      setMatters(j.matters);
    }
  }, [apiBase, kind]);

  const reloadPulse = useCallback(async () => {
    if (!viewingId) {
      return;
    }
    const pulseRow = await apiGetJson<{ ok?: boolean; pulse?: MatterPulseView }>(
      apiBase,
      `/api/matters/${encodeURIComponent(viewingId)}/pulse`,
    );
    setPulse(pulseRow.pulse ?? null);
  }, [apiBase, viewingId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([reloadToday(), reloadMatters()])
      .then(() => {
        if (!cancelled) {
          setErr(null);
        }
      })
      .catch((e) => {
        if (cancelled) {
          return;
        }
        const msg = errorMessage(e, "工作台加载失败");
        setErr(msg);
        if (
          !autoReconnectRef.current &&
          msg.includes("无法连接本地服务") &&
          reconnectRef.current
        ) {
          autoReconnectRef.current = true;
          void Promise.resolve(reconnectRef.current()).catch(() => undefined);
        }
      });
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void Promise.all([reloadToday(), reloadMatters()])
          .then(() => {
            if (!cancelled) {
              setErr(null);
            }
          })
          .catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reloadToday, reloadMatters]);

  useEffect(() => {
    if (!viewingId) {
      setDeadlines([]);
      setBrief(null);
      setSimilar([]);
      setStandards([]);
      setPulse(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [dl, ib, sim, row, pulseRow] = await Promise.all([
          apiGetJson<{ ok?: boolean; deadlines?: DeadlineRow[] }>(
            apiBase,
            `/api/matters/${encodeURIComponent(viewingId)}/deadlines`,
          ),
          apiGetJson<{ ok?: boolean; brief?: IntakeBriefView | null }>(
            apiBase,
            `/api/matters/${encodeURIComponent(viewingId)}/intake-brief`,
          ),
          apiGetJson<{ ok?: boolean; hits?: SimilarHit[] }>(
            apiBase,
            `/api/matters/${encodeURIComponent(viewingId)}/similar-cases`,
          ),
          apiSendJson<{ ok?: boolean; standards?: AppliedStandard[] }, { instruction: string; clientId?: string }>(
            apiBase,
            "/api/desk/standards/match",
            "POST",
            { instruction: selected?.title ?? "", clientId: selected?.clientId },
          ),
          apiGetJson<{ ok?: boolean; pulse?: MatterPulseView }>(
            apiBase,
            `/api/matters/${encodeURIComponent(viewingId)}/pulse`,
          ),
        ]);
        if (cancelled) {
          return;
        }
        setDeadlines(dl.deadlines ?? []);
        setBrief(ib.brief ?? null);
        setSimilar(sim.hits ?? []);
        setStandards(row.standards ?? []);
        setPulse(pulseRow.pulse ?? null);
        const d = selected?.docket;
        setDocket({
          caseNo: d?.caseNo ?? "",
          court: d?.court ?? "",
          instance: d?.instance ?? "",
          standing: d?.standing ?? "",
          hearingAt: d?.hearingAt ?? "",
        });
        setClientId(pulseRow.pulse?.clientId ?? selected?.clientId ?? "");
        setCounterparty(pulseRow.pulse?.counterparty ?? "");
        setMatterKind(selected?.matterKind ?? "general");
      } catch (e) {
        if (!cancelled) {
          setErr(errorMessage(e, "案件详情加载失败"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, viewingId, selected?.title, selected?.clientId, selected?.docket, selected?.matterKind]);

  const addPlan = async () => {
    const lines = planDraft
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; today?: TodaySnapshot }, { texts: string[] }>(
        apiBase,
        "/api/desk/plan",
        "POST",
        { texts: lines },
      );
      if (j.today) {
        setToday(j.today);
      }
      setPlanDraft("");
    } catch (e) {
      setErr(errorMessage(e, "保存计划失败"));
    } finally {
      setBusy(false);
    }
  };

  const togglePlan = async (item: TodayItem) => {
    if (item.kind !== "plan") {
      return;
    }
    try {
      const j = await apiSendJson<{ ok?: boolean; today?: TodaySnapshot }, { done: boolean }>(
        apiBase,
        `/api/desk/plan/items/${encodeURIComponent(item.id)}`,
        "PATCH",
        { done: !item.done },
      );
      if (j.today) {
        setToday(j.today);
      }
    } catch (e) {
      setErr(errorMessage(e, "更新计划失败"));
    }
  };

  const openMatter = (matterId: string, pane: MatterPaneId = "overview") => {
    setOpenedMatterId(matterId);
    setMatterPane(pane);
    setDesk("matter");
    onSelectMatter(matterId);
  };

  const activateTodayItem = (item: TodayItem) => {
    if (item.kind === "plan") {
      void togglePlan(item);
      return;
    }
    if (item.kind === "mail") {
      if (item.matterId) {
        openMatter(item.matterId);
        onGoToChat({
          matterId: item.matterId,
          prompt: `请根据本案待回复「${item.title}」起草今日回信，先出草稿，不要发送。`,
        });
      }
      return;
    }
    if (item.kind === "deadline" && item.matterId) {
      openMatter(item.matterId, "deadlines");
      return;
    }
    if (item.kind === "approval") {
      if (item.matterId) {
        onSelectMatter(item.matterId);
      }
      onOpenNeedsDecision?.(item.matterId);
    }
  };

  const markMailReplied = async (item: TodayItem) => {
    const sourceRef = mailSourceRef(item);
    if (!sourceRef) {
      return;
    }
    try {
      const j = await apiSendJson<
        { ok?: boolean; today?: TodaySnapshot },
        { source: "mail"; sourceRef: string }
      >(apiBase, "/api/desk/plan/source-done", "POST", { source: "mail", sourceRef });
      if (j.today) {
        setToday(j.today);
      } else {
        await reloadToday();
      }
    } catch (e) {
      setErr(errorMessage(e, "标记已回失败"));
    }
  };

  const completeDeadline = async (deadlineId: string) => {
    if (!viewingId) {
      return;
    }
    await apiSendJson(apiBase, `/api/matters/${encodeURIComponent(viewingId)}/deadlines/${encodeURIComponent(deadlineId)}`, "PATCH", {
      status: "completed",
    });
    await reloadToday();
    const dl = await apiGetJson<{ deadlines?: DeadlineRow[] }>(
      apiBase,
      `/api/matters/${encodeURIComponent(viewingId)}/deadlines`,
    );
    setDeadlines(dl.deadlines ?? []);
    await reloadPulse();
  };

  const runExtract = async () => {
    setBusy(true);
    setErr(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; events?: ExtractedLegalEvent[] }, { text: string }>(
        apiBase,
        "/api/desk/events/extract",
        "POST",
        { text: extractText },
      );
      setExtracted(j.events ?? []);
    } catch (e) {
      setErr(errorMessage(e, "抽取失败"));
    } finally {
      setBusy(false);
    }
  };

  const confirmEvents = async () => {
    if (!viewingId) {
      setErr("请先打开一个案件，再确认写入期限。");
      return;
    }
    const events = extracted.filter((e) => e.dueAt);
    if (events.length === 0) {
      setErr("没有可确认的日期，请补全材料或手填期限。");
      return;
    }
    setBusy(true);
    try {
      await apiSendJson(apiBase, "/api/desk/events/confirm", "POST", {
        matterId: viewingId,
        events: events.map((e) => ({
          eventKind: e.eventKind,
          title: e.title,
          dueAt: e.dueAt,
          notes: e.notes,
        })),
      });
      setExtracted([]);
      setExtractText("");
      await reloadToday();
      await reloadMatters();
      const dl = await apiGetJson<{ deadlines?: DeadlineRow[] }>(
        apiBase,
        `/api/matters/${encodeURIComponent(viewingId)}/deadlines`,
      );
      setDeadlines(dl.deadlines ?? []);
      await reloadPulse();
    } catch (e) {
      setErr(errorMessage(e, "写入期限失败"));
    } finally {
      setBusy(false);
    }
  };

  const compileTalk = async () => {
    if (!viewingId) {
      setErr("请先选一个诉讼案件，再整理谈话。");
      return;
    }
    setBusy(true);
    try {
      const j = await apiSendJson<{ ok?: boolean; brief?: IntakeBriefView }, { transcript: string }>(
        apiBase,
        `/api/matters/${encodeURIComponent(viewingId)}/intake-brief`,
        "POST",
        { transcript: talk },
      );
      setBrief(j.brief ?? null);
    } catch (e) {
      setErr(errorMessage(e, "谈话整理失败"));
    } finally {
      setBusy(false);
    }
  };

  const applyCause = async (label: string) => {
    if (!viewingId) {
      return;
    }
    const j = await apiSendJson<{ brief?: IntakeBriefView | null }, { causeOfAction: string }>(
      apiBase,
      `/api/matters/${encodeURIComponent(viewingId)}/cause`,
      "POST",
      { causeOfAction: label },
    );
    if (j.brief) {
      setBrief(j.brief);
    }
    await reloadPulse();
    await reloadMatters();
  };

  const confirmIntake = async () => {
    if (!viewingId) {
      return;
    }
    setBusy(true);
    try {
      const j = await apiSendJson<{ brief?: IntakeBriefView }, Record<string, never>>(
        apiBase,
        `/api/matters/${encodeURIComponent(viewingId)}/intake-brief/confirm`,
        "POST",
        {},
      );
      if (j.brief) {
        setBrief(j.brief);
      }
      await reloadPulse();
    } catch (e) {
      setErr(errorMessage(e, "写入档案失败"));
    } finally {
      setBusy(false);
    }
  };

  const saveDocket = async () => {
    if (!viewingId) {
      return;
    }
    setBusy(true);
    try {
      await apiSendJson(apiBase, "/api/matters/profile", "POST", {
        matterId: viewingId,
        matterKind,
        clientId: clientId.trim() || undefined,
        counterparty: counterparty.trim() || undefined,
        docket: {
          caseNo: docket.caseNo,
          court: docket.court,
          instance: docket.instance,
          standing: docket.standing,
          hearingAt: docket.hearingAt,
        },
      });
      await reloadMatters();
      await reloadPulse();
    } catch (e) {
      setErr(errorMessage(e, "保存卷宗失败"));
    } finally {
      setBusy(false);
    }
  };

  const exportIcs = async () => {
    if (!viewingId) {
      return;
    }
    try {
      const resp = await fetchApi(
        `${apiBase.replace(/\/$/, "")}/api/matters/${encodeURIComponent(viewingId)}/deadlines.ics`,
        {},
        { tag: "deadlines.ics" },
      );
      const blob = await resp.blob();
      triggerBrowserDownload(blob, `${viewingId}-deadlines.ics`);
    } catch (e) {
      setErr(errorMessage(e, "导出日历失败"));
    }
  };

  const progressLabel =
    progressTotal === 0 ? "今天还没有事项" : `今日进度 ${progressDone}/${progressTotal}`;
  const contractCount = matters.filter((row) => row.matterKind === "contract").length;
  const litigationCount = matters.filter((row) => row.matterKind === "litigation").length;
  const matterCaption = (matterId?: string) => {
    const row = matterId ? matters.find((item) => item.matterId === matterId) : undefined;
    if (!row) {
      return "";
    }
    return [row.title, row.docket?.caseNo].filter(Boolean).join(" · ");
  };

  return (
    <section className="lm-lawyer-workbench" data-testid="lm-lawyer-workbench" aria-label="工作台">
      {desk === "cockpit" ? (
        <>
          <header className="lm-lawyer-top">
            <div>
              <p className="lm-lawyer-kicker">{today?.date ? formatDeskDate(today.date) : "今日"}</p>
              <h1>工作台</h1>
              <p className="lm-lawyer-lede">
                今天要回的、要开的、要拍的。右侧点「星辉精密诉环宇科技」看完整卷宗。不要点顶栏案件名进旧页。
              </p>
            </div>
            <div className="lm-lawyer-search">
              <span className="lm-lawyer-search-ico" aria-hidden>
                <DeskGlyph name="search" />
              </span>
              <input
                className="lm-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索星辉、传票、待回复…"
                aria-label="搜索工作台"
              />
            </div>
            <div className="lm-lawyer-top-actions">
              {onOpenNeedsDecision ? (
                <button
                  type="button"
                  className={`lm-btn lm-btn-sm ${approvalOpen > 0 ? "" : "lm-btn-ghost"}`}
                  onClick={() => onOpenNeedsDecision?.()}
                >
                  待我拍板{approvalOpen > 0 ? ` ${approvalOpen}` : ""}
                </button>
              ) : null}
              {onCreateMatter ? (
                <button type="button" className="lm-btn lm-btn-sm" onClick={onCreateMatter}>
                  新建案件
                </button>
              ) : null}
            </div>
          </header>

          <DeskServiceAlert
            err={err}
            onReconnect={onReconnectLocalService}
            reconnecting={localServiceReconnecting}
          />

          <div className="lm-lawyer-cockpit" data-testid="lm-lawyer-cockpit">
            <section className={`lm-desk-col lm-desk-col--act${approvalOpen > 0 ? " has-hot" : ""}`} aria-label="要我处理">
              <div className="lm-desk-col-head">
                <div className="lm-desk-col-copy">
                  <p className="lm-desk-col-label">要我处理</p>
                  <div className="lm-desk-col-value">
                    <span data-testid="lm-lawyer-today-progress">{actionOpen}</span>
                    <span className="lm-desk-col-unit">项</span>
                  </div>
                  <p className="lm-desk-col-delta">{progressLabel}</p>
                  <p className="lm-desk-col-hint">计划、待回复、待拍板</p>
                </div>
                <span className="lm-desk-ico" aria-hidden>
                  <DeskGlyph name="gavel" />
                </span>
              </div>
              <div className="lm-desk-body">
                <div className="lm-desk-scroll">
                  {shownActions.length === 0 ? (
                    <div className="lm-lawyer-empty">
                      <span className="lm-desk-ico" aria-hidden>
                        <DeskGlyph name="gavel" />
                      </span>
                      <p className="lm-lawyer-empty-title">这一栏还空着</p>
                      <p>写下计划。待回复邮件和待拍板会自动进来。</p>
                    </div>
                  ) : (
                    <ul className="lm-desk-list">
                      {shownActions.slice(0, 12).map((item) => (
                        <li key={item.id}>
                          <article className={`lm-desk-card${item.done ? " is-done" : ""}`}>
                            <span className={`lm-desk-card-ico lm-desk-card-ico--${item.kind}`} aria-hidden>
                              <DeskGlyph name={item.kind === "mail" ? "mail" : item.kind === "approval" ? "gavel" : "plus"} />
                            </span>
                            <div className="lm-desk-card-copy">
                              <p className="lm-desk-card-title">{item.title}</p>
                              <p className="lm-desk-card-meta">
                                {item.kind === "plan"
                                  ? "今日计划，勾完计入进度"
                                  : item.kind === "mail"
                                    ? "去对话起草回信，不会发出"
                                    : "去在办签批"}
                                {matterCaption(item.matterId) ? ` · ${matterCaption(item.matterId)}` : ""}
                              </p>
                            </div>
                            <div className="lm-desk-card-side">
                              <span
                                className={`lm-pri${item.kind === "approval" ? " lm-pri--high" : item.kind === "mail" ? " lm-pri--mid" : ""}`}
                              >
                                {item.kind === "plan" ? "计划" : item.kind === "mail" ? "待回复" : "拍板"}
                              </span>
                              {item.kind === "plan" ? (
                                <button
                                  type="button"
                                  className={`lm-desk-check${item.done ? " is-on" : ""}`}
                                  aria-label={item.done ? "标为未完成" : "标为完成"}
                                  data-testid="lm-lawyer-today-item-plan"
                                  onClick={() => activateTodayItem(item)}
                                />
                              ) : (
                                <div className="lm-desk-card-ctas">
                                  <button
                                    type="button"
                                    className="lm-desk-card-cta"
                                    data-testid={`lm-lawyer-today-item-${item.kind}`}
                                    onClick={() => activateTodayItem(item)}
                                  >
                                    {item.kind === "mail" ? "去回复" : "去拍板"}
                                  </button>
                                  {item.kind === "mail" && !item.done ? (
                                    <button
                                      type="button"
                                      className="lm-desk-card-cta lm-desk-card-cta--quiet"
                                      data-testid="lm-lawyer-today-item-mail-done"
                                      onClick={() => void markMailReplied(item)}
                                    >
                                      标为已回
                                    </button>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          </article>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="lm-desk-compose">
                  <textarea
                    className="lm-input"
                    rows={2}
                    value={planDraft}
                    onChange={(e) => setPlanDraft(e.target.value)}
                    placeholder="输入今天的工作计划，一行一件"
                    aria-label="今日计划"
                    data-testid="lm-lawyer-today-plan-input"
                  />
                  <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void addPlan()}>
                    加入
                  </button>
                </div>
              </div>
            </section>

            <section className={`lm-desk-col lm-desk-col--time${deadlineOpen > 0 ? " has-hot" : ""}`} aria-label="今日期限">
              <div className="lm-desk-col-head">
                <div className="lm-desk-col-copy">
                  <p className="lm-desk-col-label">今日期限</p>
                  <div className="lm-desk-col-value">
                    <span data-testid="lm-lawyer-stat-deadline">{deadlineOpen}</span>
                    <span className="lm-desk-col-unit">项</span>
                  </div>
                  <p className="lm-desk-col-delta">含临近开庭</p>
                  <p className="lm-desk-col-hint">点进案件确认后才写入期限</p>
                </div>
                <span className="lm-desk-ico" aria-hidden>
                  <DeskGlyph name="cal" />
                </span>
              </div>
              <div className="lm-desk-body">
                <div className="lm-desk-scroll">
                  {shownDeadlines.length === 0 ? (
                    <div className="lm-lawyer-empty">
                      <span className="lm-desk-ico" aria-hidden>
                        <DeskGlyph name="cal" />
                      </span>
                      <p className="lm-lawyer-empty-title">今天没有到期</p>
                      <p>把传票贴进案件后，开庭和举证会出现在这里。</p>
                    </div>
                  ) : (
                    <div className="lm-timeline">
                      {shownDeadlines.slice(0, 12).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`lm-timeline-row${isOverdue(item.dueAt) ? " is-overdue" : ""}`}
                          data-testid="lm-lawyer-today-item-deadline"
                          onClick={() => activateTodayItem(item)}
                        >
                          <span className="lm-timeline-time">{formatClock(item.dueAt)}</span>
                          <span className="lm-timeline-copy">
                            <span className="lm-desk-card-title">{item.title}</span>
                            <span className={`lm-pri${isOverdue(item.dueAt) ? " lm-pri--high" : " lm-pri--mid"}`}>
                              {isOverdue(item.dueAt) ? "已过" : "期限"}
                            </span>
                            <span className="lm-desk-card-meta">
                              {matterCaption(item.matterId) || formatDueShort(item.dueAt)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="lm-desk-col lm-desk-col--matters" aria-label="在办案件">
              <div className="lm-desk-col-head">
                <div className="lm-desk-col-copy">
                  <p className="lm-desk-col-label">在办案件</p>
                  <div className="lm-desk-col-value">
                    {shownMatters.length}
                    <span className="lm-desk-col-unit">件</span>
                  </div>
                  <p className="lm-desk-col-hint">
                    {contractCount} 合同 · {litigationCount} 诉讼
                  </p>
                </div>
                <span className="lm-desk-ico" aria-hidden>
                  <DeskGlyph name="folder" />
                </span>
              </div>
              <div className="lm-desk-filters" role="tablist" aria-label="工作门类">
                {KIND_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={kind === f.id}
                    aria-controls="lm-lawyer-matter-list"
                    className={`lm-desk-seg ${kind === f.id ? "is-active" : ""}`}
                    onClick={() => setKind(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="lm-desk-body">
                <div className="lm-desk-scroll">
                  {shownMatters.length === 0 ? (
                    <div className="lm-lawyer-empty" data-testid="lm-lawyer-matter-empty">
                      <span className="lm-desk-ico" aria-hidden>
                        <DeskGlyph name="folder" />
                      </span>
                      <p className="lm-lawyer-empty-title">还没有案件</p>
                      <p>先建一个合同或诉讼案件，卷宗和期限会跟在后面。</p>
                      {onCreateMatter ? (
                        <button type="button" className="lm-btn lm-btn-sm" onClick={onCreateMatter}>
                          新建案件
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <ul className="lm-desk-list" id="lm-lawyer-matter-list" role="tabpanel">
                      {shownMatters.map((row) => (
                        <li key={row.matterId}>
                          <button type="button" className="lm-matter-card" onClick={() => openMatter(row.matterId)}>
                            <span className="lm-matter-card-body">
                              <strong>{row.title}</strong>
                              <span className="lm-matter-card-meta">
                                <span className="lm-kind" data-kind={row.matterKind}>
                                  {row.matterKindLabel}
                                </span>
                                {row.docket?.caseNo ? <span>{row.docket.caseNo}</span> : null}
                                {hearingCountdown(row.daysUntilHearing) ? (
                                  <span
                                    className={`lm-matter-count${(row.daysUntilHearing ?? 99) <= 3 ? " is-hot" : ""}`}
                                  >
                                    {hearingCountdown(row.daysUntilHearing)}
                                  </span>
                                ) : row.nextHearingAt ? (
                                  <span>开庭 {row.nextHearingAt.slice(0, 10)}</span>
                                ) : null}
                                {row.openDeadlineCount > 0 ? <span>{row.openDeadlineCount} 个期限</span> : null}
                                {row.openTaskCount ? <span>{row.openTaskCount} 项待办</span> : null}
                              </span>
                            </span>
                            <span className="lm-matter-card-chev" aria-hidden>
                              →
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </aside>
          </div>

          {todayItems.length > 0 ? (
            <div className="lm-progress-board" aria-label="今日进度表" data-testid="lm-lawyer-progress-board">
              <div className="lm-progress-board-head">
                <span>事项</span>
                <span>类型</span>
                <span>完成</span>
              </div>
              <ul className="lm-progress-board-list">
                {todayItems.map((item) => (
                  <li key={item.id} className={`lm-progress-row${item.done ? " is-done" : ""}`}>
                    <span className="lm-progress-title">{item.title}</span>
                    <span>{todayKindZh(item.kind)}</span>
                    <span>{item.done ? "已完成" : "未完成"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="lm-desk-dock">
            <p className="lm-desk-dock-label">快捷入口</p>
            <div className="lm-desk-quick">
            <button type="button" className="lm-desk-quick-btn" onClick={() => onCreateMatter?.()}>
              <span className="lm-desk-ico" aria-hidden>
                <DeskGlyph name="plus" />
              </span>
              <strong>新建案件</strong>
              <span className="lm-desk-quick-desc">建卷并分门类</span>
            </button>
            <button type="button" className="lm-desk-quick-btn" onClick={() => onGoToChat({})}>
              <span className="lm-desk-ico" aria-hidden>
                <DeskGlyph name="chat" />
              </span>
              <strong>文书起草</strong>
              <span className="lm-desk-quick-desc">去对话交办出稿</span>
            </button>
            <button
              type="button"
              className="lm-desk-quick-btn"
              onClick={() => {
                const first = shownMatters[0] ?? matters[0];
                if (first) {
                  openMatter(first.matterId, "deadlines");
                } else {
                  setErr("请先新建案件，再贴传票。");
                }
              }}
            >
              <span className="lm-desk-ico" aria-hidden>
                <DeskGlyph name="cal" />
              </span>
              <strong>贴传票</strong>
              <span className="lm-desk-quick-desc">抽出开庭，确认后写入</span>
            </button>
            <button
              type="button"
              className="lm-desk-quick-btn"
              onClick={() => {
                const lit = matters.find((m) => m.matterKind === "litigation") ?? matters[0];
                if (lit) {
                  openMatter(lit.matterId, "intake");
                } else {
                  setErr("请先建一个诉讼案件，再整理谈话。");
                }
              }}
            >
              <span className="lm-desk-ico" aria-hidden>
                <DeskGlyph name="talk" />
              </span>
              <strong>整理谈话</strong>
              <span className="lm-desk-quick-desc">需求、案由、证据缺口</span>
            </button>
            <button
              type="button"
              className="lm-desk-quick-btn"
              data-testid="lm-lawyer-stat-mail"
              onClick={() => {
                const mail = todayItems.find((item) => item.kind === "mail" && !item.done);
                if (mail) {
                  activateTodayItem(mail);
                } else {
                  onGoToChat({ prompt: "请列出今天需要回复的来信，并起草回信草稿，不要发送。" });
                }
              }}
            >
              <span className="lm-desk-ico" aria-hidden>
                <DeskGlyph name="mail" />
              </span>
              <strong>待回复 {mailOpen}</strong>
              <span className="lm-desk-quick-desc">去对话起草回信</span>
            </button>
            </div>
          </div>

          <button type="button" className="lm-lawyer-fab" onClick={() => onGoToChat({})}>
            <DeskGlyph name="chat" />
            打开对话
          </button>
        </>
      ) : (
        <div className="lm-matter-file">
          <button type="button" className="lm-lawyer-back" onClick={() => setDesk("cockpit")}>
            ← 返回今日
          </button>
          <DeskServiceAlert
            err={err}
            onReconnect={onReconnectLocalService}
            reconnecting={localServiceReconnecting}
          />
          {!selected ? (
            <div className="lm-lawyer-empty">
              <p className="lm-lawyer-empty-title">选一个案件</p>
              <p>从今日驾驶舱点进案件后，这里是这一案的卷宗、期限和谈话。</p>
            </div>
          ) : (
            <>
              <header className="lm-matter-hero">
                <div className="lm-matter-id">
                  <span className="lm-matter-folder" aria-hidden>
                    <DeskGlyph name="folder" />
                  </span>
                  <div>
                    <h2>{pulse?.title ?? selected.title}</h2>
                    <p className="lm-matter-hero-sub">
                      {selected.docket?.caseNo || selected.matterId}
                      {selected.docket?.court ? ` · ${selected.docket.court}` : ""}
                      {pulse?.clientId || selected.clientId ? ` · 客户 ${pulse?.clientId || selected.clientId}` : ""}
                    </p>
                  </div>
                </div>
                <div className="lm-matter-hero-side">
                    <div className="lm-status-table">
                      <div className="lm-status-cell">
                        <span>状态</span>
                        <strong>{pulse?.statusLabel ?? matterStatusZh(selected.status)}</strong>
                      </div>
                      <div className="lm-status-cell">
                        <span>门类</span>
                        <strong>{selected.matterKindLabel}</strong>
                      </div>
                      <div className="lm-status-cell">
                        <span>对方</span>
                        <strong>{pulse?.counterparty || "未填"}</strong>
                      </div>
                      <div className="lm-status-cell">
                        <span>开庭</span>
                        <strong>
                          {hearingCountdown(pulse?.daysUntilHearing ?? selected.daysUntilHearing) ||
                            selected.nextHearingAt?.slice(0, 10) ||
                            selected.docket?.hearingAt ||
                            "未排"}
                        </strong>
                      </div>
                    </div>
                <div className="lm-matter-hero-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    onClick={() =>
                      onGoToChat({
                        matterId: selected.matterId,
                        prompt:
                          selected.matterKind === "litigation"
                            ? "【办件】能力：litigation.talk\n流程：谈话整理\n请按已附材料与钉源执行该流程。"
                            : undefined,
                      })
                    }
                  >
                    去对话
                  </button>
                  {onOpenReview ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      onClick={() => onOpenReview({ matterId: selected.matterId })}
                    >
                      去审查
                    </button>
                  ) : null}
                  {onOpenNeedsDecision ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      onClick={() => onOpenNeedsDecision(selected.matterId)}
                    >
                      去拍板
                    </button>
                  ) : null}
                  <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void exportIcs()}>
                    导出日历
                  </button>
                </div>
                </div>
              </header>

              <div className="lm-pulse-bar" aria-label="本案实时" data-testid="lm-lawyer-pulse-bar">
                <div className={`lm-pulse-chip${(pulse?.counts.mail ?? mailOpen) > 0 ? " is-hot" : ""}`}>
                  <span>待回复</span>
                  <strong>{pulse?.counts.mail ?? 0}</strong>
                </div>
                <div className={`lm-pulse-chip${(pulse?.counts.approvals ?? 0) > 0 ? " is-hot" : ""}`}>
                  <span>待拍板</span>
                  <strong>{pulse?.counts.approvals ?? 0}</strong>
                </div>
                <div
                  className={`lm-pulse-chip${(pulse?.daysUntilHearing ?? 99) <= 3 && pulse?.daysUntilHearing !== null && pulse?.daysUntilHearing !== undefined ? " is-hot" : ""}`}
                >
                  <span>开庭</span>
                  <strong>{hearingCountdown(pulse?.daysUntilHearing ?? selected.daysUntilHearing) ?? "未排"}</strong>
                </div>
                <div className="lm-pulse-chip">
                  <span>待办任务</span>
                  <strong>{pulse?.counts.tasks ?? selected.openTaskCount ?? 0}</strong>
                </div>
              </div>

              <div className="lm-pane-tabs" role="tablist" aria-label="本案分区">
                {(
                  [
                    { id: "overview", label: "概览", icon: "folder" as const },
                    { id: "docs", label: "文书", count: pulse?.counts.documents, icon: "folder" as const },
                    { id: "docket", label: "卷宗", icon: "folder" as const },
                    { id: "deadlines", label: "期限", count: pulse?.counts.deadlines ?? openDeadlines, icon: "cal" as const },
                    { id: "intake", label: "谈话", icon: "talk" as const },
                    { id: "review", label: "标准", count: similar.length + standards.length, icon: "gavel" as const },
                  ] as Array<{ id: MatterPaneId; label: string; count?: number; icon: "folder" | "cal" | "talk" | "gavel" }>
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`lm-lawyer-tab-${tab.id}`}
                    aria-selected={matterPane === tab.id}
                    aria-controls={`lm-lawyer-pane-${tab.id}`}
                    className={`lm-pane-tab ${matterPane === tab.id ? "is-active" : ""}`}
                    onClick={() => setMatterPane(tab.id)}
                  >
                    <DeskGlyph name={tab.icon} />
                    {tab.label}
                    {tab.count ? <span className="lm-pane-tab-count">{tab.count}</span> : null}
                  </button>
                ))}
              </div>

              <div className="lm-matter-scroll">
                {matterPane === "overview" ? (
                  <div className="lm-overview" id="lm-lawyer-pane-overview" role="tabpanel" aria-labelledby="lm-lawyer-tab-overview">
                    <section className="lm-overview-card" aria-label="案件信息">
                      <h3>案件信息</h3>
                      <dl className="lm-dl">
                        <dt>门类</dt>
                        <dd>{MATTER_KIND_LABELS[matterKind]}</dd>
                        <dt>案号</dt>
                        <dd>{docket.caseNo || "未填"}</dd>
                        <dt>客户</dt>
                        <dd>{clientId || pulse?.clientId || "未填"}</dd>
                        <dt>对方</dt>
                        <dd>{counterparty || pulse?.counterparty || "未填"}</dd>
                        <dt>案由</dt>
                        <dd>{pulse?.causeOfAction || "未填"}</dd>
                        <dt>法院</dt>
                        <dd>{docket.court || "未填"}</dd>
                        <dt>开庭</dt>
                        <dd>
                          {hearingCountdown(pulse?.daysUntilHearing ?? selected.daysUntilHearing) ||
                            docket.hearingAt ||
                            "未排"}
                        </dd>
                      </dl>
                      <div className="lm-lawyer-inline-actions">
                        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => setMatterPane("docket")}>
                          编辑卷宗
                        </button>
                        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => setMatterPane("deadlines")}>
                          贴传票
                        </button>
                      </div>
                    </section>
                    <section className="lm-overview-card" aria-label="文书清单">
                      <h3>文书清单</h3>
                      {(pulse?.documents ?? []).length === 0 ? (
                        <p className="lm-meta">还没有本案文书。去对话交办出稿后会出现在这里。</p>
                      ) : (
                        <ul className="lm-lawyer-deadline-list">
                          {(pulse?.documents ?? []).slice(0, 6).map((doc) => (
                            <li key={doc.id} className="lm-doc-row">
                              <span className="lm-lawyer-deadline-copy">
                                <strong>{doc.title}</strong>
                                <span className="lm-lawyer-today-meta">
                                  {doc.status}
                                  {doc.at ? ` · ${formatDueShort(doc.at)}` : ""}
                                </span>
                              </span>
                              {onOpenReview && doc.taskId ? (
                                <button
                                  type="button"
                                  className="lm-btn lm-btn-ghost lm-btn-sm"
                                  onClick={() => onOpenReview({ matterId: selected.matterId, taskId: doc.taskId })}
                                >
                                  审查
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="lm-lawyer-inline-actions">
                        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => setMatterPane("docs")}>
                          查看全部
                        </button>
                        <button
                          type="button"
                          className="lm-btn lm-btn-sm"
                          onClick={() =>
                            onGoToChat({
                              matterId: selected.matterId,
                              prompt: "请根据本案卷宗起草下一份需要的文书，先出草稿，不要发送。",
                            })
                          }
                        >
                          去对话出稿
                        </button>
                      </div>
                    </section>
                    <div className="lm-overview-stack">
                      <section className="lm-overview-card" aria-label="近期任务">
                        <h3>近期任务</h3>
                        {(pulse?.tasks ?? []).length === 0 ? (
                          <p className="lm-meta">没有进行中的任务。去对话交办后会出现在这里。</p>
                        ) : (
                          <ul className="lm-lawyer-deadline-list">
                            {(pulse?.tasks ?? []).slice(0, 5).map((task) => (
                              <li key={task.taskId} className="lm-doc-row">
                                <span className="lm-lawyer-deadline-copy">
                                  <strong>{task.title}</strong>
                                  <span className="lm-lawyer-today-meta">{taskLifecycleLabel(task.status)}</span>
                                </span>
                                {onOpenReview ? (
                                  <button
                                    type="button"
                                    className="lm-btn lm-btn-ghost lm-btn-sm"
                                    onClick={() => onOpenReview({ matterId: selected.matterId, taskId: task.taskId })}
                                  >
                                    打开
                                  </button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      <section className="lm-overview-card" aria-label="近期期限">
                        <h3>近期期限</h3>
                        {deadlines.length === 0 ? (
                          <p className="lm-meta">还没有期限。贴传票后确认写入。</p>
                        ) : (
                          <ul className="lm-lawyer-deadline-list">
                            {deadlines.slice(0, 5).map((d) => (
                              <li key={d.deadlineId} className="lm-lawyer-deadline-row">
                                <span className="lm-lawyer-deadline-copy">
                                  <strong>
                                    {eventKindLabel(d.eventKind)} · {d.title}
                                  </strong>
                                  <span className={`lm-lawyer-today-meta${isOverdue(d.dueAt) ? " is-hot" : ""}`}>
                                    {formatDueShort(d.dueAt)}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => setMatterPane("deadlines")}>
                          全部期限
                        </button>
                      </section>
                    </div>
                  </div>
                ) : null}

                {matterPane === "docs" ? (
                  <section className="lm-lawyer-pane" id="lm-lawyer-pane-docs" role="tabpanel" aria-labelledby="lm-lawyer-tab-docs">
                    <h3>文书清单</h3>
                    {(pulse?.documents ?? []).length === 0 ? (
                      <p className="lm-meta">还没有本案文书。去对话交办出稿后会出现在这里。</p>
                    ) : (
                      <ul className="lm-lawyer-deadline-list">
                        {(pulse?.documents ?? []).map((doc) => (
                          <li key={doc.id} className="lm-lawyer-deadline-row">
                            <span className="lm-lawyer-deadline-copy">
                              <strong>{doc.title}</strong>
                              <span className="lm-lawyer-today-meta">
                                {doc.status}
                                {doc.at ? ` · ${formatDueShort(doc.at)}` : ""}
                              </span>
                            </span>
                            <span className="lm-lawyer-inline-actions">
                              {onOpenReview && doc.taskId ? (
                                <button
                                  type="button"
                                  className="lm-btn lm-btn-ghost lm-btn-sm"
                                  onClick={() => onOpenReview({ matterId: selected.matterId, taskId: doc.taskId })}
                                >
                                  去审查
                                </button>
                              ) : null}
                              {onShowArtifact && doc.outputPath ? (
                                <button
                                  type="button"
                                  className="lm-btn lm-btn-ghost lm-btn-sm"
                                  onClick={() => onShowArtifact(doc.outputPath ?? "")}
                                >
                                  打开文件
                                </button>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <h3>本案文件</h3>
                    {(pulse?.files ?? []).length === 0 ? (
                      <p className="lm-meta">卷宗里还没有生成产物。出稿后路径会出现在这里。</p>
                    ) : (
                      <ul className="lm-lawyer-deadline-list">
                        {(pulse?.files ?? []).map((file) => (
                          <li key={file.label} className="lm-lawyer-deadline-row">
                            <span className="lm-lawyer-deadline-copy">{file.label}</span>
                            {onShowArtifact ? (
                              <button
                                type="button"
                                className="lm-btn lm-btn-ghost lm-btn-sm"
                                onClick={() => onShowArtifact(file.label)}
                              >
                                打开
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <h3>待处理来信</h3>
                    {(pulse?.mail ?? []).length === 0 ? (
                      <p className="lm-meta">没有待回复或法院/合同来件。导入本案邮件后会出现在这里。</p>
                    ) : (
                      <ul className="lm-lawyer-deadline-list">
                        {(pulse?.mail ?? []).map((msg) => (
                          <li key={msg.id} className="lm-lawyer-deadline-row">
                            <span className="lm-lawyer-deadline-copy">
                              <strong>{msg.subject}</strong>
                              <span className="lm-lawyer-today-meta">
                                {msg.labelZh} · {msg.from}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="lm-btn lm-btn-sm"
                              onClick={() =>
                                onGoToChat({
                                  matterId: selected.matterId,
                                  prompt: `请根据本案待回复「${msg.subject}」起草回信，先出草稿，不要发送。`,
                                })
                              }
                            >
                              去回复
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}

                {matterPane === "docket" ? (
                  <section className="lm-lawyer-pane" id="lm-lawyer-pane-docket" role="tabpanel" aria-labelledby="lm-lawyer-tab-docket">
                    <h3>卷宗</h3>
                    <div className="lm-lawyer-docket-grid">
                      <label>
                        门类
                        <select className="lm-input" value={matterKind} onChange={(e) => setMatterKind(e.target.value as MatterKind)}>
                          {(Object.keys(MATTER_KIND_LABELS) as MatterKind[]).map((k) => (
                            <option key={k} value={k}>
                              {MATTER_KIND_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        客户
                        <input className="lm-input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                      </label>
                      <label>
                        对方当事人
                        <input className="lm-input" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
                      </label>
                      <label>
                        案号
                        <input className="lm-input" value={docket.caseNo} onChange={(e) => setDocket({ ...docket, caseNo: e.target.value })} />
                      </label>
                      <label>
                        法院
                        <input className="lm-input" value={docket.court} onChange={(e) => setDocket({ ...docket, court: e.target.value })} />
                      </label>
                      <label>
                        审级
                        <input className="lm-input" value={docket.instance} onChange={(e) => setDocket({ ...docket, instance: e.target.value })} />
                      </label>
                      <label>
                        诉讼地位
                        <input className="lm-input" value={docket.standing} onChange={(e) => setDocket({ ...docket, standing: e.target.value })} />
                      </label>
                      <label>
                        开庭日
                        <input className="lm-input" value={docket.hearingAt} onChange={(e) => setDocket({ ...docket, hearingAt: e.target.value })} />
                      </label>
                    </div>
                    <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void saveDocket()}>
                      保存卷宗
                    </button>
                  </section>
                ) : null}

                {matterPane === "deadlines" ? (
                  <section className="lm-lawyer-pane" id="lm-lawyer-pane-deadlines" role="tabpanel" aria-labelledby="lm-lawyer-tab-deadlines">
                    <h3>期限 / 开庭</h3>
                    {deadlines.length === 0 ? (
                      <p className="lm-meta">还没有期限。把传票或 12368 短信贴到下面，确认后写入。</p>
                    ) : (
                      <ul className="lm-lawyer-deadline-list">
                        {deadlines.map((d) => (
                          <li key={d.deadlineId} className={`lm-lawyer-deadline-row${d.status === "completed" ? " is-done" : ""}`}>
                            <span className="lm-lawyer-deadline-copy">
                              <strong>
                                {eventKindLabel(d.eventKind)} · {d.title}
                              </strong>
                              <span className="lm-lawyer-today-meta">{formatDueShort(d.dueAt)}</span>
                            </span>
                            {d.status === "open" || d.status === "snoozed" ? (
                              <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void completeDeadline(d.deadlineId)}>
                                完成
                              </button>
                            ) : (
                              <span className="lm-meta">{d.status === "completed" ? "已完成" : d.status}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <textarea
                      className="lm-input"
                      rows={3}
                      value={extractText}
                      onChange={(e) => setExtractText(e.target.value)}
                      placeholder="粘贴传票、法院短信或期限告知"
                      aria-label="抽取期限材料"
                    />
                    <div className="lm-lawyer-inline-actions">
                      <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" disabled={busy} onClick={() => void runExtract()}>
                        抽出期限
                      </button>
                      {extracted.length > 0 ? (
                        <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void confirmEvents()}>
                          确认写入（{extracted.length}）
                        </button>
                      ) : null}
                    </div>
                    {extracted.length > 0 ? (
                      <ul className="lm-lawyer-extract-preview">
                        {extracted.map((e, i) => (
                          <li key={`${e.title}-${i}`}>
                            {e.title}
                            {e.dueAt ? ` · ${e.dueAt}` : " · 日期待补"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}

                {matterPane === "intake" ? (
                  <section className="lm-lawyer-pane" id="lm-lawyer-pane-intake" role="tabpanel" aria-labelledby="lm-lawyer-tab-intake">
                    <h3>谈话整理</h3>
                    <textarea
                      className="lm-input"
                      rows={5}
                      value={talk}
                      onChange={(e) => setTalk(e.target.value)}
                      placeholder="粘贴客户谈话记录"
                      aria-label="谈话记录"
                      data-testid="lm-lawyer-talk-input"
                    />
                    <div className="lm-lawyer-inline-actions">
                      <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void compileTalk()}>
                        整理谈话
                      </button>
                      {brief && !brief.confirmedAt ? (
                        <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" disabled={busy} onClick={() => void confirmIntake()}>
                          写入本案档案
                        </button>
                      ) : null}
                    </div>
                    {brief?.confirmedAt ? <p className="lm-meta">已写入档案 · {formatDueShort(brief.confirmedAt)}</p> : null}
                    {brief ? <IntakeBriefBlocks brief={brief} onApplyCause={(label) => void applyCause(label)} /> : null}
                  </section>
                ) : null}

                {matterPane === "review" ? (
                  <section className="lm-lawyer-pane" id="lm-lawyer-pane-review" role="tabpanel" aria-labelledby="lm-lawyer-tab-review">
                    <h3>相关旧案</h3>
                    {similar.length === 0 ? (
                      <p className="lm-meta">还没有足够接近的旧案。对照只看案由和证据缺口，不会把旧案事实写入本案。</p>
                    ) : (
                      <ul className="lm-lawyer-similar-list">
                        {similar.map((h) => (
                          <li key={h.matterId}>
                            <strong>{h.causeOfAction || "相近案件"}</strong>
                            {h.snippet ? <p className="lm-meta">{h.snippet}</p> : null}
                            {h.evidenceHints.length > 0 ? <p className="lm-meta">证据缺口对照：{h.evidenceHints.join("；")}</p> : null}
                            <p className="lm-meta">{h.displayWarning}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <h3>已套用标准</h3>
                    {standards.length === 0 ? (
                      <p className="lm-meta">本案还没有自动套上口径。可在设置里写审查标准，审查合同时会带上。</p>
                    ) : (
                      <ul className="lm-lawyer-standards-list">
                        {standards.map((s) => (
                          <li key={s.id}>{s.title}</li>
                        ))}
                      </ul>
                    )}
                    {onOpenReview ? (
                      <div className="lm-lawyer-inline-actions">
                        <button
                          type="button"
                          className="lm-btn lm-btn-sm"
                          onClick={() => onOpenReview({ matterId: selected.matterId })}
                        >
                          去审查本合同
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DeskGlyph(props: { name: "gavel" | "cal" | "folder" | "chat" | "mail" | "search" | "plus" | "talk" }): ReactNode {
  const { name } = props;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      {name === "search" ? (
        <>
          <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16.5L20 20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
      {name === "gavel" ? (
        <path
          d="M4 19h10M8 17l8-8 2.5 2.5-8 8H8v-2.5Zm8.5-9.5L18 6l2 2-1.5 2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "cal" ? (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 4v3M16 4v3M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </>
      ) : null}
      {name === "folder" ? (
        <path
          d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4L11 8h7.5A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-10Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      ) : null}
      {name === "chat" ? (
        <path
          d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H10l-4 3.5V16H7.5A2.5 2.5 0 0 1 5 13.5v-7Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      ) : null}
      {name === "mail" ? (
        <path
          d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-9Zm1.2-.3L12 12l6.8-4.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "plus" ? (
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : null}
      {name === "talk" ? (
        <path
          d="M7 8h10M7 12h6M6 5h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 3v-3H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function IntakeBriefBlocks(props: { brief: IntakeBriefView; onApplyCause: (label: string) => void }): ReactNode {
  const { brief, onApplyCause } = props;
  return (
    <div className="lm-lawyer-brief">
      <BriefList title="客户需求" items={brief.clientNeeds} />
      <BriefList title="要件事实" items={brief.coreFacts} />
      <BriefList title="争点" items={brief.issues ?? []} />
      <div className="lm-lawyer-brief-block">
        <h4>候选案由</h4>
        {brief.causeCandidates.length === 0 ? (
          <p className="lm-meta">词表里还没有能对上的案由。可在设置里补词表后再整理。</p>
        ) : (
          <ul>
            {brief.causeCandidates.map((c) => (
              <li key={c.label} className="lm-lawyer-cause-row">
                <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => onApplyCause(c.label)}>
                  采用「{c.label}」
                </button>
                <span className="lm-meta">{c.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BriefList title="证据缺口" items={brief.evidenceGaps} />
      <BriefList title="下一步" items={brief.nextActions} />
    </div>
  );
}

function BriefList(props: { title: string; items: string[] }): ReactNode {
  if (props.items.length === 0) {
    return null;
  }
  return (
    <div className="lm-lawyer-brief-block">
      <h4>{props.title}</h4>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}