/**
 * 工作台：对话页中栏里的案卷。左边是目录，右边是对话。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage, fetchApi } from "./api-client";
import { triggerBrowserDownload } from "./review/review-workbench-helpers";
import { type ExtractedLegalEvent } from "../../../../src/lawmind/desk/legal-event-extract.ts";
import {
  deadlineSourceCopy,
  eventKindLabel,
  formatDeskDate,
  formatDueShort,
  formatMaterialBytes,
  formatTimelineDay,
  isOverdue,
  matterHotLine,
  matterMatchesListFilter,
  materialDisplayPath,
  urgencyListRank,
  type DeskListFilter,
  type MatterUrgencyInput,
} from "./lawmind-lawyer-desk-format";
import { MATTER_KIND_LABELS, type MatterKind } from "../../../../src/lawmind/desk/matter-kind.ts";
import { acceptanceFeeView } from "./matter/litigation-fee-view";
import {
  deriveMatterIdentity,
  hydrateMatterParties,
  matterPartyEditorDrafts,
  normalizeMatterParties,
  type MatterParty,
} from "../../../../src/lawmind/desk/matter-parties.ts";
import { LawmindDaemonRecap } from "./LawmindDaemonRecap";
import { openDeliverableInWps } from "./canvas/host-actions";
import { LawmindDeskOutboundList } from "./LawmindDeskOutboundList";
import {
  outboundCountByMatter,
  pendingOutboundItems,
  type DeskOutboundItem,
} from "./lawmind-desk-outbound";
import { loadActionSummary } from "./lawmind-requires-action";
import { LawmindMatterPartiesEditor, LawmindMatterPartyCards } from "./LawmindMatterPartiesEditor";
import { MatterReplicaPanel } from "./matter/MatterReplicaPanel";
import { pinDroppedChatFiles } from "./lawmind-file-drop-context";
import { useChatFileDropTarget } from "./useChatFileDropTarget";
import { DeskGlyph, IntakeBriefBlocks, type IntakeBriefView } from "./desk-workbench-bits";
import {
  deskMatterPaneSelector,
  matterHotPaneTarget,
  type DeskMatterFocus,
  type DeskMatterFocusPane,
} from "./app/desk-matter-focus";
import { LawmindMatterBrief } from "./LawmindMatterBrief";
import { useMatterHotlineReasons } from "./useMatterHotlineReasons";
import { useMatterDocumentMeta } from "./useMatterDocumentMeta";
import {
  isDeskNativeOfficePath,
  isDeskPreviewablePath,
  isDeskWordPath,
  resolveDeskVolumeWorkspacePath,
} from "./desk-volume-file-path";
import { openDocxInReviewSurface } from "./lawmind-open-contract-revision";
import {
  requestOpenContractRevision,
  requestOpenWorkspaceFile,
} from "./lawmind-workspace-file-open";

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
  carryOmitted?: number;
};

type DeskReplicaFeedItem = {
  opId: string;
  matterId: string;
  matterTitle?: string;
  kind: string;
  actorName: string;
  createdAt: string;
  title: string;
  relPath?: string;
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
  docket?: {
    caseNo?: string;
    court?: string;
    instance?: string;
    standing?: string;
    hearingAt?: string;
    claimAmount?: string;
  };
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

type SimilarHit = {
  matterId: string;
  score: number;
  snippet: string;
  causeOfAction?: string;
  evidenceHints: string[];
  displayWarning: string;
};

type PrecedentHit = {
  matterId: string;
  section: string;
  snippet: string;
  citeAs: string;
};

type PrecedentPanelState = {
  enabled: boolean;
  hits: PrecedentHit[];
};

type MaterialSearchHit = {
  matterId: string;
  relPath: string;
  fileName: string;
  page: number;
  snippet: string;
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
    materialsOmitted?: number;
    materialsSaturated?: boolean;
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
  /** 打开删除确认（案件列表与材料一起删）。 */
  onDeleteMatter?: (matterId: string, label: string) => void;
  onOpenReview?: (opts: { matterId: string; taskId?: string }) => void;
  onShowArtifact?: (relPath: string) => void;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
  /** Open 本案卷宗 when bumped from header / sidebar / deep link. */
  deskMatterFocus?: DeskMatterFocus;
};

