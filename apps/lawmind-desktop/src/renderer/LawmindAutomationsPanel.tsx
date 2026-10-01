import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { useLawmindAutomationsNavContext } from "./app/LawmindShellContexts";
import { loadMatterOverviewsPayload } from "./lawmind-app-data";
import { LawmindMailAccountsSection } from "./LawmindMailAccountsSection";
import { LawmindOutboundSignoffCallout } from "./LawmindOutboundSignoffCallout";
import { formatAutomationLastResultForLawyer } from "./lawmind-automation-last-result";
import { formatRelativeTime } from "./lawmind-app-utils";
import { confirmDialog } from "./lawmind-confirm-dialog";
import { draftAutomationConfirmations } from "../../../../src/lawmind/platform/infer-automation-from-instruction.ts";
import { formatAutomationFrequencyCostHint } from "../../../../src/lawmind/platform/automation-frequency-hint.ts";
import { isOutboundAutomationContext } from "../../../../src/lawmind/platform/lawyer-outbound-decision.ts";

type Schedule =
  | { kind: "daily"; hour: number; minute: number; tz?: string }
  | { kind: "weekly"; weekday: number; hour: number; minute: number; tz?: string }
  | { kind: "once"; runAt: string }
  | { kind: "interval"; everyMinutes: number };

type ScheduleMode = "weekly" | "daily" | "interval";

const INTERVAL_PRESETS = [
  { minutes: 15, label: "每 15 分钟" },
  { minutes: 30, label: "每 30 分钟" },
  { minutes: 60, label: "每 1 小时" },
  { minutes: 120, label: "每 2 小时" },
  { minutes: 360, label: "每 6 小时" },
  { minutes: 720, label: "每 12 小时" },
  { minutes: 1440, label: "每 24 小时" },
] as const;

/** 律师只看这一句。接口里的长说明留在服务端，不铺到设置页。 */
const PRESET_HINT: Record<string, string> = {
  "renewal-monitor": "到期前提醒你。不发函，也不改合同。",
  "client-weekly-update": "起草给客户的进展。你批准后才发。",
  "mail-inbox-digest": "整理新来信，不代回。先在下面接上邮箱。",
  "mail-contract-review": "对来信里的合同做最小改稿。先在下面接上邮箱。",
};

