/**
 * 工作台：今日计划、案件门类、期限与谈话摘要。律师打开 LawMind 先看这里。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage, fetchApi } from "./api-client";
import {
  requestOpenAutomationsSettings,
  requestOpenWorkspaceSettings,
} from "./lawmind-automations-nav-bus";
import { triggerBrowserDownload } from "./review/review-workbench-helpers";
import { LEGAL_EVENT_KIND_LABELS, type ExtractedLegalEvent } from "../../../../src/lawmind/desk/legal-event-extract.ts";
import { DEADLINE_SOURCE_LABELS } from "../../../../src/lawmind/desk/deadline-chain.ts";
import { MATTER_KIND_LABELS, type MatterKind } from "../../../../src/lawmind/desk/matter-kind.ts";
import {
  deriveMatterIdentity,
  hydrateMatterParties,
  matterPartyEditorDrafts,
  normalizeMatterParties,
  type MatterParty,
} from "../../../../src/lawmind/desk/matter-parties.ts";
import { LawmindMatterPartiesEditor, LawmindMatterPartyCards } from "./LawmindMatterPartiesEditor";
import { MatterReplicaPanel } from "./matter/MatterReplicaPanel";
import { taskLifecycleLabel } from "./matter/matter-display-labels";
import { pinDroppedChatFiles } from "./lawmind-file-drop-context";
import { useChatFileDropTarget } from "./useChatFileDropTarget";

type TodayItemKind = "plan" | "mail" | "deadline" | "approval";

type TodayItem = {
  id: string;
  kind: TodayItemKind;
  title: string;
  done: boolean;
  matterId?: string;
  dueAt?: string;
  sourceRef?: string;
  originDate?: string;
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
  source?: string;
  sourceLabel?: string;
  released?: boolean;
  waitingOnTitle?: string;
  dependsOnDeadlineId?: string;
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

type MatterPulseTimelineKind =
  | "deadline"
  | "hearing"
  | "mail"
  | "document"
  | "task"
  | "approval"
  | "intake";

type MatterPulseView = {
  matterId?: string;
  title: string;
  status: string;
  statusLabel: string;
  matterKind?: MatterKind;
  matterKindLabel?: string;
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
    materials?: number;
  };
  daysUntilHearing: number | null;
  documents: Array<{ id: string; title: string; status: string; at?: string; taskId?: string; outputPath?: string }>;
  tasks: Array<{ taskId: string; title: string; status: string; updatedAt: string }>;
  files: Array<{ label: string }>;
  materials?: Array<{ relPath: string; fileName: string; size: number; updatedAt: string }>;
  mail: Array<{ id: string; subject: string; from: string; receivedAt: string; label: string; labelZh: string }>;
  parties?: MatterParty[];
  timeline?: Array<{
    id: string;
    kind: MatterPulseTimelineKind;
    title: string;
    at: string;
    meta?: string;
  }>;
  nextActions: string[];
  intakeConfirmedAt?: string;
};

type MatterPaneId = "overview" | "docket" | "docs" | "materials" | "deadlines" | "intake" | "review";

export type LawmindLawyerWorkbenchProps = {
  apiBase: string;
  /** Folder name from the live desktop workspace — shown so the empty desk is not mistaken for “no cases”. */
  workspaceDir?: string | null;
  selectedMatterId: string | null;
  /** Bumped when a matter is created/deleted so the cockpit list reloads. */
  matterRefreshVersion?: number;
  onSelectMatter: (matterId: string) => void;
  onGoToChat: (opts: { matterId?: string; prompt?: string }) => void;
  onOpenNeedsDecision?: (matterId?: string) => void;
  onCreateMatter?: () => void;
  onOpenReview?: (opts: { matterId: string; taskId?: string }) => void;
  onShowArtifact?: (relPath: string) => void;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
  /** Open 本案卷宗 when bumped from header / sidebar / deep link. */
  deskMatterFocus?: { id: string; n: number } | null;
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

function isCarriedPlan(item: TodayItem, todayDate: string | undefined): boolean {
  return item.kind === "plan" && Boolean(item.originDate) && item.originDate !== todayDate;
}

function formatMonthDay(dateKey: string): string {
  const parts = dateKey.split("-");
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!month || !day) {
    return dateKey;
  }
  return `${month}月${day}日`;
}

function planCardMeta(item: TodayItem, todayDate: string | undefined): string {
  if (isCarriedPlan(item, todayDate) && item.originDate) {
    return `未结 · 自 ${formatMonthDay(item.originDate)}`;
  }
  return "今日计划，勾完计入进度";
}