const KIND_FILTERS: Array<{ id: "all" | MatterKind; label: string }> = [
  { id: "all", label: "全部" },
  { id: "contract", label: "合同" },
  { id: "litigation", label: "诉讼" },
  { id: "general", label: "其他" },
];

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
    onCreateMatter,
    onDeleteMatter,
    onOpenNeedsDecision,
    onOpenReview,
    onShowArtifact,
    onReconnectLocalService,
    localServiceReconnecting,
    deskMatterFocus,
  } = props;
  const [kind, setKind] = useState<"all" | MatterKind>("all");
  const [listFilter, setListFilter] = useState<DeskListFilter>("all");
  const [today, setToday] = useState<TodaySnapshot | null>(null);
  const [replicaFeed, setReplicaFeed] = useState<DeskReplicaFeedItem[]>([]);
  const [matters, setMatters] = useState<DeskMatterRow[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [brief, setBrief] = useState<IntakeBriefView | null>(null);
  const [similar, setSimilar] = useState<SimilarHit[]>([]);
  const [standards, setStandards] = useState<AppliedStandard[]>([]);
  const [precedents, setPrecedents] = useState<PrecedentPanelState | null>(null);
  const [materialsQuery, setMaterialsQuery] = useState("");
  const [materialsHits, setMaterialsHits] = useState<MaterialSearchHit[] | null>(null);
  const [materialsSearching, setMaterialsSearching] = useState(false);
  const [extractText, setExtractText] = useState("");
  const [extracted, setExtracted] = useState<ExtractedLegalEvent[]>([]);
  const [talk, setTalk] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [docket, setDocket] = useState({
    caseNo: "",
    court: "",
    instance: "",
    standing: "",
    hearingAt: "",
    claimAmount: "",
  });
  const [partyDrafts, setPartyDrafts] = useState<MatterParty[]>([]);
  const [causeOfAction, setCauseOfAction] = useState("");
  const [pulse, setPulse] = useState<MatterPulseView | null>(null);
  const [outboundItems, setOutboundItems] = useState<DeskOutboundItem[]>([]);
  const [matterKind, setMatterKind] = useState<MatterKind>("general");
  const [view, setView] = useState<"list" | "matter">("list");
  const [openedMatterId, setOpenedMatterId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scrollPane, setScrollPane] = useState<DeskMatterFocusPane | null>(null);
  const archiveDetailsRef = useRef<HTMLDetailsElement>(null);
  const autoReconnectRef = useRef(false);
  const reconnectRef = useRef(onReconnectLocalService);
  reconnectRef.current = onReconnectLocalService;

  const viewingId = view === "matter" ? (openedMatterId ?? selectedMatterId) : null;
  const selected = useMemo(() => {
    if (!viewingId) {
      return null;
    }
    return (
      matters.find((m) => m.matterId === viewingId) ??
      fallbackDeskMatter(viewingId, pulse?.matterId === viewingId ? pulse : null, matterKind)
    );
  }, [matters, viewingId, pulse, matterKind]);

  /** 案件信息里的受理费估算：随卷宗标的金额即时重算。 */
  const acceptanceFee = useMemo(() => acceptanceFeeView(docket.claimAmount), [docket.claimAmount]);

  const todayItems = today?.items ?? [];
  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const outboundCounts = outboundCountByMatter(outboundItems);
  const matterOutbound = viewingId
    ? outboundItems.filter((item) => item.matterId === viewingId)
    : [];
  const unreadMatterIds = new Set(
    todayItems
      .filter((item) => item.kind === "mail" && !item.done && item.matterId)
      .map((item) => item.matterId as string),
  );
  const overdueMatterIds = new Set(
    todayItems
      .filter((item) => item.kind === "deadline" && !item.done && item.matterId && isOverdue(item.dueAt))
      .map((item) => item.matterId as string),
  );
  const daysUntilDeadlineFor = (matterId: string): number | null => {
    const soon = todayItems
      .filter(
        (item) =>
          item.kind === "deadline" &&
          !item.done &&
          item.matterId === matterId &&
          item.dueAt &&
          !isOverdue(item.dueAt),
      )
      .map((item) => {
        const due = new Date(item.dueAt as string);
        if (Number.isNaN(due.getTime())) {
          return null;
        }
        return Math.ceil((due.getTime() - Date.now()) / 86_400_000);
      })
      .filter((days): days is number => days !== null && days >= 0 && days <= 7)
      .toSorted((a, b) => a - b);
    return soon[0] ?? null;
  };
  const urgencyOf = (row: DeskMatterRow): MatterUrgencyInput => ({
    status: row.status,
    daysUntilHearing: row.daysUntilHearing,
    outboundCount: outboundCounts.get(row.matterId) ?? 0,
    unreplied: unreadMatterIds.has(row.matterId),
    overdueDeadline: overdueMatterIds.has(row.matterId),
    daysUntilDeadline: daysUntilDeadlineFor(row.matterId),
  });
  const shownMatters = matters
    .filter(
      (row) =>
        matches(row.title) ||
        matches(row.matterKindLabel) ||
        matches(row.docket?.caseNo ?? "") ||
        matches(row.docket?.court ?? ""),
    )
    .filter((row) => matterMatchesListFilter(listFilter, urgencyOf(row)))
    .slice()
    .toSorted((a, b) => urgencyListRank(urgencyOf(a)) - urgencyListRank(urgencyOf(b)));
  const hotlineRows = shownMatters.map((row) => {
    const u = urgencyOf(row);
    return {
      matterId: row.matterId,
      title: row.title,
      urgency: u,
      hot: matterHotLine(u),
    };
  });
  const hotlineReasons = useMatterHotlineReasons(apiBase, hotlineRows);
  const overdueCount = todayItems.filter(
    (item) => item.kind === "deadline" && !item.done && isOverdue(item.dueAt),
  ).length;
  const unrepliedCount = todayItems.filter((item) => item.kind === "mail" && !item.done).length;
  const urgencyChips: Array<{ id: Exclude<DeskListFilter, "all">; label: string }> = [
    ...(outboundItems.length > 0
      ? [{ id: "outbound" as const, label: `${outboundItems.length} 封待发出` }]
      : []),
    ...(overdueCount > 0 ? [{ id: "overdue" as const, label: `${overdueCount} 个期限已过` }] : []),
    ...(unrepliedCount > 0 ? [{ id: "unreplied" as const, label: `${unrepliedCount} 封未回` }] : []),
  ];

  const reloadToday = useCallback(async () => {
    const j = await apiGetJson<{ ok?: boolean; today?: TodaySnapshot }>(apiBase, "/api/desk/today");
    if (j.ok && j.today) {
      setToday(j.today);
    }
    try {
      const feed = await apiGetJson<{
        ok?: boolean;
        enabled?: boolean;
        feed?: DeskReplicaFeedItem[];
      }>(apiBase, "/api/desk/replica-feed");
      setReplicaFeed(feed.enabled && Array.isArray(feed.feed) ? feed.feed : []);
    } catch {
      setReplicaFeed([]);
    }
  }, [apiBase]);

  const reloadMatters = useCallback(async () => {
    const q = kind === "all" ? "" : `?kind=${kind}`;
    const j = await apiGetJson<{ ok?: boolean; matters?: DeskMatterRow[] }>(apiBase, `/api/desk/matters${q}`);
    if (j.ok && j.matters) {
      setMatters(j.matters);
    }
  }, [apiBase, kind]);

  const reloadOutbound = useCallback(async () => {
    try {
      const summary = await loadActionSummary(apiBase);
      setOutboundItems(pendingOutboundItems(summary));
    } catch {
      setOutboundItems([]);
    }
  }, [apiBase]);

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
    void Promise.all([reloadToday(), reloadMatters(), reloadOutbound()])
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
        void Promise.all([reloadToday(), reloadMatters(), reloadOutbound()])
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
  }, [reloadToday, reloadMatters, reloadOutbound]);

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
      setPrecedents(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [dl, ib, sim, prec, row, pulseRow] = await Promise.all([
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
          apiGetJson<{ ok?: boolean; enabled?: boolean; hits?: PrecedentHit[] }>(
            apiBase,
            `/api/matters/${encodeURIComponent(viewingId)}/precedents`,
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
        setPrecedents({ enabled: prec.enabled === true, hits: prec.hits ?? [] });
        setStandards(row.standards ?? []);
        setPulse(pulseRow.pulse ?? null);
        const d = selected?.docket;
        setDocket({
          caseNo: d?.caseNo ?? "",
          court: d?.court ?? "",
          instance: d?.instance ?? "",
          standing: d?.standing ?? "",
          hearingAt: d?.hearingAt ?? "",
          claimAmount: d?.claimAmount ?? "",
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

  const openMatter = (matterId: string, opts?: { scrollPane?: DeskMatterFocusPane }) => {
    setOpenedMatterId(matterId);
    setView("matter");
    setScrollPane(opts?.scrollPane ?? null);
    onSelectMatter(matterId);
  };

  const backToList = () => {
    setView("list");
    setScrollPane(null);
  };

  const revealArchive = (anchorId: string) => {
    if (archiveDetailsRef.current) {
      archiveDetailsRef.current.open = true;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({ block: "nearest" });
    });
  };

  useEffect(() => {
    const mid = deskMatterFocus?.id?.trim();
    if (!mid) {
      return;
    }
    openMatter(mid, { scrollPane: deskMatterFocus?.pane ?? undefined });
    // openMatter closes over setters; nonce forces re-open of the same matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional focus bump
  }, [deskMatterFocus?.id, deskMatterFocus?.n, deskMatterFocus?.pane]);

  useEffect(() => {
    if (view !== "matter" || !scrollPane) {
      return;
    }
    if (scrollPane === "deadlines") {
      revealArchive("lm-lawyer-pane-deadlines");
      setScrollPane(null);
      return;
    }
    const selector = deskMatterPaneSelector(scrollPane);
    const node = document.querySelector(selector);
    if (!node) {
      if (pulse) {
        setScrollPane(null);
      }
      return;
    }
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "start" });
    }
    setScrollPane(null);
  }, [view, scrollPane, viewingId, pulse, outboundItems, deadlines]);

  // 材料全文检索：命中带文件与段落号，可直接打开定位。
  const runMaterialsSearch = async () => {
    const q = materialsQuery.trim();
    if (!q || !viewingId) {
      return;
    }
    setMaterialsSearching(true);
    try {
      const j = await apiGetJson<{ ok?: boolean; hits?: MaterialSearchHit[] }>(
        apiBase,
        `/api/matters/${encodeURIComponent(viewingId)}/materials/search?q=${encodeURIComponent(q)}`,
      );
      setMaterialsHits(j.hits ?? []);
    } catch (e) {
      setErr(errorMessage(e, "材料检索失败"));
    } finally {
      setMaterialsSearching(false);
    }
  };

  // 先例「引用到对话」：出处 + 摘录进对话交办，事实隔离提示随行。
  const quotePrecedentToChat = (h: PrecedentHit) => {
    const prompt = [
      `参照先例（${h.citeAs}）的写法与口径：`,
      h.snippet ? `「${h.snippet}」` : "",
      "请结合本案事实起草；旧案事实不得写入本案。",
    ]
      .filter(Boolean)
      .join("\n");
    onGoToChat({ matterId: viewingId ?? undefined, prompt });
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

  const deadlinesDrop = useChatFileDropTarget(viewingId ? extractFromDroppedFile : undefined, {
    stopPropagation: true,
  });
  const talkDrop = useChatFileDropTarget(
    viewingId && (selected?.matterKind === "litigation" || matterKind === "litigation")
      ? talkFromDroppedFile
      : undefined,
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
          claimAmount: docket.claimAmount,
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

  const workspaceLabel =
    workspaceDir?.split(/[\\/]/).filter(Boolean).pop()?.trim() || "";
  const volumeWorkspacePath = (label: string) =>
    resolveDeskVolumeWorkspacePath(viewingId, label, workspaceDir);
  /** 中栏预览：Word 带修订信息；文本进编辑器。有 taskId 时走核对深链。 */
  const previewVolumeFile = (opts: { path?: string; taskId?: string; line?: number }) => {
    const taskId = opts.taskId?.trim();
    if (taskId) {
      if (onOpenReview && viewingId) {
        onOpenReview({ matterId: viewingId, taskId });
        return;
      }
      requestOpenContractRevision(taskId);
      return;
    }
    const path = opts.path?.trim() ?? "";
    const wsPath = path ? volumeWorkspacePath(path) : null;
    if (!wsPath) {
      return;
    }
    if (isDeskWordPath(wsPath)) {
      void openDocxInReviewSurface({
        relPath: wsPath,
        apiBase,
        workspaceDir: workspaceDir ?? undefined,
        onTask: onOpenReview && viewingId
          ? (tid) => onOpenReview({ matterId: viewingId, taskId: tid })
          : undefined,
      });
      return;
    }
    requestOpenWorkspaceFile(
      wsPath,
      "workspace",
      opts.line && opts.line > 0 ? { line: opts.line } : undefined,
    );
  };
  const openVolumeFileInApp = (label: string) => {
    const wsPath = volumeWorkspacePath(label);
    if (!wsPath) {
      setErr("打不开这份文件。");
      return;
    }
    if (isDeskNativeOfficePath(wsPath)) {
      void openDeliverableInWps(wsPath).then((result) => {
        if (!result.ok && result.error) {
          setErr(result.error);
        }
      });
      return;
    }
    const openWithSystem = typeof window !== "undefined" ? window.lawmindDesktop?.openWithSystem : undefined;
    if (openWithSystem) {
      void openWithSystem({ root: "workspace", path: wsPath }).then((result) => {
        if (result && !result.ok) {
          setErr(result.error ?? "无法用本机应用打开。");
        }
      });
      return;
    }
    if (onShowArtifact) {
      onShowArtifact(wsPath);
      return;
    }
    setErr("现在不能用本机应用打开这份文件。");
  };
  const recentDeadlines = deadlines
    .filter((row) => (row.status === "open" || row.status === "snoozed") && row.released !== false)
    .filter((row) => {
      if (isOverdue(row.dueAt)) {
        return true;
      }
      const due = new Date(row.dueAt);
      if (Number.isNaN(due.getTime())) {
        return false;
      }
      const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
      return days >= 0 && days <= 7;
    })
    .slice()
    .toSorted((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 3);
  const outboundAttachments = matterOutbound.flatMap((item) => item.attachments);
  const docMetaByTask = useMatterDocumentMeta(
    apiBase,
    viewingId,
    pulse?.documents ?? [],
    outboundAttachments,
  );
  const unrepliedMail = (pulse?.mail ?? []).filter(
    (msg) => msg.label === "needs_reply" || msg.label === "court",
  );
  const pendingApprovals = pulse?.counts.approvals ?? 0;
  const showNow =
    matterOutbound.length > 0 ||
    unrepliedMail.length > 0 ||
    recentDeadlines.length > 0 ||
    (pendingApprovals > 0 && Boolean(onOpenNeedsDecision));
  const documentPaths = new Set(
    (pulse?.documents ?? [])
      .map((doc) => doc.outputPath)
      .filter((path): path is string => Boolean(path)),
  );
  const materialPaths = new Set((pulse?.materials ?? []).map((file) => file.relPath));
  const restFiles = (pulse?.files ?? []).filter(
    (file) => !documentPaths.has(file.label) && !materialPaths.has(file.label),
  );
  const volumeEmpty =
    (pulse?.materials ?? []).length === 0 &&
    (pulse?.documents ?? []).length === 0 &&
    restFiles.length === 0;

  const volumeFileActions = (opts: {
    path?: string;
    taskId?: string;
    line?: number;
    testIdPrefix?: string;
  }) => {
    const path = opts.path?.trim() ?? "";
    const taskId = opts.taskId?.trim() ?? "";
    const canPreview =
      Boolean(taskId) ||
      (Boolean(path) && (isDeskWordPath(path) || isDeskPreviewablePath(path)));
    const canOpenApp = Boolean(path) && (isDeskNativeOfficePath(path) || isDeskPreviewablePath(path));
    if (!canPreview && !canOpenApp) {
      return null;
    }
    const prefix = opts.testIdPrefix ?? "lm-volume-file";
    return (
      <span className="lm-lawyer-deadline-actions" data-testid={`${prefix}-actions`}>
        {canPreview ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid={`${prefix}-preview`}
            title={isDeskWordPath(path) || taskId ? "中栏预览，带修订信息" : "中栏预览"}
            onClick={() => previewVolumeFile({ path: path || undefined, taskId: taskId || undefined, line: opts.line })}
          >
            {isDeskWordPath(path) || taskId ? "预览核对" : "预览"}
          </button>
        ) : null}
        {canOpenApp ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid={`${prefix}-open-app`}
            title="用本机应用打开"
            onClick={() => openVolumeFileInApp(path)}
          >
            用本机应用打开
          </button>
        ) : null}
      </span>
    );
  };

  return (
    <section className="lm-lawyer-workbench" data-testid="lm-lawyer-workbench" aria-label="工作台">
      <header className="lm-lawyer-top">
        <div className="lm-lawyer-top-title">
          <p className="lm-lawyer-kicker" data-testid="lm-lawyer-desk-kicker">
            {today?.date ? formatDeskDate(today.date) : "案卷"}
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
              placeholder="筛选案名、案号…"
              aria-label="筛选案卷"
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
            {view === "matter" ? (
              <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={backToList}>
                全部案卷
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
        {view === "list" ? (
          <div className="lm-desk-case-list" aria-label="案件">
            <LawmindDaemonRecap apiBase={apiBase} />
            {replicaFeed.length > 0 ? (
              <div className="lm-desk-replica-note" data-testid="lm-desk-replica-feed">
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  onClick={() => openMatter(replicaFeed[0]?.matterId ?? "")}
                >
                  {`协作新材料 ${replicaFeed.length} 条 · ${replicaFeed[0]?.title ?? ""}`}
                </button>
                {replicaFeed[0]?.kind === "material.put" ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm lm-btn-secondary"
                    data-testid={`lm-desk-replica-organize-${replicaFeed[0].opId}`}
                    onClick={() => {
                      const pathHint = replicaFeed[0]?.relPath ? `（路径 ${replicaFeed[0].relPath}）` : "";
                      onGoToChat({
                        matterId: replicaFeed[0]?.matterId,
                        prompt: `请把协作同步来的新材料整理入卷${pathHint}：核对文件名、建议归入 materials 子目录，并更新本案要点。只整理本案材料，不要改无关案件。`,
                      });
                    }}
                  >
                    整理入卷
                  </button>
                ) : null}
              </div>
            ) : null}
            {urgencyChips.length > 0 ? (
              <div className="lm-desk-urgency-strip" data-testid="lm-desk-urgency-strip" aria-label="跨案紧急事项">
                {urgencyChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`lm-desk-urgency-chip${listFilter === chip.id ? " is-active" : ""}`}
                    aria-pressed={listFilter === chip.id}
                    onClick={() => setListFilter((current) => (current === chip.id ? "all" : chip.id))}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="lm-desk-filters" aria-label="工作门类">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={kind === f.id}
                  className={`lm-desk-seg ${kind === f.id ? "is-active" : ""}`}
                  onClick={() => setKind(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {shownMatters.length === 0 ? (
              <div className="lm-lawyer-empty" data-testid="lm-lawyer-matter-empty">
                <p className="lm-lawyer-empty-title">
                  {listFilter === "all" ? "还没有案件" : "没有这类案子"}
                </p>
                <p>
                  {listFilter === "all"
                    ? "先建一卷。期限、来信和待发出会跟在案名旁边。"
                    : "换一个条件，或回到全部案卷。"}
                </p>
                {listFilter !== "all" ? (
                  <button type="button" className="lm-btn lm-btn-sm" onClick={() => setListFilter("all")}>
                    全部案卷
                  </button>
                ) : onCreateMatter ? (
                  <button type="button" className="lm-btn lm-btn-sm" onClick={onCreateMatter}>
                    新建案件
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="lm-desk-list" id="lm-lawyer-matter-list">
                {shownMatters.map((row) => {
                  const urgency = urgencyOf(row);
                  const hot = matterHotLine(urgency);
                  const hotPane = matterHotPaneTarget(urgency);
                  const reason = hotlineReasons[row.matterId];
                  return (
                    <li key={row.matterId}>
                      <div
                        role="button"
                        tabIndex={0}
                        className="lm-matter-card"
                        data-testid="lm-matter-row"
                        onClick={() => openMatter(row.matterId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openMatter(row.matterId);
                          }
                        }}
                      >
                        <span className="lm-matter-card-body">
                          <strong>{row.title}</strong>
                          {hot ? (
                            hotPane ? (
                              <span
                                role="link"
                                tabIndex={0}
                                className="lm-matter-hotline lm-matter-hotline-link"
                                data-testid="lm-matter-hotline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMatter(row.matterId, { scrollPane: hotPane });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.stopPropagation();
                                    openMatter(row.matterId, { scrollPane: hotPane });
                                  }
                                }}
                              >
                                {hot}
                              </span>
                            ) : (
                              <span className="lm-matter-hotline" data-testid="lm-matter-hotline">
                                {hot}
                              </span>
                            )
                          ) : null}
                          {reason && reason !== hot ? (
                            <span className="lm-meta lm-matter-hot-reason" data-testid="lm-matter-hot-reason">
                              {reason}
                            </span>
                          ) : null}
                        </span>
                        <span className="lm-matter-card-chev" aria-hidden>
                          →
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : !selected ? (
          <div className="lm-lawyer-empty">
            <p className="lm-lawyer-empty-title">选一个案件</p>
            <button type="button" className="lm-btn lm-btn-sm" onClick={backToList}>
              全部案卷
            </button>
          </div>
        ) : (
          <div className="lm-matter-file" data-testid="lm-lawyer-matter-dossier">
            <header className="lm-matter-hero">
              <div className="lm-matter-id">
                <span className="lm-matter-folder" aria-hidden>
                  <DeskGlyph name="folder" />
                </span>
                <div>
                  <h2>{pulse?.title ?? selected.title}</h2>
                  <p className="lm-matter-hero-sub">
                    {[
                      pulse?.clientId || selected.clientId
                        ? `客户 ${pulse?.clientId || selected.clientId}`
                        : "",
                      pulse?.counterparty ? `对方 ${pulse.counterparty}` : "",
                      selected.docket?.caseNo ?? "",
                      selected.docket?.court ?? "",
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
                  接着办
                </button>
                {onDeleteMatter ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    onClick={() => onDeleteMatter(selected.matterId, pulse?.title ?? selected.title)}
                  >
                    删除案件
                  </button>
                ) : null}
              </div>
            </header>

            <LawmindMatterBrief apiBase={apiBase} matterId={selected.matterId} />

            {showNow ? (
              <section className="lm-matter-now" data-testid="lm-matter-now" aria-label="现在">
                <h3>现在</h3>
                {matterOutbound.length > 0 ? (
                  <LawmindDeskOutboundList
                    apiBase={apiBase}
                    workspaceDir={workspaceDir}
                    items={matterOutbound}
                    onChanged={() => {
                      void reloadOutbound();
                    }}
                  />
                ) : null}
                {pendingApprovals > 0 && onOpenNeedsDecision ? (
                  <div>
                    <h3>待拍板</h3>
                    <ul className="lm-lawyer-deadline-list">
                      <li className="lm-lawyer-deadline-row">
                        <span className="lm-lawyer-deadline-copy">
                          <strong>{pendingApprovals} 项待你确认</strong>
                          <span className="lm-lawyer-today-meta">发信、工具调用或其他要拍板的事项</span>
                        </span>
                        <button
                          type="button"
                          className="lm-btn lm-btn-sm"
                          data-testid="lm-matter-open-needs-decision"
                          onClick={() => onOpenNeedsDecision(selected.matterId)}
                        >
                          去拍板
                        </button>
                      </li>
                    </ul>
                  </div>
                ) : null}
                {unrepliedMail.length > 0 ? (
                  <div>
                    <h3>未回</h3>
                    <ul className="lm-lawyer-deadline-list">
                      {unrepliedMail.map((msg) => (
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
                            去对话起草
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {recentDeadlines.length > 0 ? (
                  <div>
                    <h3>期限</h3>
                    <ul className="lm-lawyer-deadline-list">
                      {recentDeadlines.map((row) => (
                        <li key={row.deadlineId} className="lm-lawyer-deadline-row">
                          <span className="lm-lawyer-deadline-copy">
                            <strong>
                              {eventKindLabel(row.eventKind)} · {row.title}
                            </strong>
                            <span className="lm-lawyer-today-meta">
                              {formatDueShort(row.dueAt)}
                              {isOverdue(row.dueAt) ? " · 已过" : ""}
                              {deadlineSourceCopy(row) ? ` · ${deadlineSourceCopy(row)}` : ""}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      onClick={() => revealArchive("lm-lawyer-pane-deadlines")}
                    >
                      全部期限
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="lm-matter-volume" id="lm-matter-volume" data-testid="lm-lawyer-matter-materials" aria-label="卷">
              <h3>卷</h3>
              {(pulse?.counts.materialsOmitted ?? 0) > 0 ? (
                <p className="lm-meta">
                  这一页列出最近的 {pulse?.counts.materials ?? 0} 份，
                  {pulse?.counts.materialsSaturated ? "至少还有" : "还有"}
                  {pulse?.counts.materialsOmitted} 份没列在这里。检索仍会查已编入的正文。
                </p>
              ) : null}
              <div className="lm-lawyer-inline-actions">
                <input
                  className="lm-input"
                  data-testid="lm-materials-search-input"
                  placeholder="检索材料正文（如：违约金 条款）"
                  value={materialsQuery}
                  onChange={(e) => setMaterialsQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void runMaterialsSearch();
                    }
                  }}
                />
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  data-testid="lm-materials-search-run"
                  disabled={materialsSearching || !materialsQuery.trim()}
                  onClick={() => void runMaterialsSearch()}
                >
                  {materialsSearching ? "检索中…" : "检索"}
                </button>
              </div>
              {materialsHits !== null ? (
                materialsHits.length === 0 ? (
                  <p className="lm-meta">材料正文里没有命中。可换个关键词，或确认材料已放进本案 materials 文件夹。</p>
                ) : (
                  <ul className="lm-lawyer-deadline-list" data-testid="lm-materials-search-hits">
                    {materialsHits.map((hit) => (
                      <li key={`${hit.relPath}#${hit.page}`} className="lm-lawyer-deadline-row">
                        <span className="lm-lawyer-deadline-copy">
                          <strong>
                            {hit.fileName}（第 {hit.page} 段）
                          </strong>
                          <span className="lm-lawyer-today-meta">{hit.snippet}</span>
                        </span>
                        {volumeFileActions({
                          path: hit.relPath,
                          line: hit.page,
                          testIdPrefix: "lm-materials-hit",
                        })}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
              {volumeEmpty ? <p className="lm-meta">这一卷还没有文件。</p> : null}
              {(pulse?.materials ?? []).length > 0 ? (
                <div>
                  <h3>来件</h3>
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
                        {volumeFileActions({ path: file.relPath, testIdPrefix: "lm-materials-file" })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(pulse?.documents ?? []).length > 0 ? (
                <div>
                  <h3>我们写的</h3>
                  <ul className="lm-lawyer-deadline-list">
                    {(pulse?.documents ?? []).map((doc) => {
                      const meta = doc.taskId ? docMetaByTask.get(doc.taskId) : undefined;
                      return (
                        <li key={doc.id} className="lm-lawyer-deadline-row">
                          <span className="lm-lawyer-deadline-copy">
                            <strong>{doc.title}</strong>
                            <span className="lm-lawyer-today-meta">
                              {doc.status}
                              {doc.at ? ` · ${formatDueShort(doc.at)}` : ""}
                              {meta?.outboundAttachment ? " · 待发出的附件" : ""}
                              {meta?.lawyerEditedLabel ? ` · ${meta.lawyerEditedLabel}` : ""}
                            </span>
                          </span>
                          {volumeFileActions({
                            path: doc.outputPath,
                            taskId: doc.taskId,
                            testIdPrefix: "lm-volume-doc",
                          })}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {restFiles.length > 0 ? (
                <div>
                  <h3>其余</h3>
                  <ul className="lm-lawyer-deadline-list">
                    {restFiles.map((file) => (
                      <li key={file.label} className="lm-lawyer-deadline-row">
                        <span className="lm-lawyer-deadline-copy">{file.label}</span>
                        {volumeFileActions({ path: file.label, testIdPrefix: "lm-volume-rest" })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <details className="lm-matter-archive" data-testid="lm-matter-archive" ref={archiveDetailsRef}>
              <summary>档案</summary>
              <section className="lm-lawyer-pane" aria-label="当事人" data-testid="lm-lawyer-matter-parties">
                <h3>当事人</h3>
                <LawmindMatterPartyCards parties={overviewPartiesFromPulse(pulse)} />
              </section>
              <section className="lm-lawyer-pane" id="lm-lawyer-docket-fields" aria-label="案情">
                <h3>案号与案情</h3>
                <LawmindMatterPartiesEditor value={partyDrafts} disabled={busy} onChange={setPartyDrafts} />
                <div className="lm-lawyer-docket-grid">
                  <label>
                    门类
                    <select
                      className="lm-input"
                      value={matterKind}
                      onChange={(e) => setMatterKind(e.target.value as MatterKind)}
                    >
                      {(Object.keys(MATTER_KIND_LABELS) as MatterKind[]).map((k) => (
                        <option key={k} value={k}>
                          {MATTER_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <span className="lm-field-hint">
                      案由里的「合同纠纷」仍是诉讼。合同指正在审改协议。顾问和还没定的归其他。
                    </span>
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
                    <input
                      className="lm-input"
                      value={docket.caseNo}
                      onChange={(e) => setDocket({ ...docket, caseNo: e.target.value })}
                    />
                  </label>
                  <label>
                    法院
                    <input
                      className="lm-input"
                      value={docket.court}
                      onChange={(e) => setDocket({ ...docket, court: e.target.value })}
                    />
                  </label>
                  <label>
                    审级
                    <input
                      className="lm-input"
                      value={docket.instance}
                      onChange={(e) => setDocket({ ...docket, instance: e.target.value })}
                    />
                  </label>
                  <label>
                    诉讼地位
                    <input
                      className="lm-input"
                      value={docket.standing}
                      onChange={(e) => setDocket({ ...docket, standing: e.target.value })}
                    />
                  </label>
                  <label>
                    开庭日
                    <input
                      className="lm-input"
                      value={docket.hearingAt}
                      onChange={(e) => setDocket({ ...docket, hearingAt: e.target.value })}
                    />
                  </label>
                  <label>
                    标的金额
                    <input
                      className="lm-input"
                      value={docket.claimAmount ?? ""}
                      onChange={(e) => setDocket({ ...docket, claimAmount: e.target.value })}
                      placeholder="如：32,100 元（照原文）"
                    />
                  </label>
                </div>
                <p className="lm-meta">
                  受理费 {acceptanceFee.value}
                  {acceptanceFee.hint ? ` ${acceptanceFee.hint}` : ""}
                </p>
                <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void saveDocket()}>
                  保存卷宗
                </button>
              </section>

              <section
                className={`lm-lawyer-pane${deadlinesDrop.active ? " lm-chat-drop-active" : ""}`}
                id="lm-lawyer-pane-deadlines"
                data-testid="lm-lawyer-deadlines-drop"
                aria-label="全部期限"
                {...deadlinesDrop.dropProps}
              >
                <h3>全部期限</h3>
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
                            <button
                              type="button"
                              className="lm-btn lm-btn-ghost lm-btn-sm"
                              onClick={() => void completeDeadline(d.deadlineId)}
                            >
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
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={busy}
                    onClick={() => void runExtract()}
                  >
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

              {selected.matterKind === "litigation" || matterKind === "litigation" ? (
                <section
                  className={`lm-lawyer-pane${talkDrop.active ? " lm-chat-drop-active" : ""}`}
                  id="lm-lawyer-pane-intake"
                  data-testid="lm-lawyer-talk-drop"
                  aria-label="谈话记录"
                  {...talkDrop.dropProps}
                >
                  <h3>谈话记录</h3>
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
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        disabled={busy}
                        onClick={() => void confirmIntake()}
                      >
                        写入本案档案
                      </button>
                    ) : null}
                  </div>
                  {brief?.confirmedAt ? <p className="lm-meta">已写入档案 · {formatDueShort(brief.confirmedAt)}</p> : null}
                  {brief ? <IntakeBriefBlocks brief={brief} onApplyCause={(label) => void applyCause(label)} /> : null}
                </section>
              ) : null}

              <section className="lm-lawyer-pane" aria-label="本案进展" data-testid="lm-lawyer-matter-timeline">
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
                          (item.kind === "hearing" || item.kind === "deadline") && isOverdue(item.at)
                            ? " is-overdue"
                            : ""
                        }`}
                        data-testid="lm-lawyer-matter-timeline-item"
                        onClick={() => {
                          if (item.kind === "deadline" || item.kind === "hearing") {
                            revealArchive("lm-lawyer-pane-deadlines");
                            return;
                          }
                          if (item.kind === "intake") {
                            revealArchive("lm-lawyer-pane-intake");
                            return;
                          }
                          if (item.kind === "approval" && onOpenNeedsDecision) {
                            onOpenNeedsDecision(selected.matterId);
                            return;
                          }
                          if (item.kind === "document" || item.kind === "task") {
                            const tid = item.id.includes(":") ? item.id.slice(item.id.indexOf(":") + 1) : "";
                            if (tid) {
                              previewVolumeFile({ taskId: tid });
                              return;
                            }
                          }
                          document.getElementById("lm-matter-volume")?.scrollIntoView({ block: "nearest" });
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

              {similar.length > 0 || (precedents?.hits.length ?? 0) > 0 || standards.length > 0 ? (
                <section className="lm-lawyer-pane" aria-label="旧案与先例">
                  <h3>相关旧案</h3>
                  {similar.length === 0 ? (
                    <p className="lm-meta">还没有足够接近的旧案。对照只看案由和证据缺口，不会把旧案事实写入本案。</p>
                  ) : (
                    <ul className="lm-lawyer-similar-list">
                      {similar.map((h) => (
                        <li key={h.matterId}>
                          <button type="button" className="lm-lawyer-similar-open" onClick={() => openMatter(h.matterId)}>
                            <strong>{h.causeOfAction || h.matterId || "相近案件"}</strong>
                          </button>
                          {h.snippet ? <p className="lm-meta">{h.snippet}</p> : null}
                          {h.evidenceHints.length > 0 ? (
                            <p className="lm-meta">证据缺口对照：{h.evidenceHints.join("；")}</p>
                          ) : null}
                          <p className="lm-meta">{h.displayWarning}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3>可引用先例</h3>
                  {precedents === null ? (
                    <p className="lm-meta">正在检索旧案交付物…</p>
                  ) : !precedents.enabled ? (
                    <p className="lm-meta">
                      先例检索还没在这台电脑上打开。打开之后，这里会列出旧案已签批文书里可参照的段落。
                    </p>
                  ) : precedents.hits.length === 0 ? (
                    <p className="lm-meta">暂无可参照的旧案交付物段落。先例只作案由与写法参照，事实以本案为准。</p>
                  ) : (
                    <ul className="lm-lawyer-similar-list" data-testid="lm-precedent-list">
                      {precedents.hits.map((h, i) => (
                        <li key={`${h.matterId}-${i}`}>
                          <strong>{h.citeAs}</strong>
                          {h.snippet ? <p className="lm-meta">{h.snippet}</p> : null}
                          <div className="lm-lawyer-inline-actions">
                            <button
                              type="button"
                              className="lm-btn lm-btn-ghost lm-btn-sm"
                              onClick={() => quotePrecedentToChat(h)}
                            >
                              引用到对话
                            </button>
                          </div>
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
                </section>
              ) : null}

              <details className="lm-matter-collab" data-testid="lm-lawyer-matter-collab">
                <summary>邀请同事</summary>
                <MatterReplicaPanel apiBase={apiBase} matterId={selected.matterId} />
              </details>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
