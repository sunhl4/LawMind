/**
 * 在办 — 交办册：左侧停在你这里 / 正在办 / 今天办完，右侧办理这一件。
 * 签批、补充、发出仍在这一件上完成；改稿从这一件进入。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  loadActionSummary,
  type LawMindRequiresAction,
  type ActionSummaryPayload,
} from "./lawmind-requires-action";
import {
  appendEncodedLine,
  CLARIFY_ATTACHMENTS_KEY,
  CLARIFY_SESSIONS_KEY,
  clarificationAnswersComplete,
  encodeClarificationFileAnswer,
  encodeClarificationSessionRef,
} from "../../../../src/lawmind/platform/clarification-fields.ts";
import { registerClarifyBringInHandlers } from "./lawmind-clarify-bring-in-bus";
import {
  firstNeedsYouIdForMatter,
  isMatterOnlyDeskTarget,
  loadAgentFleet,
  loadAssistantGrowth,
  loadFleetTranscript,
  matchNeedsDecisionFocusId,
  type AgentFleetSummary,
  type AgentRunSummary,
} from "./lawmind-agent-fleet-api";
import type { NeedsDecisionDeskTarget } from "./lawmind-agents-desk";
import type { IntakeItem } from "../../../../src/lawmind/intake/types.ts";
import { MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS } from "../../../../src/lawmind/platform/matter-run-wait.ts";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { confirmDialog } from "./lawmind-confirm-dialog";
import { openContractRevisionForTask } from "./lawmind-open-contract-revision";
import {
  buildChecklistView,
  type VerificationChecklistView,
} from "../../../../src/lawmind/deliverables/verification-checklist.ts";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { validateDraftAgainstSpec } from "../../../../src/lawmind/deliverables/validator.ts";
import {
  clearPersistedPostApproveExport,
  persistPostApproveExport,
  readPersistedPostApproveExport,
  type PostApproveExportState,
} from "./lawmind-post-approve-export";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";
import {
  extractApprovalDocumentPreview,
  toolArgsAreDocumentWrite,
  toolArgsHaveLawyerEditableShortFields,
  toolArgsLinkedTaskId,
} from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import { useChatSessionMultiSelect } from "./lawmind-chat-session-selection";
import { fleetBatchOutboundSends, fleetListOrderedIds } from "./lawmind-fleet-selection";
import {
  automationSendInboxId,
  collectOutboundInboxIds,
  fleetApprovalDockLabels,
} from "./lawmind-fleet-queue";
import {
  buildFleetDocket,
  docketInstruction,
  docketRowTitle,
  docketStopLine,
  filterDocketByMatter,
  initialDocketOpen,
} from "./lawmind-fleet-docket";
import { useRequireSignoffReview } from "./lawmind-review-prefs";

/** 离开在办再进来时先画出上次的目录，再在后台刷新。按 apiBase 区分工作区。 */
type FleetDeskCache = {
  apiBase: string;
  fleet: AgentFleetSummary;
  summary: ActionSummaryPayload;
  matterLabelById: Record<string, string>;
};

let fleetDeskCache: FleetDeskCache | null = null;
let fleetLoadGeneration = 0;

function readFleetDeskCache(apiBase: string): FleetDeskCache | null {
  return fleetDeskCache?.apiBase === apiBase ? fleetDeskCache : null;
}

function matterLabelsFromOverviews(
  overviews: Array<{ matterId: string; displayName?: string; title?: string }> | undefined,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const row of overviews ?? []) {
    const id = row.matterId?.trim();
    if (!id) {
      continue;
    }
    const title = row.displayName?.trim() || row.title?.trim();
    if (title) {
      labels[id] = title;
    }
  }
  return labels;
}

/** 案件名和「待教」不挡目录。失败就留着上一次的名字。 */
async function fetchFleetDeskExtras(apiBase: string): Promise<{
  labels: Record<string, string>;
  growth: AgentFleetSummary["growth"] | null;
}> {
  const [overviews, growth] = await Promise.all([
    apiGetJson<{
      ok?: boolean;
      overviews?: Array<{ matterId: string; displayName?: string; title?: string }>;
    }>(apiBase, "/api/matters/overviews").catch(() => null),
    loadAssistantGrowth(apiBase, 30).catch(() => null),
  ]);
  return {
    labels: matterLabelsFromOverviews(overviews?.overviews),
    growth,
  };
}
import { collectFleetActions, pickFleetActionForRun } from "./lawmind-fleet-actions";
import { LawmindAgentFleetListAside } from "./LawmindAgentFleetListAside";
import { LawmindAgentFleetDetail } from "./LawmindAgentFleetDetail";
import { LawmindIntakeDetail, type LawmindIntakeLeadAction } from "./LawmindIntakeDetail";
import { LawmindMatterRunWaitDetail } from "./LawmindMatterRunWaitDetail";
import { LawmindAgentFleetEmpty } from "./LawmindAgentFleetEmpty";
import { LawmindDaemonRecap } from "./LawmindDaemonRecap";
import { createFleetCeremonyActions } from "./useLawmindFleetCeremonyActions";
import { useFleetDeskViewStore } from "./stores/fleet-desk-view-store";

export type LawmindAgentFleetPanelProps = {
  apiBase: string;
  /** For opening exported Word via workspace-relative path */
  workspaceDir?: string;
  /** 会话挂的本机项目夹（导出件可能落在那里）。 */
  projectDir?: string | null;
  sessionId?: string;
  sessionRequiresActions?: LawMindRequiresAction[];
  assistantDisplayById: Record<string, string>;
  needsDecisionFocus?: boolean;
  onClearNeedsDecisionFocus?: () => void;
  /** 对话深链：选中具体待补充/待批准行 */
  focusTarget?: NeedsDecisionDeskTarget | null;
  onFocusTargetConsumed?: () => void;
  onRefreshSummary?: () => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => void;
  onOpenReview?: (taskId?: string, matterId?: string) => void;
  /** 导出成功后在文件夹中显示 */
  onShowArtifact?: (outputPath: string) => void;
  /** 打开设置→记忆（待教团队） */
  onOpenMemoryInspector?: () => void;
  /** 打开设置→系统健康（签批写戳失败次链） */
  onOpenHealth?: () => void;
  /** 筛选停在某一案时，回到工作台这一卷。 */
  onOpenMatterOnDesk?: (matterId: string) => void;
};