function actionSortRank(item: TodayItem, todayDate: string | undefined): number {
  if (item.kind === "approval") {
    return 0;
  }
  if (item.kind === "mail") {
    return 1;
  }
  if (isCarriedPlan(item, todayDate)) {
    return 2;
  }
  if (item.kind === "plan") {
    return 3;
  }
  return 4;
}

function eventKindLabel(eventKind: string | undefined): string {
  if (!eventKind) {
    return "期限";
  }
  return LEGAL_EVENT_KIND_LABELS[eventKind as keyof typeof LEGAL_EVENT_KIND_LABELS] ?? eventKind;
}

function deadlineSourceCopy(row: Pick<DeadlineRow, "source" | "sourceLabel">): string {
  if (row.sourceLabel?.trim()) {
    return row.sourceLabel.trim();
  }
  if (!row.source) {
    return "";
  }
  return DEADLINE_SOURCE_LABELS[row.source as keyof typeof DEADLINE_SOURCE_LABELS] ?? "";
}

function DeadlineSourceBadge({ row }: { row: Pick<DeadlineRow, "source" | "sourceLabel"> }) {
  const label = deadlineSourceCopy(row);
  if (!label) {
    return null;
  }
  const extract = row.source === "document_extract";
  return (
    <span className={`lm-deadline-source${extract ? " lm-deadline-source--extract" : ""}`}>{label}</span>
  );
}