function scheduleChoiceValue(mode: ScheduleMode, everyMinutes: number): string {
  return mode === "interval" ? `m${everyMinutes}` : mode;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type Preset = {
  id: string;
  title: string;
  description: string;
  needsMail: boolean;
  defaultSchedule: Schedule;
  defaultAllowSend: boolean;
  templateId?: string;
};

type Automation = {
  id: string;
  title: string;
  enabled: boolean;
  presetId: string;
  matterId: string;
  instruction?: string;
  schedule: Schedule;
  nextRunAt: string;
  lastRunAt?: string;
  lastResultSummary?: string;
  allowSendEmailAfterApproval: boolean;
  notifyEmail?: string;
  // 六确认里需要持久化的四项（另有标题与计划，各有既有字段）。
  expectedResult?: string;
  approvalBoundary?: string;
  missingDataPolicy?: MissingDataPolicy;
  notifyPolicy?: NotifyPolicy;
};

type MissingDataPolicy = "report_failure" | "report_partial" | "skip_run";
type NotifyPolicy = "always" | "on_problem" | "never";

/** 缺数据策略的律师侧措辞。模板默认是「先交能做到的部分」。 */
const MISSING_DATA_OPTIONS: Array<{ value: MissingDataPolicy; label: string }> = [
  { value: "report_failure", label: "如实报失败，不拿旧数据顶上" },
  { value: "report_partial", label: "先交能做到的部分，并列出缺什么" },
  { value: "skip_run", label: "这次跳过，不办" },
];

const NOTIFY_OPTIONS: Array<{ value: NotifyPolicy; label: string }> = [
  { value: "on_problem", label: "只在出问题时通知我" },
  { value: "always", label: "每次运行都通知我" },
  { value: "never", label: "成功了不用告诉我" },
];

type AutomationRun = {
  runId: string;
  trigger: "schedule" | "manual" | "test";
  status: "ok" | "failed" | "skipped" | "blocked";
  startedAt: string;
  finishedAt: string;
  summary?: string;
  errorCode?: string;
  errorMessage?: string;
  missingData?: string[];
  notified?: boolean;
};

/** 运行结果的律师侧措辞。`blocked` 与 `failed` 都是要人管的，别混成一个词。 */
const RUN_STATUS_LABEL: Record<AutomationRun["status"], string> = {
  ok: "办完了",
  failed: "没办成",
  skipped: "按你说的跳过了",
  blocked: "停下来等你拍板",
};

type AutomationRunStats = {
  total: number;
  okCount: number;
  failedCount: number;
  skippedCount: number;
  blockedCount: number;
  missingDataCount: number;
  lastRunAt?: string;
  lastOkAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
};

type PromotionVerdict = { ready: boolean; message: string; reasons: string[] };

/** 「这个常设工作靠不靠得住」——由服务端算，渲染层不自己推。 */
type RunsPayload = {
  runs: AutomationRun[];
  stats: AutomationRunStats;
  promotion: PromotionVerdict;
};

type Props = {
  apiBase: string;
  matterId?: string | null;
  matterOptions?: Array<{ id: string; title: string }>;
  onOpenNeedsDecisionDesk?: (
    target?: import("./lawmind-agents-desk").NeedsDecisionDeskTarget,
  ) => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenActionHub?: () => void;
  /** Settings page already shows section title — hide duplicate chrome. */
  hideTitleChrome?: boolean;
  /** 新建时记在这位助手名下。不传则仍只挂在案件上。 */
  assistantId?: string;
};

function scheduleLabel(s: Schedule): string {
  if (s.kind === "interval") {
    const m = s.everyMinutes;
    if (m % 1440 === 0) {
      return `每 ${m / 1440} 天`;
    }
    if (m % 60 === 0) {
      return `每 ${m / 60} 小时`;
    }
    return `每 ${m} 分钟`;
  }
  if (s.kind === "daily") {
    return `每天 ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  }
  if (s.kind === "weekly") {
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    return `每周${days[s.weekday] ?? "?"} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  }
  return `单次 ${s.runAt.slice(0, 16).replace("T", " ")}`;
}

function localTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    return tz || undefined;
  } catch {
    return undefined;
  }
}

function buildCreateSchedule(
  mode: ScheduleMode,
  hour: number,
  minute: number,
  everyMinutes: number,
): Schedule {
  if (mode === "interval") {
    return { kind: "interval", everyMinutes: Math.max(5, Math.floor(everyMinutes) || 30) };
  }
  const tz = localTimeZone();
  if (mode === "weekly") {
    return tz
      ? { kind: "weekly", weekday: 1, hour, minute, tz }
      : { kind: "weekly", weekday: 1, hour, minute };
  }
  return tz ? { kind: "daily", hour, minute, tz } : { kind: "daily", hour, minute };
}

function looksLikeEmail(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(t) && !t.endsWith("@example.com");
}

/**
 * 一条常设工作的运行记录 + 它的「靠不靠得住」结论。
 *
 * 为什么值得占屏幕：律师只看到「上次成功」时，没法判断这个常设工作是不是
 * 每隔几次就缺数据、是不是反复要人拍板。而这些正是决定要不要继续让它跑的依据。
 * 统计与结论由服务端算好（`/api/automations/:id/runs`），这里只负责显示。
 */