export function LawmindAgentFleetPanel(props: LawmindAgentFleetPanelProps): ReactNode {
  const {
    apiBase,
    workspaceDir,
    projectDir = null,
    sessionId,
    sessionRequiresActions = [],
    assistantDisplayById,
    needsDecisionFocus = false,
    onClearNeedsDecisionFocus,
    focusTarget = null,
    onFocusTargetConsumed,
    onRefreshSummary,
    onChatResumeComplete,
    onOpenChatSession,
    onOpenReview,
    onShowArtifact,
    onOpenMemoryInspector,
    onOpenHealth,
    onOpenMatterOnDesk,
  } = props;

  const cachedDesk = readFleetDeskCache(apiBase);
  const [fleet, setFleet] = useState<AgentFleetSummary | null>(cachedDesk?.fleet ?? null);
  const [summary, setSummary] = useState<ActionSummaryPayload | null>(cachedDesk?.summary ?? null);
  const [matterLabelById, setMatterLabelById] = useState<Record<string, string>>(
    cachedDesk?.matterLabelById ?? {},
  );
  const [loading, setLoading] = useState(!cachedDesk);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requireSignoffReview = useRequireSignoffReview();
  // 左栏视图状态（按事项/按助手、筛选、分组展开、稍后看）在 zustand 域 store；见 stores/README.md。
  const matterFilter = useFleetDeskViewStore((s) => s.matterFilter);
  const snoozed = useFleetDeskViewStore((s) => s.snoozed);
  const setMatterFilter = useFleetDeskViewStore((s) => s.setMatterFilter);
  const resetFiltersForDeepLink = useFleetDeskViewStore((s) => s.resetFiltersForDeepLink);
  const snoozeRun = useFleetDeskViewStore((s) => s.snooze);
  const snoozeMany = useFleetDeskViewStore((s) => s.snoozeMany);
  const resetFleetViewTransient = useFleetDeskViewStore((s) => s.resetTransient);
  const [onlyMine, setOnlyMine] = useState(false);
  const [inFlightOpen, setInFlightOpen] = useState(true);
  const [settledOpen, setSettledOpen] = useState(false);
  const [bandsReady, setBandsReady] = useState(false);
  const [instructionLine, setInstructionLine] = useState("");
  const [clarificationDraft, setClarificationDraft] = useState<Record<string, string>>({});
  const [runActions, setRunActions] = useState<LawMindRequiresAction[]>([]);
  const [argsEditOpen, setArgsEditOpen] = useState(false);
  const [argsEditError, setArgsEditError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(Boolean(cachedDesk));
  const [deskChecklistView, setDeskChecklistView] = useState<VerificationChecklistView | null>(
    null,
  );
  const [deskChecklistChecked, setDeskChecklistChecked] = useState<Record<string, boolean>>({});
  const [deskChecklistLoading, setDeskChecklistLoading] = useState(false);
  const [deskAcceptanceReady, setDeskAcceptanceReady] = useState(false);
  const [deskDraftReviewStatus, setDeskDraftReviewStatus] = useState<
    "pending" | "approved" | "rejected" | "modified" | undefined
  >(undefined);
  const [postApproveExport, setPostApproveExport] = useState<PostApproveExportState | null>(null);
  const [trackedExportBusy, setTrackedExportBusy] = useState(false);
  const [saveAutomationBusy, setSaveAutomationBusy] = useState(false);
  const [saveAutomationHint, setSaveAutomationHint] = useState<string | null>(null);
  const [intakeItem, setIntakeItem] = useState<(IntakeItem & { text: string }) | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakeMatterId, setIntakeMatterId] = useState("");
  const [intakeRememberSender, setIntakeRememberSender] = useState(false);
  const [intakeLeadTitle, setIntakeLeadTitle] = useState("");

  // 重挂载复位瞬时视图态（对齐原 useState 初始语义）；持久化切片由 store 保留。
  useLayoutEffect(() => {
    resetFleetViewTransient();
  }, [resetFleetViewTransient]);

  /**
   * 待办目录与侧栏「待我拍板」一致：始终拉全工作区，不跟对话 contextMatterId 过滤。
   * 否则切换/回填案件上下文后，其它案件的签批会在数秒轮询后「突然消失」。
   */
  const refresh = useCallback(
    async (opts?: { silent?: boolean; extras?: boolean }) => {
      if (!apiBase) {
        return;
      }
      const gen = ++fleetLoadGeneration;
      if (!opts?.silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const f = await loadAgentFleet(apiBase, null);
        if (gen !== fleetLoadGeneration) {
          return;
        }
        setFleet((prev) => (prev?.growth ? { ...f, growth: prev.growth } : f));
        setHasLoaded(true);
        setLoading(false);
        const s = await loadActionSummary(apiBase);
        if (gen !== fleetLoadGeneration) {
          return;
        }
        setSummary(s);
        fleetDeskCache = {
          apiBase,
          fleet: fleetDeskCache?.apiBase === apiBase && fleetDeskCache.fleet.growth
            ? { ...f, growth: fleetDeskCache.fleet.growth }
            : f,
          summary: s,
          matterLabelById:
            fleetDeskCache?.apiBase === apiBase ? fleetDeskCache.matterLabelById : {},
        };
        setHasLoaded(true);
        setLoading(false);
        if (!opts?.silent) {
          onRefreshSummary?.();
        }
        if (opts?.extras) {
          void fetchFleetDeskExtras(apiBase).then((extras) => {
            if (gen !== fleetLoadGeneration) {
              return;
            }
            const latest = readFleetDeskCache(apiBase);
            const nextLabels =
              Object.keys(extras.labels).length > 0
                ? extras.labels
                : (latest?.matterLabelById ?? {});
            if (Object.keys(nextLabels).length > 0) {
              setMatterLabelById(nextLabels);
            }
            const growth = extras.growth ?? undefined;
            if (growth) {
              setFleet((prev) => (prev ? { ...prev, growth } : prev));
            }
            if (gen !== fleetLoadGeneration || !latest) {
              return;
            }
            const current = readFleetDeskCache(apiBase) ?? latest;
            fleetDeskCache = {
              ...current,
              matterLabelById: nextLabels,
              fleet: growth ? { ...current.fleet, growth } : current.fleet,
            };
          });
        }
      } catch (e) {
        if (gen !== fleetLoadGeneration) {
          return;
        }
        setError(errorMessage(e, "无法加载在办事项"));
        setLoading(false);
        setHasLoaded(true);
      }
    },
    [apiBase, onRefreshSummary],
  );

  useEffect(() => {
    const hadCache = Boolean(readFleetDeskCache(apiBase));
    void refresh({ silent: hadCache, extras: true });
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refresh({ silent: true });
      }
    }, 5_000);
    return () => {
      window.clearInterval(id);
    };
  }, [apiBase, refresh]);

  const docketAll = useMemo(
    () =>
      buildFleetDocket({
        fleetRuns: fleet?.runs,
        pendingReviewDrafts: undefined,
        automationInbox: undefined,
        snoozed,
        includePendingReview: requireSignoffReview,
      }),
    [fleet?.runs, snoozed, requireSignoffReview],
  );

  const docketScoped = useMemo(
    () => filterDocketByMatter(docketAll, matterFilter),
    [docketAll, matterFilter],
  );

  const onlyNeedsYou = needsDecisionFocus || onlyMine;
  const docketVisible = useMemo(() => {
    if (!onlyNeedsYou) {
      return docketScoped;
    }
    return {
      needsYou: docketScoped.needsYou,
      inFlight: [],
      settled: [],
    };
  }, [docketScoped, onlyNeedsYou]);

  const docketRows = useMemo(
    () => [...docketAll.needsYou, ...docketAll.inFlight, ...docketAll.settled],
    [docketAll],
  );

  const visibleRows = useMemo(
    () => [...docketVisible.needsYou, ...docketVisible.inFlight, ...docketVisible.settled],
    [docketVisible],
  );

  const matterChoices = useMemo(() => {
    const ids = new Set<string>();
    for (const run of docketRows) {
      const mid = run.matterId?.trim();
      if (mid) {
        ids.add(mid);
      }
    }
    return [...ids].toSorted((a, b) => a.localeCompare(b, "zh"));
  }, [docketRows]);

  const bandOpen = useMemo(
    () =>
      initialDocketOpen({
        needsYou: docketScoped.needsYou.length,
        inFlight: docketScoped.inFlight.length,
        settled: docketScoped.settled.length,
      }),
    [docketScoped],
  );
  const listInFlightOpen = bandsReady ? inFlightOpen : bandOpen.inFlight;
  const listSettledOpen = bandsReady ? settledOpen : bandOpen.settled;
  const orderedListIds = useMemo(
    () =>
      fleetListOrderedIds(docketVisible, {
        inFlight: listInFlightOpen,
        settled: listSettledOpen,
      }),
    [docketVisible, listInFlightOpen, listSettledOpen],
  );
  const multi = useChatSessionMultiSelect(orderedListIds, selectedId ?? undefined);
  const scopedCount =
    docketScoped.needsYou.length + docketScoped.inFlight.length + docketScoped.settled.length;

  useEffect(() => {
    if (!hasLoaded || bandsReady || scopedCount === 0) {
      return;
    }
    setInFlightOpen(bandOpen.inFlight);
    setSettledOpen(bandOpen.settled);
    setBandsReady(true);
  }, [hasLoaded, bandsReady, scopedCount, bandOpen]);

  /** 深链到达时先放开案件筛选，避免在错误滤镜下匹配失败。 */
  useEffect(() => {
    if (!focusTarget) {
      return;
    }
    const mid = focusTarget.matterId?.trim();
    resetFiltersForDeepLink(mid && isValidMatterId(mid) ? mid : null);
  }, [focusTarget, resetFiltersForDeepLink]);

  useEffect(() => {
    if (!focusTarget || docketRows.length === 0) {
      return;
    }
    if (isMatterOnlyDeskTarget(focusTarget)) {
      const firstId = firstNeedsYouIdForMatter(
        docketAll.needsYou,
        focusTarget.matterId?.trim() ?? "",
      );
      if (firstId) {
        setSelectedId(firstId);
      }
      onFocusTargetConsumed?.();
      return;
    }
    const focused = matchNeedsDecisionFocusId(docketRows, focusTarget);
    if (!focused) {
      return;
    }
    const focusedRun = docketRows.find((r) => r.id === focused);
    if (focusedRun && !docketScoped.needsYou.some((r) => r.id === focused)) {
      setOnlyMine(false);
      onClearNeedsDecisionFocus?.();
      if (docketAll.inFlight.some((r) => r.id === focused)) {
        setInFlightOpen(true);
        setBandsReady(true);
      }
      if (docketAll.settled.some((r) => r.id === focused)) {
        setSettledOpen(true);
        setBandsReady(true);
      }
    }
    setSelectedId(focused);
    onFocusTargetConsumed?.();
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-fleet-run-id="${CSS.escape(focused)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      document.getElementById("lm-fleet-panel-actions")?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }, [docketRows, docketAll, docketScoped.needsYou, focusTarget, onFocusTargetConsumed, onClearNeedsDecisionFocus]);

  /** 有要律师处理的件时先打开它。正在办和今天办完不抢这个位置。 */
  useEffect(() => {
    if (focusTarget) {
      return;
    }
    if (selectedId && visibleRows.some((r) => r.id === selectedId)) {
      return;
    }
    const next = docketScoped.needsYou[0]?.id ?? null;
    if (next !== selectedId) {
      setSelectedId(next);
    }
  }, [focusTarget, visibleRows, docketScoped.needsYou, selectedId]);

  const current = visibleRows.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    const taskId = current?.taskId?.trim();
    if (!taskId) {
      return;
    }
    const persisted = readPersistedPostApproveExport(taskId);
    if (persisted) {
      setPostApproveExport(persisted);
    }
  }, [current?.taskId]);

  useEffect(() => {
    if (postApproveExport) {
      persistPostApproveExport(postApproveExport);
    }
  }, [postApproveExport]);

  useEffect(() => {
    setClarificationDraft({});
  }, [selectedId]);

  /** 待归案行：读一条来件的原文、附件与判案线索。切走时清空，避免串到下一条。 */
  useEffect(() => {
    const itemId =
      current?.intakeItemId?.trim() || current?.id.replace(/^intake:/, "").trim() || "";
    if (!apiBase || !itemId || !(current?.intakeItemId || current?.id.startsWith("intake:"))) {
      setIntakeItem(null);
      setIntakeLoading(false);
      setIntakeMatterId("");
      setIntakeRememberSender(false);
      setIntakeLeadTitle("");
      return undefined;
    }
    let cancelled = false;
    setIntakeLoading(true);
    setIntakeItem(null);
    setIntakeMatterId(current?.matterId?.trim() ?? "");
    setIntakeRememberSender(false);
    setIntakeLeadTitle("");
    void apiGetJson<{ ok?: boolean; item?: IntakeItem & { text: string } }>(
      apiBase,
      `/api/intake/items/${encodeURIComponent(itemId)}`,
    )
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const next = payload.item ?? null;
        setIntakeItem(next);
        const candidate = next?.resolution?.candidates?.[0]?.matterId?.trim();
        setIntakeMatterId(candidate || current?.matterId?.trim() || "");
      })
      .catch(() => {
        if (!cancelled) {
          setIntakeItem(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIntakeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, current?.id, current?.intakeItemId, current?.matterId]);

  useEffect(() => {
    const taskId =
      current?.kind === "pending_review" && current.status === "awaiting_review"
        ? current.taskId?.trim()
        : "";
    if (!apiBase || !taskId) {
      setDeskChecklistView(null);
      setDeskChecklistChecked({});
      setDeskChecklistLoading(false);
      setDeskAcceptanceReady(false);
      setDeskDraftReviewStatus(undefined);
      // 与后面的 cleanup 保持同形返回，避免 consistent-return。
      return undefined;
    }
    let cancelled = false;
    // 切换任务时先清空本地勾选，避免串到上一份草稿
    setDeskChecklistView(null);
    setDeskChecklistChecked({});
    setDeskChecklistLoading(true);
    void (async () => {
      try {
        const j = await apiGetJson<{ ok?: boolean; draft?: ArtifactDraft }>(
          apiBase,
          `/api/drafts/${encodeURIComponent(taskId)}`,
        );
        if (cancelled) {
          return;
        }
        const draft = j.draft;
        const view = buildChecklistView(
          draft?.deliverableType,
          draft?.verificationChecklist ?? null,
        );
        setDeskChecklistView(view);
        setDeskChecklistChecked({ ...view.state.checked });
        setDeskAcceptanceReady(draft ? validateDraftAgainstSpec(draft).ready : false);
        const rs = draft?.reviewStatus;
        setDeskDraftReviewStatus(
          rs === "pending" || rs === "approved" || rs === "rejected" || rs === "modified"
            ? rs
            : "pending",
        );
      } catch {
        if (!cancelled) {
          const view = buildChecklistView(undefined, null);
          setDeskChecklistView(view);
          setDeskChecklistChecked({ ...view.state.checked });
          setDeskAcceptanceReady(false);
          setDeskDraftReviewStatus("pending");
        }
      } finally {
        if (!cancelled) {
          setDeskChecklistLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, current?.status, current?.taskId]);

  useEffect(() => {
    if (current?.status !== "awaiting_clarification") {
      registerClarifyBringInHandlers(null);
      return undefined;
    }
    registerClarifyBringInHandlers({
      onAttachFile: (pin) => {
        const encoded = encodeClarificationFileAnswer(pin);
        setClarificationDraft((d) => ({
          ...d,
          [CLARIFY_ATTACHMENTS_KEY]: appendEncodedLine(d[CLARIFY_ATTACHMENTS_KEY], encoded),
        }));
      },
      onAttachSession: (ref) => {
        const encoded = encodeClarificationSessionRef(ref);
        setClarificationDraft((d) => ({
          ...d,
          [CLARIFY_SESSIONS_KEY]: appendEncodedLine(d[CLARIFY_SESSIONS_KEY], encoded),
        }));
      },
    });
    return () => registerClarifyBringInHandlers(null);
  }, [current?.status, current?.id]);

  useEffect(() => {
    const sid = current?.sessionId?.trim();
    if (!apiBase || !sid) {
      setRunActions([]);
      setInstructionLine("");
      return undefined;
    }
    let cancelled = false;
    setInstructionLine("");
    void loadFleetTranscript(apiBase, sid)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setRunActions(payload?.pendingRequiresAction ?? []);
        const userLine = [...(payload?.messages ?? [])]
          .toReversed()
          .find((message) => message.role === "user")?.content;
        setInstructionLine(userLine?.trim() ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setRunActions([]);
          setInstructionLine("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, current?.sessionId, fleet?.counts.awaitingAction]);

  const allActions = useMemo(
    () =>
      collectFleetActions({
        summary,
        currentSessionId: current?.sessionId,
        shellSessionId: sessionId,
        runActions,
        sessionRequiresActions,
      }),
    [summary, current?.sessionId, runActions, sessionRequiresActions, sessionId],
  );

  const advanceAfter = useCallback(
    (doneId?: string) => {
      const rest = docketVisible.needsYou.filter((r) => r.id !== doneId);
      setSelectedId(rest[0]?.id ?? null);
    },
    [docketVisible.needsYou],
  );

  const isWordCheck = current?.kind === "word_check";
  const isDraftReview = current?.kind === "pending_review" && current.status === "awaiting_review";
  /** 案件运行「等待超时」：两个明确动作，不复用工具签批的票据与底栏文案。 */
  const isMatterRunWait = current?.kind === "matter_run_wait";

  // 清单未加载时视为未完成（勿把 null view 当成 complete，否则一键勾选会被误禁用）
  const deskChecklistComplete = Boolean(
    deskChecklistView &&
      deskChecklistView.spec.items
        .filter((i) => i.required)
        .every((i) => deskChecklistChecked[i.id]),
  );

  // useMemo 化：仪式动作工厂不再每 render 重建（闭包引用最新输入，行为不变）。
  const {
    approveTool,
    approveToolEdit,
    rejectTool,
    respondClarify,
    resolveMatter,
    submitDraftReview,
    discardPendingDraft,
    runPostApproveExport,
    runPostApproveTrackedExport,
    saveAsAutomation,
  } = useMemo(
    () =>
      createFleetCeremonyActions({
        apiBase,
        sessionId,
        current,
        clarificationDraft,
        deskChecklistChecked,
        deskChecklistComplete,
        postApproveExport,
        setBusy,
        setError,
        setClarificationDraft,
        setArgsEditOpen,
        setArgsEditError,
        setPostApproveExport,
        refresh,
        advanceAfter,
        onChatResumeComplete,
        onOpenReview,
        onShowArtifact,
        expectedReviewStatus: deskDraftReviewStatus,
      }),
    [
      advanceAfter,
      apiBase,
      clarificationDraft,
      current,
      deskChecklistChecked,
      deskChecklistComplete,
      deskDraftReviewStatus,
      onChatResumeComplete,
      onOpenReview,
      onShowArtifact,
      postApproveExport,
      refresh,
      sessionId,
    ],
  );

  const clarifyAction =
    current?.status === "awaiting_clarification"
      ? (pickFleetActionForRun(allActions, current) ??
        allActions.find((a) => a.kind === "clarification") ??
        allActions[0] ??
        null)
      : null;

  const isIntake = current?.intakeItemId != null || current?.id.startsWith("intake:");
  const intakeItemId = current?.intakeItemId ?? current?.id.replace(/^intake:/, "");
  const isAutomationSend =
    current?.kind === "automation_send" || Boolean(current?.id.startsWith("automation-send:"));
  const isAutomationInbox = Boolean(current?.id.startsWith("automation-inbox:"));
  const isInterruptedRun = current?.status === "interrupted";
  // 待发出没有自己的工具票。不要回退到池里第一张案件审批，否则「驳回」会打到别的票上并 404。
  const approvalAction = isAutomationSend
    ? null
    : isMatterRunWait
      ? null
      : current?.status === "awaiting_approval" || isInterruptedRun
        ? (pickFleetActionForRun(allActions, current) ??
          allActions.find(
            (a) =>
              a.kind === "tool_approval" ||
              a.kind === "continue_tools" ||
              a.kind === "workflow_blocked",
          ) ??
          null)
        : null;
  const approvalDock = fleetApprovalDockLabels(approvalAction?.kind, approvalAction?.trigger);
  const pickedRuns = useMemo(() => {
    const byId = new Map(visibleRows.map((run) => [run.id, run]));
    return multi.selectedIds.flatMap((id) => {
      const run = byId.get(id);
      return run ? [run] : [];
    });
  }, [multi.selectedIds, visibleRows]);
  const batchSends = fleetBatchOutboundSends(pickedRuns);
  const batchMixed = pickedRuns.length > 1 && !batchSends;
  const singlePrimaryLabel = isIntake
    ? "归入案件"
    : isWordCheck
    ? "去核对"
    : isDraftReview
    ? "签批"
    : isMatterRunWait
    ? `再等 ${MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS} 天`
    : current?.status === "awaiting_clarification"
      ? "提交补充并继续"
      : isAutomationSend
        ? "签批发送"
        : isAutomationInbox
          ? current?.taskId
            ? "看修订"
            : "已知悉"
          : current?.status === "awaiting_approval" || isInterruptedRun
            ? approvalDock.primary
            : "打开";
  const primaryLabel = batchSends ? `签批发送 ${batchSends.length}` : singlePrimaryLabel;
  const rejectLabel = batchSends
    ? `驳回 ${batchSends.length}`
    : isMatterRunWait
      ? "不再等"
      : approvalDock.secondary;

  const clarifyComplete =
    current?.status !== "awaiting_clarification" ||
    !clarifyAction ||
    clarifyAction.kind !== "clarification" ||
    clarificationAnswersComplete(clarifyAction.clarificationQuestions ?? [], clarificationDraft);

  const primaryDisabled = isIntake
    ? busy || !intakeMatterId.trim()
    : batchSends
    ? busy
    : busy ||
      batchMixed ||
      (current?.status === "awaiting_clarification" && !clarifyComplete) ||
      (isDraftReview && (!deskChecklistComplete || deskChecklistLoading));

  const fileIntake = useCallback(
    async (action: "attach" | "ignore") => {
      if (!intakeItemId || !current || busy) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (action === "ignore") {
          await apiSendJson(
            apiBase,
            `/api/intake/items/${encodeURIComponent(intakeItemId)}/ignore`,
            "POST",
            {},
          );
        } else {
          const matter = intakeMatterId.trim();
          if (!matter) {
            setError("先选一个要归入的案件。");
            return;
          }
          await apiSendJson(apiBase, "/api/intake/items/attach", "POST", {
            itemId: intakeItemId,
            matterId: matter,
            rememberSender: intakeRememberSender && Boolean(intakeItem?.from?.address),
          });
        }
        await refresh();
        advanceAfter(current.id);
      } catch (e) {
        setError(errorMessage(e, action === "attach" ? "归入案件失败" : "忽略来件失败"));
      } finally {
        setBusy(false);
      }
    },
    [
      advanceAfter,
      apiBase,
      busy,
      current,
      intakeItem?.from?.address,
      intakeMatterId,
      intakeItemId,
      intakeRememberSender,
      refresh,
    ],
  );

  const ignoreIntake = useCallback(() => {
    void fileIntake("ignore");
  }, [fileIntake]);

  const attachIntake = useCallback(() => {
    void fileIntake("attach");
  }, [fileIntake]);

  /** 新案线索：推进阶段，或进入收案（只建 intake 案件）。 */
  const setIntakeLead = useCallback(
    async (action: LawmindIntakeLeadAction) => {
      if (!intakeItemId || busy) {
        return;
      }
      const matterTitle = intakeLeadTitle.trim();
      if (action === "accept" && !matterTitle) {
        setError("先填新案名称，再进入收案。");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await apiSendJson(apiBase, `/api/intake/items/${encodeURIComponent(intakeItemId)}/lead`, "POST", {
          action,
          ...(action === "accept" ? { matterTitle } : {}),
        });
        await refresh();
        if (action === "accept" || action === "declined") {
          // 这两步会让来件离开待归案队列。
          advanceAfter(current?.id);
        }
      } catch (e) {
        setError(errorMessage(e, "更新新案线索失败"));
      } finally {
        setBusy(false);
      }
    },
    [
      advanceAfter,
      apiBase,
      busy,
      current?.id,
      intakeItemId,
      intakeLeadTitle,
      refresh,
    ],
  );

  const approveAutomationSend = useCallback(async () => {
    const run = current;
    const inboxId = automationSendInboxId(run);
    if (!run || busy) {
      return;
    }
    if (!inboxId) {
      setError("这封待发信缺少编号，无法签批。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sent = await apiSendJson<
        { ok?: boolean; remote?: { ok?: boolean; hint?: string; error?: string } },
        { action: "approve_send" }
      >(apiBase, `/api/automations/inbox/${encodeURIComponent(inboxId)}/action`, "POST", {
        action: "approve_send",
      });
      onRefreshSummary?.();
      await refresh();
      advanceAfter(run.id);
      if (sent.remote && sent.remote.ok === false) {
        const hint = sent.remote.hint?.trim() || sent.remote.error?.trim();
        setError(hint ? `已批准，但没有从邮箱发出：${hint}` : "已批准，但没有从邮箱发出。");
      }
    } catch (e) {
      setError(errorMessage(e, "签批发送失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, advanceAfter, busy, current, onRefreshSummary, refresh]);

  const dismissAutomationSend = useCallback(async () => {
    const run = current;
    const inboxId = automationSendInboxId(run);
    if (!run || busy) {
      return;
    }
    if (!inboxId) {
      setError("这封待发信缺少编号，无法驳回。");
      return;
    }
    if (
      !(await confirmDialog({
        title: "驳回这封待发信？",
        body: "不会发出。这件会从在办里拿掉。",
        confirmLabel: "驳回",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSendJson(
        apiBase,
        `/api/automations/inbox/${encodeURIComponent(inboxId)}/action`,
        "POST",
        { action: "dismiss" },
      );
      onRefreshSummary?.();
      await refresh();
      advanceAfter(run.id);
    } catch (e) {
      setError(errorMessage(e, "驳回失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, advanceAfter, busy, current, onRefreshSummary, refresh]);

  const postOutboundBatch = useCallback(
    async (runs: AgentRunSummary[], action: "dismiss" | "approve_send") => {
      if (busy) {
        return;
      }
      const { ids: inboxIds, missing } = collectOutboundInboxIds(runs);
      if (inboxIds.length === 0) {
        setError(
          action === "dismiss"
            ? "这些待发信缺少编号，无法驳回。"
            : "这些待发信缺少编号，无法签批。",
        );
        return;
      }
      setBusy(true);
      setError(null);
      const failures: string[] = Array.from({ length: missing }, () => "缺少编号");
      try {
        for (const inboxId of inboxIds) {
          try {
            const sent = await apiSendJson<
              { ok?: boolean; remote?: { ok?: boolean; hint?: string; error?: string } },
              { action: "dismiss" | "approve_send" }
            >(apiBase, `/api/automations/inbox/${encodeURIComponent(inboxId)}/action`, "POST", {
              action,
            });
            if (action === "approve_send" && sent.remote && sent.remote.ok === false) {
              failures.push(
                sent.remote.hint?.trim() || sent.remote.error?.trim() || "没有从邮箱发出",
              );
            }
          } catch (e) {
            failures.push(errorMessage(e, action === "dismiss" ? "驳回失败" : "签批发送失败"));
          }
        }
        onRefreshSummary?.();
        await refresh();
        if (failures.length > 0) {
          const verb = action === "dismiss" ? "驳回" : "签批发送";
          setError(`${verb}有 ${failures.length} 件没完成。${failures[0]}`);
        }
      } finally {
        setBusy(false);
      }
    },
    [apiBase, busy, onRefreshSummary, refresh],
  );

  const rejectPickedSends = useCallback(async () => {
    if (!batchSends || busy) {
      return;
    }
    if (
      !(await confirmDialog({
        title: `驳回这 ${batchSends.length} 件待发信？`,
        body: "不会发出，并从在办里拿掉。",
        confirmLabel: "驳回",
        tone: "danger",
      }))
    ) {
      return;
    }
    await postOutboundBatch(batchSends, "dismiss");
  }, [batchSends, busy, postOutboundBatch]);

  const approvePickedSends = useCallback(async () => {
    if (!batchSends || busy) {
      return;
    }
    if (
      !(await confirmDialog({
        title: `签批发送这 ${batchSends.length} 件？`,
        body: "会按每件写好的收件人和附件发出。",
        confirmLabel: "签批发送",
      }))
    ) {
      return;
    }
    await postOutboundBatch(batchSends, "approve_send");
  }, [batchSends, busy, postOutboundBatch]);

  const acknowledgeAutomationInbox = useCallback(async () => {    const run = current;
    const inboxId = run?.queueItemId?.trim();
    if (!run || !inboxId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSendJson(
        apiBase,
        `/api/automations/inbox/${encodeURIComponent(inboxId)}/action`,
        "POST",
        { action: "acknowledge" },
      );
      onRefreshSummary?.();
      await refresh();
      advanceAfter(run.id);
    } catch (e) {
      setError(errorMessage(e, "标记已知悉失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, advanceAfter, busy, current, onRefreshSummary, refresh]);

  /**
   * 等待超时的两种处理。只动这一步：续等清掉升级标记并推后到期，
   * 跳过让 run 回到可继续状态，后续步骤仍由 tick 推进。
   */
  const postMatterWait = useCallback(
    async (action: "extend" | "skip") => {
      const run = current;
      const wait = run?.matterRunWait;
      const matterId = run?.matterId?.trim();
      if (!run || !wait || !matterId || busy) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await apiSendJson(
          apiBase,
          `/api/matter-runs/${encodeURIComponent(matterId)}/${encodeURIComponent(
            wait.runId,
          )}/steps/${encodeURIComponent(wait.stepId)}/wait`,
          "POST",
          {
            action,
            ...(action === "extend" ? { days: MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS } : {}),
          },
        );
        onRefreshSummary?.();
        await refresh();
        advanceAfter(run.id);
      } catch (e) {
        setError(errorMessage(e, action === "extend" ? "没能把等待往后延" : "没能结束这一步"));
      } finally {
        setBusy(false);
      }
    },
    [advanceAfter, apiBase, busy, current, onRefreshSummary, refresh],
  );

  const skipMatterWait = useCallback(async () => {
    if (busy) {
      return;
    }
    if (
      !(await confirmDialog({
        title: "不再等这一步？",
        body: "会跳过这一步，案件运行按后续步骤继续。等待记录仍留在运行时间线里。",
        confirmLabel: "不再等",
        tone: "danger",
      }))
    ) {
      return;
    }
    await postMatterWait("skip");
  }, [busy, postMatterWait]);

  const runPrimary = () => {
    if (!current || busy) {
      return;
    }
    if (isIntake) {
      attachIntake();
      return;
    }
    if (isMatterRunWait) {
      void postMatterWait("extend");
      return;
    }
    if (batchSends) {
      void approvePickedSends();
      return;
    }
    if (isWordCheck) {
      const taskId = current.taskId?.trim();
      if (!taskId) {
        setError("缺少任务编号，无法打开修订窗。");
        return;
      }
      void openContractRevisionForTask({ apiBase, taskId, workspaceDir }).then((result) => {
        if (!result.ok) {
          setError(result.error);
        }
      });
      return;
    }
    if (isAutomationSend) {
      void approveAutomationSend();
      return;
    }
    if (isAutomationInbox) {
      if (current.taskId && onOpenReview) {
        onOpenReview(current.taskId, current.matterId);
        return;
      }
      void acknowledgeAutomationInbox();
      return;
    }
    if (isDraftReview) {
      void submitDraftReview("approved");
      return;
    }
    if (current.status === "awaiting_clarification" && clarifyAction?.kind === "clarification") {
      void respondClarify(clarifyAction);
      return;
    }
    if (current.status === "awaiting_approval" || current.status === "interrupted") {
      // 只批这一行绑上的票，或本会话里的工具票。不要回退到别的案件审批。
      const bound = pickFleetActionForRun(allActions, current);
      const target =
        bound ??
        allActions.find(
          (a) =>
            a.kind === "tool_approval" ||
            a.kind === "continue_tools" ||
            a.kind === "workflow_blocked",
        );
      if (target?.kind === "matter_approval") {
        void resolveMatter(target, "approved");
        return;
      }
      if (target) {
        void approveTool(target);
        return;
      }
    }
    if (current.sessionId) {
      onOpenChatSession(current.sessionId, current.matterId, current.assistantId);
    }
  };

  const showForm =
    current != null &&
    !isIntake &&
    !isAutomationSend &&
    !isAutomationInbox &&
    !isMatterRunWait &&
    (current.status === "awaiting_approval" ||
      current.status === "awaiting_clarification" ||
      current.status === "interrupted") &&
    allActions.length > 0;

  const approvalDoc = approvalAction?.toolArgs
    ? extractApprovalDocumentPreview(approvalAction.toolArgs)
    : null;
  const readingMode = Boolean(approvalDoc && current?.status === "awaiting_approval");
  const approvalIsDocWrite = Boolean(
    approvalAction?.toolArgs && toolArgsAreDocumentWrite(approvalAction.toolArgs),
  );
  const approvalHasLawyerShortEdits = Boolean(
    approvalAction?.toolArgs && toolArgsHaveLawyerEditableShortFields(approvalAction.toolArgs),
  );
  const approvalHasEditableBody = Boolean(
    approvalAction?.kind === "tool_approval" &&
      approvalAction.toolArgs &&
      !approvalIsDocWrite &&
      (typeof approvalAction.toolArgs.body === "string" ||
        typeof approvalAction.toolArgs.content === "string"),
  );
  const showArgsEdit =
    approvalAction?.kind === "tool_approval" &&
    (approvalIsDocWrite ? approvalHasLawyerShortEdits : approvalHasLawyerShortEdits || approvalHasEditableBody);
  const approvalLinkedTaskId =
    (approvalAction?.toolArgs ? toolArgsLinkedTaskId(approvalAction.toolArgs) : null) ??
    current?.taskId ??
    null;

  const displayTitle = current
    ? readingMode && approvalDoc
      ? approvalDoc.title
      : docketRowTitle(current, sanitizeLawyerFacingText(current.title, current.toolName))
    : "";

  const pendingTeachCount = useMemo(
    () =>
      (fleet?.growth?.assistants ?? []).reduce((n, a) => n + (a.pendingAdoptions ?? 0), 0),
    [fleet?.growth],
  );

  /** 归案时可选的在办案件：目录里出现过的 + 概览里带名字的。 */
  const intakeMatterChoices = useMemo(() => {
    const ids = new Set<string>(matterChoices);
    for (const id of Object.keys(matterLabelById)) {
      ids.add(id);
    }
    return [...ids].filter(Boolean).toSorted((a, b) => a.localeCompare(b, "zh"));
  }, [matterChoices, matterLabelById]);

  const intakeDetailNode = isIntake ? (
    <LawmindIntakeDetail
      item={intakeItem}
      loading={intakeLoading}
      matterId={intakeMatterId}
      onMatterIdChange={setIntakeMatterId}
      matterChoices={intakeMatterChoices}
      matterLabelById={matterLabelById}
      rememberSender={intakeRememberSender}
      onRememberSenderChange={setIntakeRememberSender}
      leadTitle={intakeLeadTitle}
      onLeadTitleChange={setIntakeLeadTitle}
      onLeadAction={(action) => void setIntakeLead(action)}
      truncated={(intakeItem?.text.length ?? 0) >= 2000}
    />
  ) : null;

  const matterWaitDetailNode = isMatterRunWait ? (
    <LawmindMatterRunWaitDetail
      wait={current?.matterRunWait ?? null}
      title={current?.title ?? ""}
      busy={busy}
      extendDays={MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS}
      onExtend={() => void postMatterWait("extend")}
      onSkip={() => void skipMatterWait()}
    />
  ) : null;

  const showDocket = hasLoaded && scopedCount > 0;  const brief = current
    ? {
        // 来件不是律师交办的话，不冒充「你交办的」；原文与线索在详情面板里。
        instruction: isIntake ? "" : docketInstruction(current, instructionLine),
        stopLine: docketStopLine(current),
      }
    : null;

  return (
    <div
      className="lm-agents-wb"
      data-testid="lm-agent-fleet-panel"
      data-needs-decision={needsDecisionFocus ? "true" : undefined}
      aria-busy={loading || busy || undefined}
    >
      {error ? (
        <div className="lm-callout lm-callout-danger lm-agents-wb-error" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      <LawmindDaemonRecap apiBase={apiBase} />

      {loading && !hasLoaded ? (
        <p className="lm-meta lm-agents-wb-loading">加载中…</p>
      ) : null}

      {hasLoaded && docketRows.length === 0 ? (
        <LawmindAgentFleetEmpty
          kind="decision"
          onOpenChat={() => onOpenChatSession(sessionId?.trim() || "")}
          onOpenReview={() => onOpenReview?.()}
        />
      ) : null}

      {hasLoaded && docketRows.length > 0 && scopedCount === 0 ? (
        <LawmindAgentFleetEmpty
          kind="filter"
          onClearMatterFilter={() => setMatterFilter("all")}
        />
      ) : null}

      {showDocket ? (
        <div className="lm-agents-wb-split">
          <LawmindAgentFleetListAside
            docket={docketVisible}
            hiddenInFlight={onlyNeedsYou ? docketScoped.inFlight.length : 0}
            hiddenSettled={onlyNeedsYou ? docketScoped.settled.length : 0}
            matterChoices={matterChoices}
            matterLabelById={matterLabelById}
            matterFilter={matterFilter}
            onMatterFilter={setMatterFilter}
            onlyNeedsYou={onlyNeedsYou}
            onOnlyNeedsYou={(next) => {
              setOnlyMine(next);
              if (!next) {
                onClearNeedsDecisionFocus?.();
              }
            }}
            selectedId={current?.id ?? null}
            pickedIds={multi.selectedSet}
            onSelectRun={setSelectedId}
            onPointerSelect={(event, id) => {
              const next = multi.applyPointer(event, id);
              if (next.open) {
                setSelectedId(id);
              }
            }}
            onListKeyAction={(action) => {
              if (action === "select-all") {
                multi.selectAll();
                return;
              }
              if (action === "collapse") {
                multi.collapseTo(selectedId ?? undefined);
                return;
              }
              if (batchSends) {
                void rejectPickedSends();
              }
            }}
            batch={
              pickedRuns.length > 1
                ? {
                    count: pickedRuns.length,
                    canSend: Boolean(batchSends),
                    busy,
                    onReject: () => void rejectPickedSends(),
                    onApprove: () => void approvePickedSends(),
                    onSnooze: () => snoozeMany(pickedRuns.map((run) => run.id)),
                  }
                : null
            }
            inFlightOpen={bandsReady ? inFlightOpen : bandOpen.inFlight}
            settledOpen={bandsReady ? settledOpen : bandOpen.settled}
            onToggleBand={(band) => {
              setBandsReady(true);
              if (band === "inFlight") {
                setInFlightOpen(!(bandsReady ? inFlightOpen : bandOpen.inFlight));
                return;
              }
              setSettledOpen(!(bandsReady ? settledOpen : bandOpen.settled));
            }}
            pendingTeachCount={pendingTeachCount}
            onOpenMemoryInspector={onOpenMemoryInspector}
            onShowAll={() => {
              setOnlyMine(false);
              onClearNeedsDecisionFocus?.();
            }}
            onReturnToMatter={
              matterFilter !== "all" && onOpenMatterOnDesk
                ? () => onOpenMatterOnDesk(matterFilter)
                : undefined
            }
            returnMatterLabel={
              matterFilter !== "all" ? matterLabelById[matterFilter]?.trim() || matterFilter : undefined
            }
          />
          <LawmindAgentFleetDetail
            apiBase={apiBase}
            current={current}
            overview={{
              needsYou: docketScoped.needsYou.length,
              inFlight: docketScoped.inFlight.length,
              settled: docketScoped.settled.length,
            }}
            brief={brief}
            displayTitle={displayTitle}
            matterLabelById={matterLabelById}
            assistantDisplayById={assistantDisplayById}
            intakeDetail={intakeDetailNode}
            matterWaitDetail={matterWaitDetailNode}
            readingMode={readingMode}
            approvalDoc={approvalDoc}
            isDraftReview={isDraftReview}
            showForm={showForm}
            allActions={allActions}
            sessionId={sessionId}
            clarificationDraft={clarificationDraft}
            onClarificationDraftChange={(key, value) =>
              setClarificationDraft((d) => ({ ...d, [key]: value }))
            }
            deskChecklistView={deskChecklistView}
            deskChecklistChecked={deskChecklistChecked}
            deskChecklistLoading={deskChecklistLoading}
            deskChecklistComplete={deskChecklistComplete}
            deskAcceptanceReady={deskAcceptanceReady}
            onDeskChecklistCheckedChange={setDeskChecklistChecked}
            onClearError={() => setError(null)}
            busy={busy}
            primaryLabel={primaryLabel}
            isOutboundSend={isAutomationSend}
            batchOutbound={Boolean(batchSends)}
            rejectLabel={rejectLabel}
            rejectDisabled={batchMixed}
            primaryTitle={
              batchMixed ? "所选不都是待发信。点一行只看这一件，或用「稍后」一起放下。" : undefined
            }
            primaryDisabled={primaryDisabled}
            clarifyComplete={clarifyComplete}
            onPrimary={runPrimary}
            onDraftReview={(status) => void submitDraftReview(status)}
            onDiscardPendingDraft={() => void discardPendingDraft()}
            onRejectApproval={() => {
              if (isIntake) {
                ignoreIntake();
                return;
              }
              if (isMatterRunWait) {
                void skipMatterWait();
                return;
              }
              if (batchSends) {
                void rejectPickedSends();
                return;
              }
              if (isAutomationSend) {
                void dismissAutomationSend();
                return;
              }
              if (!approvalAction) {
                return;
              }
              if (approvalAction.kind === "matter_approval") {
                void resolveMatter(approvalAction, "rejected");
                return;
              }
              void rejectTool(approvalAction);
            }}
            onSnooze={() => {
              if (pickedRuns.length > 1) {
                snoozeMany(pickedRuns.map((run) => run.id));
                return;
              }
              if (!current) {
                return;
              }
              snoozeRun(current.id);
            }}
            approvalAction={approvalAction}
            approvalIsDocWrite={approvalIsDocWrite}
            approvalLinkedTaskId={approvalLinkedTaskId}
            showArgsEdit={showArgsEdit}
            argsEditOpen={argsEditOpen}
            argsEditError={argsEditError}
            onArgsEditOpenChange={setArgsEditOpen}
            onArgsEditErrorChange={setArgsEditError}
            onApproveTool={(a) => void approveTool(a)}
            onApproveToolEdit={(a, edited) => void approveToolEdit(a, edited)}
            onRejectTool={(a) => void rejectTool(a)}
            onRespondClarification={(a) => void respondClarify(a)}
            onResolveMatterApproval={(a, status) => void resolveMatter(a, status)}
            onOpenChatSession={onOpenChatSession}
            onOpenReview={onOpenReview}
            postApproveExport={postApproveExport}
            workspaceDir={workspaceDir}
            projectDir={projectDir}
            onPostApproveExport={() => void runPostApproveExport()}
            onPostApproveTrackedExport={() => {
              void (async () => {
                setTrackedExportBusy(true);
                try {
                  const r = await runPostApproveTrackedExport();
                  if (!r.ok && r.message) {
                    setError(r.message);
                  }
                } finally {
                  setTrackedExportBusy(false);
                }
              })();
            }}
            trackedExportBusy={trackedExportBusy}
            onPostApproveDismiss={() => {
              if (postApproveExport?.taskId) {
                clearPersistedPostApproveExport(postApproveExport.taskId);
              }
              setPostApproveExport(null);
            }}
            onShowArtifact={onShowArtifact}
            onOpenError={(message) => setError(message)}
            onOpenHealth={onOpenHealth}
            onSaveAsAutomation={
              postApproveExport?.matterId?.trim() || current?.matterId?.trim()
                ? () => {
                    void (async () => {
                      setSaveAutomationBusy(true);
                      setSaveAutomationHint(null);
                      try {
                        const r = await saveAsAutomation();
                        setSaveAutomationHint(r.message);
                        if (!r.ok) {
                          setError(r.message);
                        }
                      } finally {
                        setSaveAutomationBusy(false);
                      }
                    })();
                  }
                : undefined
            }
            saveAsAutomationBusy={saveAutomationBusy}
            saveAsAutomationHint={saveAutomationHint}
          />
        </div>
      ) : null}
    </div>
  );
}