function DeadlineWaitingLine({ row }: { row: Pick<DeadlineRow, "released" | "waitingOnTitle"> }) {
  if (row.released !== false || !row.waitingOnTitle) {
    return null;
  }
  return <span className="lm-deadline-waiting">{`等「${row.waitingOnTitle}」完成`}</span>;
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

const MATTER_TIMELINE_KIND_ZH: Record<MatterPulseTimelineKind, string> = {
  deadline: "期限",
  hearing: "开庭",
  mail: "来信",
  document: "文书",
  task: "任务",
  approval: "拍板",
  intake: "谈话",
};

/** Overview cards read identity from pulse only — never a local `clientId` binding. */
function overviewPartiesFromPulse(pulse: MatterPulseView | null): MatterParty[] {
  return hydrateMatterParties({
    parties: pulse?.parties,
    clientId: pulse?.clientId,
    counterparty: pulse?.counterparty,
  });
}

function formatTimelineDay(at: string): string {
  const stamp = at.trim();
  if (!stamp) {
    return "";
  }
  const dt = new Date(stamp);
  if (!Number.isNaN(dt.getTime())) {
    return `${dt.getMonth() + 1}月${dt.getDate()}日`;
  }
  const md = stamp.slice(5, 10);
  if (/^\d{2}-\d{2}$/.test(md)) {
    return `${Number(md.slice(0, 2))}月${Number(md.slice(3))}日`;
  }
  return stamp.slice(0, 10);
}

function formatMaterialBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function materialDisplayPath(relPath: string): string {
  return relPath.replace(/^materials\//, "");
}

function fallbackDeskMatter(
  viewingId: string,
  pulse: MatterPulseView | null,
  matterKind: MatterKind,
): DeskMatterRow {
  const kind = pulse?.matterKind ?? matterKind;
  return {
    matterId: viewingId,
    title: pulse?.title?.trim() || viewingId,
    status: pulse?.status || "open",
    matterKind: kind,
    matterKindLabel: pulse?.matterKindLabel ?? MATTER_KIND_LABELS[kind],
    clientId: pulse?.clientId,
    openDeadlineCount: pulse?.counts.deadlines ?? 0,
    daysUntilHearing: pulse?.daysUntilHearing ?? null,
    openTaskCount: pulse?.counts.tasks,
  };
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
    workspaceDir,
    selectedMatterId,
    matterRefreshVersion = 0,
    onSelectMatter,
    onGoToChat,
    onOpenNeedsDecision,
    onCreateMatter,
    onOpenReview,
    onShowArtifact,
    onReconnectLocalService,
    localServiceReconnecting,
    deskMatterFocus,
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
  const [partyDrafts, setPartyDrafts] = useState<MatterParty[]>([]);
  const [causeOfAction, setCauseOfAction] = useState("");
  const [pulse, setPulse] = useState<MatterPulseView | null>(null);
  const [matterKind, setMatterKind] = useState<MatterKind>("general");
  const [desk, setDesk] = useState<"cockpit" | "matter">("cockpit");
  const [openedMatterId, setOpenedMatterId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const autoReconnectRef = useRef(false);
  const reconnectRef = useRef(onReconnectLocalService);
  reconnectRef.current = onReconnectLocalService;

  const viewingId = desk === "matter" ? (openedMatterId ?? selectedMatterId) : null;
  const selected = useMemo(() => {
    if (!viewingId) {
      return null;
    }
    return (
      matters.find((m) => m.matterId === viewingId) ??
      fallbackDeskMatter(viewingId, pulse?.matterId === viewingId ? pulse : null, matterKind)
    );
  }, [matters, viewingId, pulse, matterKind]);

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
  const todayDate = today?.date;
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const shownActions = actionItems
    .filter((item) => matches(item.title))
    .toSorted((a, b) => actionSortRank(a, todayDate) - actionSortRank(b, todayDate));
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
    if (matterRefreshVersion <= 0) {
      return;
    }
    void reloadMatters().catch(() => undefined);
  }, [matterRefreshVersion, reloadMatters]);

  useEffect(() => {
    if (!viewingId) {
      setDeadlines([]);
      setBrief(null);
      setSimilar([]);
      setStandards([]);
      setPulse(null);
      return undefined;
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
        setCauseOfAction(pulseRow.pulse?.causeOfAction ?? "");
        setMatterKind(selected?.matterKind ?? "general");
        setPartyDrafts(
          matterPartyEditorDrafts(
            hydrateMatterParties({
              parties: pulseRow.pulse?.parties,
              clientId: pulseRow.pulse?.clientId ?? selected?.clientId,
              counterparty: pulseRow.pulse?.counterparty,
            }),
          ),
        );
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
    const text = planDraft.trim();
    if (!text) {
      return;
    }
    const lines = text
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
      const j = await apiSendJson<{ ok?: boolean; today?: TodaySnapshot }, { done: boolean; date?: string }>(
        apiBase,
        `/api/desk/plan/items/${encodeURIComponent(item.id)}`,
        "PATCH",
        {
          done: !item.done,
          ...(item.originDate ? { date: item.originDate } : {}),
        },
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

  useEffect(() => {
    const mid = deskMatterFocus?.id?.trim();
    if (!mid) {
      return;
    }
    openMatter(mid);
    // openMatter closes over setters; nonce forces re-open of the same matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional focus bump
  }, [deskMatterFocus?.id, deskMatterFocus?.n]);

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
        return;
      }
      onGoToChat({
        prompt: `请根据待回复「${item.title}」起草今日回信，先出草稿，不要发送。`,
      });
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

  const setDeadlineDependsOn = async (deadlineId: string, dependsOnDeadlineId: string) => {
    if (!viewingId) {
      return;
    }
    await apiSendJson(
      apiBase,
      `/api/matters/${encodeURIComponent(viewingId)}/deadlines/${encodeURIComponent(deadlineId)}`,
      "PATCH",
      { dependsOnDeadlineId },
    );
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

  const extractFromDroppedFile = useCallback(
    async (dt: DataTransfer) => {
      if (!viewingId) {
        setErr("请先打开一个案件，再丢文件。");
        return;
      }
      setBusy(true);
      setErr(null);
      try {
        const pins = await pinDroppedChatFiles({
          dataTransfer: dt,
          workspaceDir,
          matterId: viewingId,
          onAdd: () => undefined,
        });
        const filePin = pins.find((p) => p.kind === "file");
        if (!filePin) {
          setErr("未能导入文件。请从 LawMind 桌面拖入 PDF 或图片。");
          return;
        }
        const j = await apiSendJson<
          { ok?: boolean; events?: ExtractedLegalEvent[]; text?: string; error?: string },
          { relPath: string; matterId: string }
        >(apiBase, "/api/desk/events/extract-file", "POST", {
          relPath: filePin.relPath,
          matterId: viewingId,
        });
        if (j.text) {
          setExtractText(j.text.slice(0, 8000));
        }
        setExtracted(j.events ?? []);
        if (!(j.events && j.events.length > 0)) {
          setErr("已读入文件，但未抽出带日期的期限。可改文字后点「抽出期限」，再确认写入。");
        }
      } catch (e) {
        setErr(errorMessage(e, "丢文件抽取失败"));
      } finally {
        setBusy(false);
      }
    },
    [apiBase, viewingId, workspaceDir],
  );

  const talkFromDroppedFile = useCallback(
    async (dt: DataTransfer) => {
      if (!viewingId) {
        setErr("请先打开一个案件，再丢谈话材料。");
        return;
      }
      setBusy(true);
      setErr(null);
      try {
        const pins = await pinDroppedChatFiles({
          dataTransfer: dt,
          workspaceDir,
          matterId: viewingId,
          onAdd: () => undefined,
        });
        const filePin = pins.find((p) => p.kind === "file");
        if (!filePin) {
          setErr("未能导入文件。");
          return;
        }
        const j = await apiSendJson<
          { ok?: boolean; text?: string; error?: string },
          { relPath: string; matterId: string }
        >(apiBase, "/api/desk/events/extract-file", "POST", {
          relPath: filePin.relPath,
          matterId: viewingId,
        });
        if (j.text?.trim()) {
          setTalk(j.text.slice(0, 12_000));
        } else {
          setErr("文件未读出文字。请换材料或手贴谈话。");
        }
      } catch (e) {
        setErr(errorMessage(e, "丢文件读谈话失败"));
      } finally {
        setBusy(false);
      }
    },
    [apiBase, viewingId, workspaceDir],
  );

  const deadlinesDrop = useChatFileDropTarget(
    matterPane === "deadlines" ? extractFromDroppedFile : undefined,
    { stopPropagation: true },
  );
  const talkDrop = useChatFileDropTarget(
    matterPane === "intake" ? talkFromDroppedFile : undefined,
    { stopPropagation: true },
  );

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
      const parties = normalizeMatterParties(partyDrafts);
      const identity = deriveMatterIdentity(parties);
      await apiSendJson(apiBase, "/api/matters/profile", "POST", {
        matterId: viewingId,
        matterKind,
        parties,
        clientId: identity.clientId ?? "",
        counterparty: identity.counterparty ?? "",
        causeOfAction: causeOfAction.trim(),
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

  const carriedOpen = actionItems.filter((item) => isCarriedPlan(item, todayDate) && !item.done).length;
  const progressLabel =
    progressTotal === 0
      ? "今天还没有事项"
      : carriedOpen > 0
        ? `今日进度 ${progressDone}/${progressTotal} · 含 ${carriedOpen} 项未结`
        : `今日进度 ${progressDone}/${progressTotal}`;
  const workspaceLabel =
    workspaceDir?.split(/[\\/]/).filter(Boolean).pop()?.trim() || "";
  const contractCount = matters.filter((row) => row.matterKind === "contract").length;
  const litigationCount = matters.filter((row) => row.matterKind === "litigation").length;
  const preferredMatterId = selectedMatterId?.trim() || viewingId || null;
  const resolveQuickMatter = (preferLitigation = false): DeskMatterRow | undefined => {
    if (preferredMatterId) {
      const selected = matters.find((m) => m.matterId === preferredMatterId);
      if (selected) {
        return selected;
      }
    }
    if (preferLitigation) {
      return matters.find((m) => m.matterKind === "litigation") ?? matters[0];
    }
    return shownMatters[0] ?? matters[0];
  };
  const artifactPathLooksOpenable = (label: string) => {
    const t = label.trim();
    if (!t) {
      return false;
    }
    return /[\\/]/.test(t) || /\.(docx?|pdf|txt|md|xlsx?|pptx?)$/i.test(t);
  };
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
            <div className="lm-lawyer-top-title">
              <p className="lm-lawyer-kicker" data-testid="lm-lawyer-desk-kicker">
                {today?.date ? formatDeskDate(today.date) : "今日"}
                {workspaceLabel ? ` · ${workspaceLabel}` : ""}
                {` · ${matters.length} 个案件`}
              </p>
              <h1>工作台</h1>
            </div>
            <div className="lm-lawyer-top-tools">
              <div className="lm-lawyer-search">
                <span className="lm-lawyer-search-ico" aria-hidden>
                  <DeskGlyph name="search" />
                </span>
                <input
                  className="lm-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="筛选本案、期限、待办…"
                  aria-label="筛选工作台"
                />
                {query.trim() ? (
                  <button
                    type="button"
                    className="lm-lawyer-search-clear"
                    aria-label="清除筛选"
                    onClick={() => setQuery("")}
                  >
                    ×
                  </button>
                ) : null}
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
                </div>
                <span className="lm-desk-ico" aria-hidden>
                  <DeskGlyph name="gavel" />
                </span>
              </div>
              <div className="lm-desk-body">
                <div className="lm-desk-scroll">
                  {shownActions.length === 0 ? (
                    <div className="lm-lawyer-empty">
                      <p className="lm-lawyer-empty-title">今天还清</p>
                      <p>在下方写计划；邮件待回复和待拍板会自动进来。未勾完的计划会接着出现。</p>
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
                                  ? planCardMeta(item, todayDate)
                                  : item.kind === "mail"
                                    ? "去对话起草回信，不会发出"
                                    : "去在办签批"}
                                {matterCaption(item.matterId) ? ` · ${matterCaption(item.matterId)}` : ""}
                              </p>
                            </div>
                            <div className="lm-desk-card-side">
                              <span
                                className={`lm-pri${item.kind === "approval" ? " lm-pri--high" : item.kind === "mail" || isCarriedPlan(item, todayDate) ? " lm-pri--mid" : ""}`}
                              >
                                {item.kind === "plan"
                                  ? isCarriedPlan(item, todayDate)
                                    ? "未结"
                                    : "计划"
                                  : item.kind === "mail"
                                    ? "待回复"
                                    : "拍板"}
                              </span>
                              {item.kind === "plan" ? (
                                <button
                                  type="button"
                                  className={`lm-desk-check${item.done ? " is-on" : ""}`}
                                  aria-label={
                                    item.done
                                      ? "标为未完成"
                                      : isCarriedPlan(item, todayDate)
                                        ? "标为完成，未结计划"
                                        : "标为完成"
                                  }
                                  data-testid={
                                    isCarriedPlan(item, todayDate)
                                      ? "lm-lawyer-today-item-plan-carried"
                                      : "lm-lawyer-today-item-plan"
                                  }
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
                  <input
                    className="lm-input"
                    value={planDraft}
                    onChange={(e) => setPlanDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void addPlan();
                      }
                    }}
                    placeholder="今天要办的事，回车加入"
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
                  <p className="lm-desk-col-delta">{deadlineOpen > 0 ? "含临近开庭" : "无今日到期"}</p>
                </div>
                <span className="lm-desk-ico" aria-hidden>
                  <DeskGlyph name="cal" />
                </span>
              </div>
              <div className="lm-desk-body">
                <div className="lm-desk-scroll">
                  {shownDeadlines.length === 0 ? (
                    <div className="lm-lawyer-empty">
                      <p className="lm-lawyer-empty-title">今天没有到期</p>
                      <p>贴传票进本案后，开庭和举证会出现在这里。</p>
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        data-testid="lm-desk-empty-summons"
                        onClick={() => {
                          const target = resolveQuickMatter(false);
                          if (target) {
                            openMatter(target.matterId, "deadlines");
                          } else {
                            setErr("请先新建案件，再贴传票。");
                          }
                        }}
                      >
                        贴传票
                      </button>
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

            <aside className="lm-desk-col lm-desk-col--matters" aria-label="本案列表">
              <div className="lm-desk-col-head">
                <div className="lm-desk-col-copy">
                  <p className="lm-desk-col-label">本案列表</p>
                  <div className="lm-desk-col-value">
                    {shownMatters.length}
                    <span className="lm-desk-col-unit">件</span>
                  </div>
                  <p className="lm-desk-col-delta">
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
                      <p className="lm-lawyer-empty-title">还没有案件</p>
                      <p>先建一卷，期限和谈话会跟在后面。</p>
                      {onCreateMatter ? (
                        <button type="button" className="lm-btn lm-btn-sm" onClick={onCreateMatter}>
                          新建案件
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <ul className="lm-desk-list" id="lm-lawyer-matter-list" role="tabpanel">
                      {shownMatters.map((row) => {
                        const isCurrent = preferredMatterId === row.matterId;
                        return (
                          <li key={row.matterId}>
                            <button
                              type="button"
                              className={`lm-matter-card${isCurrent ? " is-current" : ""}`}
                              aria-current={isCurrent ? "true" : undefined}
                              onClick={() => openMatter(row.matterId)}
                            >
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
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </aside>
          </div>

          <div className="lm-desk-dock">
            <p className="lm-desk-dock-label">本案动作</p>
            <div className="lm-desk-quick">
            <button
              type="button"
              className="lm-desk-quick-btn"
              data-testid="lm-desk-quick-summons"
              onClick={() => {
                const target = resolveQuickMatter(false);
                if (target) {
                  openMatter(target.matterId, "deadlines");
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
              data-testid="lm-desk-quick-talk"
              onClick={() => {
                const target = resolveQuickMatter(true);
                if (target) {
                  openMatter(target.matterId, "intake");
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
                  return;
                }
                requestOpenAutomationsSettings();
              }}
            >
              <span className="lm-desk-ico" aria-hidden>
                <DeskGlyph name="mail" />
              </span>
              <strong>待回复 {mailOpen}</strong>
              <span className="lm-desk-quick-desc">
                {mailOpen > 0 ? "去对话起草回信" : "去设置接邮箱"}
              </span>
            </button>
            </div>
          </div>
        </>
      ) : (
        <div className="lm-matter-file" data-testid="lm-lawyer-matter-dossier">
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
                    <div className="lm-matter-hero-badges">
                      <span className="lm-kind" data-kind={selected.matterKind}>
                        {selected.matterKindLabel}
                      </span>
                      <span className="lm-matter-status-pill">
                        {pulse?.statusLabel ?? matterStatusZh(selected.status)}
                      </span>
                    </div>
                    <h2>{pulse?.title ?? selected.title}</h2>
                    <p className="lm-matter-hero-sub">
                      {[
                        selected.docket?.caseNo || selected.matterId,
                        selected.docket?.court,
                        pulse?.clientId || selected.clientId
                          ? `客户 ${pulse?.clientId || selected.clientId}`
                          : "",
                        pulse?.counterparty ? `对方 ${pulse.counterparty}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <div className="lm-matter-hero-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    onClick={() => onGoToChat({ matterId: selected.matterId })}
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
                </div>
              </header>

              <div className="lm-pulse-bar" aria-label="本案实时" data-testid="lm-lawyer-pulse-bar">
                <button
                  type="button"
                  className={`lm-pulse-chip${(pulse?.counts.mail ?? 0) > 0 ? " is-hot" : ""}`}
                  onClick={() => setMatterPane("docs")}
                >
                  <span>待回复</span>
                  <strong>{pulse?.counts.mail ?? 0}</strong>
                </button>
                <button
                  type="button"
                  className={`lm-pulse-chip${(pulse?.counts.approvals ?? 0) > 0 ? " is-hot" : ""}`}
                  onClick={() => onOpenNeedsDecision?.(selected.matterId)}
                >
                  <span>待拍板</span>
                  <strong>{pulse?.counts.approvals ?? 0}</strong>
                </button>
                <button
                  type="button"
                  className={`lm-pulse-chip${(pulse?.daysUntilHearing ?? 99) <= 3 && pulse?.daysUntilHearing !== null && pulse?.daysUntilHearing !== undefined ? " is-hot" : ""}`}
                  onClick={() => setMatterPane("deadlines")}
                >
                  <span>开庭</span>
                  <strong>{hearingCountdown(pulse?.daysUntilHearing ?? selected.daysUntilHearing) ?? "未排"}</strong>
                </button>
                <button
                  type="button"
                  className="lm-pulse-chip"
                  onClick={() => setMatterPane("overview")}
                >
                  <span>待办任务</span>
                  <strong>{pulse?.counts.tasks ?? selected.openTaskCount ?? 0}</strong>
                </button>
              </div>

              <div className="lm-pane-tabs" role="tablist" aria-label="本案分区">
                {(
                  [
                    { id: "overview", label: "概览" },
                    { id: "docs", label: "文书", count: pulse?.counts.documents },
                    { id: "materials", label: "材料", count: pulse?.counts.materials },
                    { id: "docket", label: "卷宗" },
                    { id: "deadlines", label: "期限", count: pulse?.counts.deadlines ?? openDeadlines },
                    { id: "intake", label: "谈话" },
                    { id: "review", label: "对照", count: similar.length + standards.length },
                  ] as Array<{ id: MatterPaneId; label: string; count?: number }>
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
                    {tab.label}
                    {tab.count ? <span className="lm-pane-tab-count">{tab.count}</span> : null}
                  </button>
                ))}
              </div>

              <div className="lm-matter-scroll lm-scroll">
                {matterPane === "overview" ? (
                  <div className="lm-overview" id="lm-lawyer-pane-overview" role="tabpanel" aria-labelledby="lm-lawyer-tab-overview">
                    {(pulse?.nextActions ?? []).length > 0 ? (
                      <section className="lm-overview-card lm-overview-card--next" aria-label="本案下一步">
                        <h3>本案下一步</h3>
                        <ul className="lm-overview-next-list">
                          {(pulse?.nextActions ?? []).slice(0, 6).map((action) => (
                            <li key={action} className="lm-overview-next-item">
                              {action}
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="lm-btn lm-btn-sm"
                          onClick={() =>
                            onGoToChat({
                              matterId: selected.matterId,
                              prompt: `请按本案下一步办理：${(pulse?.nextActions ?? []).slice(0, 4).join("；")}。先出草稿，不要发送。`,
                            })
                          }
                        >
                          去对话办理
                        </button>
                      </section>
                    ) : null}
                    <section
                      className="lm-overview-card lm-overview-card--timeline"
                      aria-label="本案进展"
                      data-testid="lm-lawyer-matter-timeline"
                    >
                      <h3>本案进展</h3>
                      {(pulse?.timeline ?? []).length === 0 ? (
                        <p className="lm-meta">期限、来信、出稿和谈话写入后，会按时间出现在这里。</p>
                      ) : (
                        <div className="lm-timeline lm-matter-timeline lm-scroll">
                          {(pulse?.timeline ?? []).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`lm-timeline-row${
                                (item.kind === "hearing" || item.kind === "deadline") &&
                                isOverdue(item.at)
                                  ? " is-overdue"
                                  : ""
                              }`}
                              data-testid="lm-lawyer-matter-timeline-item"
                              onClick={() => {
                                if (item.kind === "approval") {
                                  onOpenNeedsDecision?.(selected.matterId);
                                  return;
                                }
                                if (item.kind === "deadline" || item.kind === "hearing") {
                                  setMatterPane("deadlines");
                                  return;
                                }
                                if (item.kind === "intake") {
                                  setMatterPane("intake");
                                  return;
                                }
                                setMatterPane("docs");
                              }}
                            >
                              <span className="lm-timeline-time">{formatTimelineDay(item.at)}</span>
                              <span className="lm-timeline-copy">
                                <span className="lm-desk-card-title">{item.title}</span>
                                <span className="lm-pri lm-pri--mid">
                                  {item.meta || MATTER_TIMELINE_KIND_ZH[item.kind]}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                    <section
                      className="lm-overview-card lm-overview-card--parties"
                      aria-label="当事人"
                      data-testid="lm-lawyer-matter-parties"
                    >
                      <h3>当事人</h3>
                      <LawmindMatterPartyCards parties={overviewPartiesFromPulse(pulse)} />
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        onClick={() => setMatterPane("docket")}
                      >
                        编辑当事人
                      </button>
                    </section>
                    <section className="lm-overview-card" aria-label="案件信息">
                      <h3>案件信息</h3>
                      <dl className="lm-dl">
                        <dt>案号</dt>
                        <dd>{docket.caseNo || "未填"}</dd>
                        <dt>案由</dt>
                        <dd>{causeOfAction || pulse?.causeOfAction || "未填"}</dd>
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
                              <li key={d.deadlineId} className={`lm-lawyer-deadline-row${d.released === false ? " is-waiting" : ""}`}>
                                <span className="lm-lawyer-deadline-copy">
                                  <strong>
                                    {eventKindLabel(d.eventKind)} · {d.title}
                                  </strong>
                                  <span className={`lm-lawyer-today-meta${isOverdue(d.dueAt) ? " is-hot" : ""}`}>
                                    {formatDueShort(d.dueAt)}
                                  </span>
                                  <DeadlineSourceBadge row={d} />
                                  <DeadlineWaitingLine row={d} />
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
                    <h3>待处理来信</h3>
                    {(pulse?.mail ?? []).length === 0 ? (
                      <p className="lm-meta">
                        没有待回复或法院/合同来件。
                        <button
                          type="button"
                          className="lm-btn lm-btn-ghost lm-btn-sm"
                          onClick={() => requestOpenAutomationsSettings()}
                        >
                          去设置接邮箱
                        </button>
                      </p>
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

                {matterPane === "materials" ? (
                  <section
                    className="lm-lawyer-pane"
                    id="lm-lawyer-pane-materials"
                    role="tabpanel"
                    aria-labelledby="lm-lawyer-tab-materials"
                    data-testid="lm-lawyer-matter-materials"
                  >
                    <h3>本案材料</h3>
                    {(pulse?.materials ?? []).length === 0 ? (
                      <p className="lm-meta">
                        把合同扫描件、证据放进本案 materials 文件夹后会出现在这里。引用进对话仍用侧栏钉选。
                      </p>
                    ) : (
                      <ul className="lm-lawyer-deadline-list">
                        {(pulse?.materials ?? []).map((file) => (
                          <li key={file.relPath} className="lm-lawyer-deadline-row">
                            <span className="lm-lawyer-deadline-copy">
                              <strong>{materialDisplayPath(file.relPath)}</strong>
                              <span className="lm-lawyer-today-meta">
                                {formatMaterialBytes(file.size)}
                                {file.updatedAt ? ` · ${formatDueShort(file.updatedAt)}` : ""}
                              </span>
                            </span>
                            {onShowArtifact && artifactPathLooksOpenable(file.relPath) ? (
                              <button
                                type="button"
                                className="lm-btn lm-btn-ghost lm-btn-sm"
                                onClick={() => onShowArtifact(file.relPath)}
                              >
                                打开
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <h3>出稿路径</h3>
                    {(pulse?.files ?? []).length === 0 ? (
                      <p className="lm-meta">还没有生成产物。对话出稿后路径会出现在这里。</p>
                    ) : (
                      <ul className="lm-lawyer-deadline-list">
                        {(pulse?.files ?? []).map((file) => (
                          <li key={file.label} className="lm-lawyer-deadline-row">
                            <span className="lm-lawyer-deadline-copy">{file.label}</span>
                            {onShowArtifact && artifactPathLooksOpenable(file.label) ? (
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
                    <MatterReplicaPanel apiBase={apiBase} matterId={selected.matterId} />
                  </section>
                ) : null}

                {matterPane === "docket" ? (
                  <section className="lm-lawyer-pane" id="lm-lawyer-pane-docket" role="tabpanel" aria-labelledby="lm-lawyer-tab-docket">
                    <h3>卷宗</h3>
                    <LawmindMatterPartiesEditor value={partyDrafts} disabled={busy} onChange={setPartyDrafts} />
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
                        案由
                        <input
                          className="lm-input"
                          value={causeOfAction}
                          onChange={(e) => setCauseOfAction(e.target.value)}
                          placeholder="如：房屋租赁合同纠纷"
                        />
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
                    <p className="lm-meta">扫描件、出稿路径和同事协作在「材料」。</p>
                  </section>
                ) : null}

                {matterPane === "deadlines" ? (
                  <section
                    className={`lm-lawyer-pane${deadlinesDrop.active ? " lm-chat-drop-active" : ""}`}
                    id="lm-lawyer-pane-deadlines"
                    role="tabpanel"
                    aria-labelledby="lm-lawyer-tab-deadlines"
                    data-testid="lm-lawyer-deadlines-drop"
                    {...deadlinesDrop.dropProps}
                  >
                    <h3>期限 / 开庭</h3>
                    <p className="lm-meta">可粘贴文字，或把传票 PDF/图片拖到这里；抽出后仍须确认写入。</p>
                    {deadlines.length === 0 ? (
                      <p className="lm-meta">还没有期限。把传票或 12368 短信贴到下面，确认后写入。</p>
                    ) : (
                      <ul className="lm-lawyer-deadline-list">
                        {deadlines.map((d) => (
                          <li
                            key={d.deadlineId}
                            className={`lm-lawyer-deadline-row${d.status === "completed" ? " is-done" : ""}${d.released === false ? " is-waiting" : ""}`}
                          >
                            <span className="lm-lawyer-deadline-copy">
                              <strong>
                                {eventKindLabel(d.eventKind)} · {d.title}
                              </strong>
                              <span className="lm-lawyer-today-meta">{formatDueShort(d.dueAt)}</span>
                              <DeadlineSourceBadge row={d} />
                              <DeadlineWaitingLine row={d} />
                            </span>
                            <span className="lm-lawyer-deadline-actions">
                              {d.eventKind !== "hearing" && d.status !== "completed" ? (
                                <select
                                  className="lm-input lm-deadline-depends"
                                  aria-label={`前置期限：${d.title}`}
                                  value={d.dependsOnDeadlineId ?? ""}
                                  onChange={(e) => void setDeadlineDependsOn(d.deadlineId, e.target.value)}
                                >
                                  <option value="">无前置</option>
                                  {deadlines
                                    .filter((row) => row.deadlineId !== d.deadlineId)
                                    .map((row) => (
                                      <option key={row.deadlineId} value={row.deadlineId}>
                                        {eventKindLabel(row.eventKind)} · {row.title}
                                      </option>
                                    ))}
                                </select>
                              ) : null}
                              {d.status === "open" || d.status === "snoozed" ? (
                                <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void completeDeadline(d.deadlineId)}>
                                  完成
                                </button>
                              ) : (
                                <span className="lm-meta">{d.status === "completed" ? "已完成" : d.status}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {deadlines.length > 0 ? (
                      <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void exportIcs()}>
                        导出日历
                      </button>
                    ) : null}
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
                  <section
                    className={`lm-lawyer-pane${talkDrop.active ? " lm-chat-drop-active" : ""}`}
                    id="lm-lawyer-pane-intake"
                    role="tabpanel"
                    aria-labelledby="lm-lawyer-tab-intake"
                    data-testid="lm-lawyer-talk-drop"
                    {...talkDrop.dropProps}
                  >
                    <h3>谈话整理</h3>
                    <p className="lm-meta">可粘贴谈话，或拖入 PDF/图片；整理后仍须点「写入本案档案」。</p>
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
                            <button
                              type="button"
                              className="lm-lawyer-similar-open"
                              onClick={() => openMatter(h.matterId)}
                            >
                              <strong>{h.causeOfAction || h.matterId || "相近案件"}</strong>
                            </button>
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
                    <div className="lm-lawyer-inline-actions">
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        onClick={() => requestOpenWorkspaceSettings()}
                      >
                        去设置写标准
                      </button>
                      {onOpenReview ? (
                        <button
                          type="button"
                          className="lm-btn lm-btn-sm"
                          onClick={() => onOpenReview({ matterId: selected.matterId })}
                        >
                          去审查本案
                        </button>
                      ) : null}
                    </div>
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

function DeskGlyph(props: { name: "gavel" | "cal" | "folder" | "mail" | "search" | "plus" | "talk" }): ReactNode {
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