function LawmindAutomationRuns({
  automation,
  payload,
  loading,
}: {
  automation: Automation;
  payload?: RunsPayload;
  loading: boolean;
}): ReactNode {
  if (!payload) {
    return (
      <p className="lm-meta" role="status" aria-busy={loading}>
        {loading ? "正在读运行记录…" : "运行记录暂时读不到。"}
      </p>
    );
  }
  const { runs, stats, promotion } = payload;
  const parts: string[] = [];
  if (stats.okCount) {
    parts.push(`办成 ${stats.okCount}`);
  }
  if (stats.failedCount) {
    parts.push(`没办成 ${stats.failedCount}`);
  }
  if (stats.blockedCount) {
    parts.push(`等你拍板 ${stats.blockedCount}`);
  }
  if (stats.skippedCount) {
    parts.push(`按策略跳过 ${stats.skippedCount}`);
  }
  return (
    <div className="lm-automations-runs" data-testid="lm-auto-runs">
      <div className="lm-automations-runs-summary">
        <span className="lm-meta">
          {stats.total > 0
            ? `最近 ${stats.total} 次：${parts.join(" · ")}`
            : "还没有运行记录"}
        </span>
      </div>
      {stats.total === 0 ? (
        <p className="lm-meta">第一次到期跑完之后，这里会出现每一次的记录。</p>
      ) : (
        <ul className="lm-automations-runs-ul lm-scroll">
          {runs.slice(0, 8).map((r) => (
            <li key={r.runId} className="lm-meta">
              {formatRelativeTime(r.finishedAt || r.startedAt)} · {RUN_STATUS_LABEL[r.status]}
              {r.summary ? ` · ${r.summary}` : ""}
              {r.errorMessage ? ` · ${r.errorMessage}` : ""}
              {r.missingData && r.missingData.length > 0
                ? ` · 缺资料：${r.missingData.join("、")}`
                : ""}
            </li>
          ))}
        </ul>
      )}
      {promotion.message ? (
        <p className={`lm-meta${promotion.ready ? " lm-automations-promotion-ready" : ""}`}>
          {promotion.message}
        </p>
      ) : null}
      <p className="lm-meta lm-automations-runs-terms">
        当初交代的：办完是「{automation.expectedResult?.trim() || "未交代"}」；必须先问你的：
        {automation.approvalBoundary?.trim() || "未交代"}。
      </p>
    </div>
  );
}

export function LawmindAutomationsPanel(props: Props): ReactNode {
  const {
    apiBase,
    matterId,
    matterOptions: matterOptionsProp = [],
    hideTitleChrome = false,
    assistantId,
  } = props;
  const { selectedAutomationId, setSelectedAutomationId } = useLawmindAutomationsNavContext();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loadedMatters, setLoadedMatters] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<string>("renewal-monitor");
  const [selectedMatter, setSelectedMatter] = useState(matterId?.trim() || "");
  const [customText, setCustomText] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("weekly");
  const [everyMinutes, setEveryMinutes] = useState(30);
  // 模板自带可改的规矩，选中即填上。律师可以改字；清空两项仍不能创建。
  const openingDraft = draftAutomationConfirmations("renewal-monitor");
  const [expectedResult, setExpectedResult] = useState(openingDraft.expectedResult);
  const [approvalBoundary, setApprovalBoundary] = useState(openingDraft.approvalBoundary);
  const [eventSource, setEventSource] = useState<"" | "matter_files" | "mail" | "webhook">("");
  const [eventMatch, setEventMatch] = useState("");
  const [missingDataPolicy, setMissingDataPolicy] = useState<MissingDataPolicy>(
    openingDraft.missingDataPolicy,
  );
  const [notifyPolicy, setNotifyPolicy] = useState<NotifyPolicy>(openingDraft.notifyPolicy);
  /** 运行历史按需拉取：点开某条才查，不在列表加载时对每条都发一次请求。 */
  const [runsById, setRunsById] = useState<Record<string, RunsPayload>>({});
  const [runsLoadingId, setRunsLoadingId] = useState<string | null>(null);

  const matterOptions = useMemo(() => {
    const byId = new Map<string, { id: string; title: string }>();
    for (const m of [...matterOptionsProp, ...loadedMatters]) {
      const id = m.id.trim();
      if (!id) {
        continue;
      }
      byId.set(id, { id, title: m.title.trim() || id });
    }
    return [...byId.values()].toSorted((a, b) => a.title.localeCompare(b.title, "zh"));
  }, [loadedMatters, matterOptionsProp]);

  const selectedPresetMeta = presets.find((p) => p.id === selectedPreset);
  const needsNotifyEmail =
    selectedPreset === "client-weekly-update" ||
    (selectedPresetMeta?.defaultAllowSend ?? false);
  const outboundCreate = isOutboundAutomationContext({
    presetId: selectedPreset,
    defaultAllowSend: selectedPresetMeta?.defaultAllowSend,
    notifyEmail,
    instruction: customText,
  });

  useEffect(() => {
    if (matterId?.trim()) {
      setSelectedMatter(matterId.trim());
    }
  }, [matterId]);

  useEffect(() => {
    if (selectedMatter.trim() || matterOptions.length === 0) {
      return;
    }
    setSelectedMatter(matterOptions[0].id);
  }, [matterOptions, selectedMatter]);

  const refresh = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!apiBase) {
        return;
      }
      if (!opts?.quiet) {
        setLoading(true);
      }
      try {
        const [p, list, overviews] = await Promise.all([
          apiGetJson<{ presets: Preset[] }>(apiBase, "/api/automations/presets"),
          apiGetJson<{ automations: Automation[] }>(apiBase, "/api/automations"),
          loadMatterOverviewsPayload(apiBase).catch(() => []),
        ]);
        setPresets(p.presets ?? []);
        setAutomations(list.automations ?? []);
        setLoadedMatters(
          overviews.map((o) => ({
            id: o.matterId,
            title: o.displayName?.trim() || o.matterId,
          })),
        );
        setError(null);
      } catch (e) {
        setError(errorMessage(e, "无法加载自动办件"));
      } finally {
        setLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * 拉某条常设工作的运行历史。
   *
   * 只在律师点开它时才拉——列表加载时对每条都发一次请求会拖慢面板，
   * 而「这个常设工作靠不靠得住」本来就是他主动想看的。
   */
  const loadRuns = useCallback(
    async (automationId: string) => {
      if (!apiBase || !automationId.trim()) {
        return;
      }
      setRunsLoadingId(automationId);
      try {
        const payload = await apiGetJson<RunsPayload>(
          apiBase,
          `/api/automations/${encodeURIComponent(automationId)}/runs`,
        );
        setRunsById((prev) => ({
          ...prev,
          [automationId]: {
            runs: payload.runs ?? [],
            stats: payload.stats ?? {
              total: 0,
              okCount: 0,
              failedCount: 0,
              skippedCount: 0,
              blockedCount: 0,
              missingDataCount: 0,
            },
            promotion: payload.promotion ?? { ready: false, message: "", reasons: [] },
          },
        }));
      } catch (e) {
        // 历史读不到不该让整个面板报错——它只是附加信息。
        setError(errorMessage(e, "读不到这条自动办件的运行记录"));
      } finally {
        setRunsLoadingId((current) => (current === automationId ? null : current));
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (!selectedAutomationId) {
      return;
    }
    void loadRuns(selectedAutomationId);
  }, [selectedAutomationId, loadRuns]);

  // 页面可见时静默轮询（对齐在办 5s）：「立即运行」后刷新任务上次结果；隐藏时停止。
  useEffect(() => {
    if (!apiBase) {
      // 显式 undefined：与下面的 cleanup 保持一致的返回形状（oxlint consistent-return）。
      return undefined;
    }
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refresh({ quiet: true });
    };
    const t = window.setInterval(tick, 5000);
    return () => window.clearInterval(t);
  }, [apiBase, refresh]);

  useEffect(() => {
    // 本 effect 不返回 cleanup，所以整段不写 return——嵌套条件比早退还清楚
    // （也避开 oxlint consistent-return 对「部分路径有返回」的报错）。
    if (selectedAutomationId) {
      const el = document.querySelector<HTMLElement>(
        `[data-automation-id="${CSS.escape(selectedAutomationId)}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedAutomationId, automations]);

  useEffect(() => {
    if (!success) {
      // 显式 undefined：与下面的 cleanup 保持一致的返回形状（oxlint consistent-return）。
      return undefined;
    }
    const t = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(t);
  }, [success]);

  const createFromPreset = async () => {
    if (!selectedMatter.trim()) {
      setError("请先选择案件。自动办件必须绑定案件。");
      return;
    }
    if (needsNotifyEmail && notifyEmail.trim() && !looksLikeEmail(notifyEmail)) {
      setError("客户邮箱格式不正确，且不能使用 example.com 占位地址。");
      return;
    }
    if (needsNotifyEmail && !notifyEmail.trim()) {
      setError("客户进展周报请填写真实收件邮箱（批准发信时使用）。");
      return;
    }
    setBusy(true);
    setSuccess(null);
    try {
      const schedule = buildCreateSchedule(scheduleMode, hour, minute, everyMinutes);
      // 六确认是服务端门禁：这里先本地挡一道，省掉一次白跑，
      // 文案与引擎的 validateAutomationConfirmations 同源（都指「还差哪几项」）。
      if (!expectedResult.trim() || !approvalBoundary.trim()) {
        const missing: string[] = [];
        if (!expectedResult.trim()) {
          missing.push("办完是什么样");
        }
        if (!approvalBoundary.trim()) {
          missing.push("哪些事必须先问我");
        }
        setError(`请先交代清楚：${missing.join("、")}。`);
        setBusy(false);
        return;
      }
      await apiSendJson(apiBase, "/api/automations", "POST", {
        presetId: selectedPreset,
        matterId: selectedMatter.trim(),
        assistantId: assistantId?.trim() || undefined,
        schedule,
        notifyEmail: notifyEmail.trim() || undefined,
        expectedResult: expectedResult.trim(),
        approvalBoundary: approvalBoundary.trim(),
        missingDataPolicy,
        notifyPolicy,
        eventTrigger:
          eventSource && eventMatch.trim()
            ? { source: eventSource, match: eventMatch.trim(), minIntervalMinutes: 60 }
            : undefined,
      });
      setError(null);
      setSuccess("已创建自动办件。");
      await refresh({ quiet: true });
    } catch (e) {
      const msg = errorMessage(e, "创建失败");
      setError(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? "服务断开，请重启。"
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const createFromInstruction = async () => {
    if (!selectedMatter.trim()) {
      setError("请先选择案件。");
      return;
    }
    if (!customText.trim()) {
      setError("请先写一句交办内容，例如：每天早上整理本案邮箱来信。");
      return;
    }
    if (notifyEmail.trim() && !looksLikeEmail(notifyEmail)) {
      setError("客户邮箱格式不正确，且不能使用 example.com 占位地址。");
      return;
    }
    setBusy(true);
    setSuccess(null);
    try {
      const schedule = buildCreateSchedule(scheduleMode, hour, minute, everyMinutes);
      await apiSendJson(apiBase, "/api/automations/from-instruction", "POST", {
        matterId: selectedMatter.trim(),
        instruction: customText.trim(),
        schedule,
        notifyEmail: notifyEmail.trim() || undefined,
      });
      setCustomText("");
      setError(null);
      setSuccess("已从这句话创建自动办件。");
      await refresh({ quiet: true });
    } catch (e) {
      const msg = errorMessage(e, "创建失败");
      setError(
        /failed to fetch|networkerror|load failed/i.test(msg) ? "服务断开，请重启。" : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (a: Automation) => {
    setBusy(true);
    try {
      await apiSendJson(apiBase, `/api/automations/${encodeURIComponent(a.id)}`, "PATCH", {
        enabled: !a.enabled,
      });
      await refresh({ quiet: true });
    } catch (e) {
      setError(errorMessage(e, "更新失败"));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (a: Automation) => {
    setBusy(true);
    setSuccess(null);
    try {
      await apiSendJson(apiBase, `/api/automations/${encodeURIComponent(a.id)}`, "PATCH", {
        runNow: true,
        enabled: true,
      });
      await refresh({ quiet: true });
      setError(null);
      setSuccess("已开始办。要发出去的，在工作台该案的「现在」里批准。");
    } catch (e) {
      setError(errorMessage(e, "触发失败"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Automation) => {
    if (
      !(await confirmDialog({
        title: `确定删除自动办件「${a.title}」？`,
        body: "此操作不可撤销。",
        confirmLabel: "删除",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await apiSendJson(apiBase, `/api/automations/${encodeURIComponent(a.id)}`, "DELETE", {});
      if (selectedAutomationId === a.id) {
        setSelectedAutomationId(null);
      }
      setSuccess("已删除自动办件。");
      await refresh({ quiet: true });
    } catch (e) {
      setError(errorMessage(e, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  const creatablePresets = presets.filter((p) => p.id !== "custom");
  const presetHint = PRESET_HINT[selectedPreset] ?? selectedPresetMeta?.description ?? "";

  const applyPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    const draft = draftAutomationConfirmations(presetId);
    setExpectedResult(draft.expectedResult);
    setApprovalBoundary(draft.approvalBoundary);
    setMissingDataPolicy(draft.missingDataPolicy);
    setNotifyPolicy(draft.notifyPolicy);
    const preset = presets.find((p) => p.id === presetId);
    if (presetId === "mail-contract-review" || presetId === "mail-inbox-digest") {
      setScheduleMode("interval");
      const def =
        preset?.defaultSchedule?.kind === "interval" ? preset.defaultSchedule.everyMinutes : 30;
      setEveryMinutes(def);
      return;
    }
    if (preset?.defaultSchedule?.kind === "daily") {
      setScheduleMode("daily");
      setHour(preset.defaultSchedule.hour);
      setMinute(preset.defaultSchedule.minute);
      return;
    }
    if (preset?.defaultSchedule?.kind === "weekly") {
      setScheduleMode("weekly");
      setHour(preset.defaultSchedule.hour);
      setMinute(preset.defaultSchedule.minute);
      return;
    }
    setScheduleMode("weekly");
  };

  useEffect(() => {
    const choices = presets.filter((p) => p.id !== "custom");
    if (choices.length === 0 || choices.some((p) => p.id === selectedPreset)) {
      return;
    }
    const next = choices[0];
    if (next) {
      applyPreset(next.id);
    }
  }, [presets, selectedPreset]);

  const onScheduleChoice = (raw: string) => {
    if (raw === "weekly" || raw === "daily") {
      setScheduleMode(raw);
      return;
    }
    if (raw.startsWith("m")) {
      setScheduleMode("interval");
      setEveryMinutes(Number(raw.slice(1)) || 30);
    }
  };

  return (
    <div
      className={`lm-automations-panel${hideTitleChrome ? " lm-settings-advanced-page" : ""}`}
      data-testid="lm-automations-panel"
      aria-busy={loading || busy || undefined}
    >
      {hideTitleChrome ? null : (
        <header className="lm-automations-header">
          <div>
            <h2 className="lm-agent-fleet-title">自动办件</h2>
            <p className="lm-meta">选一件事，定多久办一次。要发出去的，在工作台该案的「现在」里批准。</p>
          </div>
        </header>
      )}

      {error ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      {success ? (
        <div className="lm-callout lm-callout-success" role="status">
          <p className="lm-callout-body">{success}</p>
        </div>
      ) : null}

      <section className="lm-settings-group lm-automations-list" aria-label="我的自动办件">
        <h3 className="lm-settings-subtitle">我的自动办件</h3>
        {loading && automations.length === 0 ? (
          <p className="lm-meta" aria-live="polite">
            正在读取…
          </p>
        ) : automations.length === 0 ? (
          <p className="lm-meta">还没有。在下面选一件事。</p>
        ) : (
          <ul className="lm-automations-ul">
            {automations.map((a) => {
              const matterTitle =
                matterOptions.find((m) => m.id === a.matterId)?.title ?? a.matterId;
              const focused = selectedAutomationId === a.id;
              const lastLine = formatAutomationLastResultForLawyer(a.lastResultSummary);
              const lastWhen = a.lastRunAt ? formatRelativeTime(a.lastRunAt) : null;
              const runsPayload = runsById[a.id];
              return (
                <Fragment key={a.id}>
                  <li
                    className={`lm-automations-row${focused ? " is-focused" : ""}`}
                    data-automation-id={a.id}
                    onClick={() => setSelectedAutomationId(a.id)}
                  >
                    <div>
                      <strong>{a.title}</strong>
                      <div className="lm-meta">
                        {a.enabled ? "已开启" : "已暂停"} · {scheduleLabel(a.schedule)} · 下次{" "}
                        {a.nextRunAt.slice(0, 16).replace("T", " ")}
                        {matterTitle ? ` · ${matterTitle}` : ""}
                        {a.notifyEmail ? ` · 收件 ${a.notifyEmail}` : ""}
                      </div>
                      {lastLine || lastWhen ? (
                        <p className="lm-meta lm-automations-last">
                          {lastWhen && lastLine
                            ? `${lastWhen} · ${lastLine}`
                            : (lastLine ?? `上次 ${lastWhen}`)}
                        </p>
                      ) : null}
                    </div>
                    <div className="lm-automations-row-actions">
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleEnabled(a);
                        }}
                      >
                        {a.enabled ? "暂停" : "开启"}
                      </button>
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-sm"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void runNow(a);
                        }}
                      >
                        办一次
                      </button>
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(a);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                  {focused ? (
                    // 运行历史单独一行渲染（不塞进上面那个 flex row），
                    // 这样不动既有行布局，也不会把按钮挤变形。
                    <li className="lm-automations-runs-row">
                      <LawmindAutomationRuns
                        automation={a}
                        payload={runsPayload}
                        loading={runsLoadingId === a.id}
                      />
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ul>
        )}
      </section>

      <section className="lm-settings-group lm-automations-create" aria-label="创建自动办件">
        <h3 className="lm-settings-subtitle">创建</h3>
        <div className="lm-settings-row">
          <span className="lm-settings-key">案件</span>
          {matterOptions.length > 0 ? (
            <select
              className="lm-settings-val-select"
              value={selectedMatter}
              onChange={(e) => setSelectedMatter(e.target.value)}
              aria-label="选择案件"
            >
              <option value="">请选择案件</option>
              {matterOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          ) : (
            <span className="lm-settings-val">请先新建案件</span>
          )}
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">做什么</span>
          <select
            className="lm-settings-val-select"
            value={selectedPreset}
            aria-label="做什么"
            data-testid="lm-auto-preset"
            onChange={(e) => applyPreset(e.target.value)}
          >
            {creatablePresets.length === 0 ? (
              <option value={selectedPreset}>{loading ? "正在读取…" : "暂无可选"}</option>
            ) : (
              creatablePresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))
            )}
          </select>
        </div>
        {!outboundCreate && presetHint ? <p className="lm-settings-caption">{presetHint}</p> : null}
        <div className="lm-settings-row">
          <span className="lm-settings-key">多久一次</span>
          <select
            className="lm-settings-val-select"
            aria-label="多久一次"
            data-testid="lm-auto-schedule"
            value={scheduleChoiceValue(scheduleMode, everyMinutes)}
            onChange={(e) => onScheduleChoice(e.target.value)}
          >
            <option value="weekly">每周一</option>
            <option value="daily">每天</option>
            {INTERVAL_PRESETS.map((opt) => (
              <option key={opt.minutes} value={`m${opt.minutes}`}>
                {opt.label}
              </option>
            ))}
            {INTERVAL_PRESETS.some((opt) => opt.minutes === everyMinutes) ? null : (
              <option value={`m${everyMinutes}`}>{`每 ${everyMinutes} 分钟`}</option>
            )}
          </select>
        </div>
        {scheduleMode === "interval" ? (
          <p className="lm-settings-caption" data-testid="lm-auto-freq-cost-hint">
            {formatAutomationFrequencyCostHint({
              kind: "interval",
              everyMinutes: Math.max(5, Math.floor(everyMinutes) || 30),
            })}
          </p>
        ) : (
          <div className="lm-settings-row">
            <span className="lm-settings-key">几点</span>
            <input
              type="time"
              className="lm-input lm-automations-time"
              aria-label="几点"
              value={`${pad2(hour)}:${pad2(minute)}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":");
                if (h === undefined || m === undefined || h === "") {
                  return;
                }
                setHour(Number(h));
                setMinute(Number(m));
              }}
            />
          </div>
        )}

        {needsNotifyEmail ? (
          <label className="lm-settings-field">
            <span className="lm-settings-key">客户邮箱</span>
            <input
              className="lm-input"
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="批准后发到这个地址"
              autoComplete="off"
              aria-label="客户邮箱"
            />
          </label>
        ) : null}
        {outboundCreate && selectedPresetMeta?.needsMail ? (
          <p className="lm-settings-caption">先在下面接上邮箱。</p>
        ) : null}
        {outboundCreate ? <LawmindOutboundSignoffCallout /> : null}
        {assistantId ? <p className="lm-settings-caption">记在当前助手名下。</p> : null}
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            data-testid="lm-auto-create"
            disabled={busy || selectedPreset === "custom" || !selectedMatter.trim()}
            onClick={() => void createFromPreset()}
          >
            创建
          </button>
        </div>
      </section>

      <details className="lm-settings-advanced" data-testid="lm-auto-more">
        <summary>
          <span className="lm-settings-advanced__label">规矩已经写好</span>
          <span className="lm-settings-advanced__hint">要改再打开</span>
        </summary>
        <div className="lm-settings-advanced-body">
          <fieldset className="lm-automations-confirm" data-testid="lm-auto-confirmations">
            <legend className="lm-settings-key">规矩</legend>
            <p className="lm-settings-caption">
              改完再创建。清空「办完是什么样」或「哪些事必须先问我」则不能创建。
            </p>
            <label className="lm-settings-field">
              <span className="lm-settings-key">办完是什么样</span>
              <input
                className="lm-input"
                value={expectedResult}
                onChange={(e) => setExpectedResult(e.target.value)}
                data-testid="lm-auto-expected-result"
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">哪些事必须先问我</span>
              <input
                className="lm-input"
                value={approvalBoundary}
                onChange={(e) => setApprovalBoundary(e.target.value)}
                data-testid="lm-auto-approval-boundary"
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">资料不全时</span>
              <select
                className="lm-input"
                value={missingDataPolicy}
                onChange={(e) => setMissingDataPolicy(e.target.value as MissingDataPolicy)}
                data-testid="lm-auto-missing-data"
              >
                {MISSING_DATA_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">什么时候告诉我</span>
              <select
                className="lm-input"
                value={notifyPolicy}
                onChange={(e) => setNotifyPolicy(e.target.value as NotifyPolicy)}
                data-testid="lm-auto-notify-policy"
              >
                {NOTIFY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="lm-settings-caption">没办成、或停下来等你拍板时，一定会通知你。</p>
          </fieldset>

          {!needsNotifyEmail ? (
            <label className="lm-settings-field">
              <span className="lm-settings-key">客户邮箱</span>
              <input
                className="lm-input"
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="要外发时再填"
                autoComplete="off"
                aria-label="客户邮箱"
              />
            </label>
          ) : null}

          <label className="lm-settings-field">
            <span className="lm-settings-key">或用一句话</span>
            <textarea
              className="lm-input"
              rows={2}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="例如：每天早上整理本案新来信"
            />
          </label>
          <div className="lm-settings-actions lm-settings-actions--flush">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={busy}
              onClick={() => void createFromInstruction()}
            >
              按这句话创建
            </button>
          </div>

          <div data-testid="lm-auto-event-trigger">
            <label className="lm-settings-field">
              <span className="lm-settings-key">有新东西时也办</span>
              <select
                className="lm-input"
                value={eventSource}
                aria-label="有新东西时也办"
                onChange={(e) =>
                  setEventSource(e.target.value as "" | "matter_files" | "mail" | "webhook")
                }
              >
                <option value="">只按上面的时间</option>
                <option value="matter_files">本案新文件</option>
                <option value="mail">新来信</option>
                <option value="webhook">本机通知</option>
              </select>
            </label>
            {eventSource ? (
              <label className="lm-settings-field">
                <span className="lm-settings-key">要对上这个词</span>
                <input
                  className="lm-input"
                  value={eventMatch}
                  onChange={(e) => setEventMatch(e.target.value)}
                  placeholder="例如：续签"
                  data-testid="lm-auto-event-match"
                />
              </label>
            ) : null}
          </div>
        </div>
      </details>

      <LawmindMailAccountsSection
        apiBase={apiBase}
        matterId={selectedMatter || matterId}
        matterOptions={matterOptions}
      />
    </div>
  );
}
