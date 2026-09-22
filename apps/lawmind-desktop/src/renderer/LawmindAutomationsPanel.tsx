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
import { isOutboundAutomationContext } from "../../../../src/lawmind/platform/lawyer-outbound-decision.ts";

type Schedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "once"; runAt: string }
  | { kind: "interval"; everyMinutes: number };

type ScheduleMode = "weekly" | "daily" | "interval";

const INTERVAL_PRESETS = [
  { minutes: 15, label: "15 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 120, label: "2 小时" },
  { minutes: 360, label: "6 小时" },
  { minutes: 720, label: "12 小时" },
  { minutes: 1440, label: "24 小时" },
] as const;

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

/** 缺数据策略的律师侧措辞。默认第一项（如实报失败），与引擎默认一致。 */
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

function buildCreateSchedule(
  mode: ScheduleMode,
  hour: number,
  minute: number,
  everyMinutes: number,
): Schedule {
  if (mode === "interval") {
    return { kind: "interval", everyMinutes: Math.max(5, Math.floor(everyMinutes) || 30) };
  }
  if (mode === "weekly") {
    return { kind: "weekly", weekday: 1, hour, minute };
  }
  return { kind: "daily", hour, minute };
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
        <ul className="lm-automations-runs-ul">
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
    onOpenNeedsDecisionDesk,
    onOpenActionHub,
    hideTitleChrome = false,
  } = props;
  const openNeedsDecisionDesk = onOpenNeedsDecisionDesk ?? onOpenActionHub;
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
  // 六确认：律师必须交代清楚才能建常设工作（无人值守的失败代价由他承担）。
  // 给出安全默认值，但不预填文本——期望结果与审批边界必须是他自己写的。
  const [expectedResult, setExpectedResult] = useState("");
  const [approvalBoundary, setApprovalBoundary] = useState("");
  const [missingDataPolicy, setMissingDataPolicy] =
    useState<MissingDataPolicy>("report_failure");
  const [notifyPolicy, setNotifyPolicy] = useState<NotifyPolicy>("on_problem");
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
        schedule,
        notifyEmail: notifyEmail.trim() || undefined,
        expectedResult: expectedResult.trim(),
        approvalBoundary: approvalBoundary.trim(),
        missingDataPolicy,
        notifyPolicy,
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
      setError("请先在上方选择案件，再点「从这句话创建」。");
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
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? "本地服务已断开（常见原因：邮箱连接超时拖垮了后台）。请重启桌面应用后再试「从这句话创建」。"
          : msg,
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
      setSuccess("已触发立即运行；外发待发信进「待我拍板」，内部结果看任务上次摘要。");
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

  const seedDemoMail = async () => {
    if (!selectedMatter.trim()) {
      setError("请先选择案件再写入演示邮件。");
      return;
    }
    setBusy(true);
    try {
      await apiSendJson(apiBase, "/api/automations/mail/seed", "POST", {
        matterId: selectedMatter.trim(),
        subject: "请审阅附件合同修订稿",
        bodyText: "您好，附件为对方发来的合同修订版，请协助审查。",
        attachments: [{ name: "合同修订稿.docx", relativePath: "合同修订稿.docx" }],
      });
      setSuccess("已写入演示邮件。");
      await refresh({ quiet: true });
    } catch (e) {
      setError(errorMessage(e, "写入演示邮件失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`lm-automations-panel${hideTitleChrome ? " lm-settings-advanced-page" : ""}`}
      data-testid="lm-automations-panel"
      aria-busy={loading || busy || undefined}
    >
      <header className="lm-automations-header">
        {hideTitleChrome ? null : (
          <div>
            <h2 className="lm-agent-fleet-title">自动办件</h2>
            <p className="lm-meta">
              配置定时与邮箱。外发待发信进「待我拍板」；这里只改任务与邮箱，不处理待办。
            </p>
          </div>
        )}
        <div className="lm-automations-header-actions">
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            {loading ? "加载中…" : "刷新"}
          </button>
          {openNeedsDecisionDesk ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              onClick={() => openNeedsDecisionDesk?.()}
            >
              去在办处理
            </button>
          ) : null}
        </div>
      </header>

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
      {busy || loading ? (
        <p className="lm-meta lm-automations-loading" aria-live="polite">
          {busy ? "处理中…" : "正在加载自动办件…"}
        </p>
      ) : null}

      <section className="lm-automations-list" aria-label="我的自动办件">
        <div className="lm-automations-section-head">
          <h3 className="lm-settings-subtitle">我的自动办件</h3>
          {automations.length > 0 ? (
            <span className="lm-automations-count">{automations.length}</span>
          ) : null}
        </div>
        {automations.length === 0 ? (
          <p className="lm-meta">还没有自动办件。从下方模板或一句话创建一个。</p>
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
                        立即跑一次
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

      <section className="lm-automations-create" aria-label="创建自动办件">
        <h3 className="lm-settings-subtitle">创建</h3>
        <label className="lm-compose-bar-field">
          <span className="lm-compose-bar-label">案件（必选）</span>
          {matterOptions.length > 0 ? (
            <select
              className="lm-compose-select"
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
            <input
              className="lm-input"
              value={selectedMatter}
              onChange={(e) => setSelectedMatter(e.target.value)}
              placeholder="案件 ID"
            />
          )}
        </label>
        {matterOptions.length === 0 ? (
          <p className="lm-meta">请先新建案件。</p>
        ) : null}

        <div className="lm-automations-preset-grid">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`lm-automations-preset-card${selectedPreset === p.id ? " is-selected" : ""}`}
              onClick={() => {
                setSelectedPreset(p.id);
                // Mail presets default to interval polling.
                if (p.id === "mail-contract-review" || p.id === "mail-inbox-digest") {
                  setScheduleMode("interval");
                  const def =
                    p.defaultSchedule?.kind === "interval"
                      ? p.defaultSchedule.everyMinutes
                      : 30;
                  setEveryMinutes(def);
                } else if (p.defaultSchedule?.kind === "daily") {
                  setScheduleMode("daily");
                } else {
                  setScheduleMode("weekly");
                }
              }}
            >
              <strong>{p.title}</strong>
              <span className="lm-meta">{p.description}</span>
            </button>
          ))}
        </div>

        <div className="lm-automations-schedule-row" role="group" aria-label="运行频率">
          <label className="lm-meta">
            <input
              type="radio"
              name="lm-auto-schedule"
              checked={scheduleMode === "interval"}
              onChange={() => setScheduleMode("interval")}
            />{" "}
            每隔一段时间
          </label>
          <label className="lm-meta">
            <input
              type="radio"
              name="lm-auto-schedule"
              checked={scheduleMode === "daily"}
              onChange={() => setScheduleMode("daily")}
            />{" "}
            每天
          </label>
          <label className="lm-meta">
            <input
              type="radio"
              name="lm-auto-schedule"
              checked={scheduleMode === "weekly"}
              onChange={() => setScheduleMode("weekly")}
            />{" "}
            每周一
          </label>
        </div>
        {scheduleMode === "interval" ? (
          <div className="lm-automations-schedule-row">
            <label className="lm-meta">
              读取/处理间隔
              <select
                className="lm-compose-select lm-automations-interval-select"
                value={everyMinutes}
                onChange={(e) => setEveryMinutes(Number(e.target.value))}
                aria-label="邮件处理间隔"
              >
                {INTERVAL_PRESETS.map((opt) => (
                  <option key={opt.minutes} value={opt.minutes}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="lm-meta">创建后约 1 分钟内先跑一次，之后按间隔重复（最短 5 分钟）。</span>
          </div>
        ) : (
          <div className="lm-automations-schedule-row">
            <label className="lm-meta">
              时间
              <input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="lm-input lm-automations-time"
              />
              :
              <input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => setMinute(Number(e.target.value))}
                className="lm-input lm-automations-time"
              />
            </label>
          </div>
        )}

        {needsNotifyEmail || customText.length > 0 ? (
          <label className="lm-compose-bar-field">
            <span className="lm-compose-bar-label">客户收件邮箱（周报批准发信用）</span>
            <input
              className="lm-input"
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="如 counsel@client-firm.com（禁止 example.com）"
              autoComplete="off"
            />
          </label>
        ) : null}

        {outboundCreate ? <LawmindOutboundSignoffCallout /> : null}

        <fieldset className="lm-automations-confirm" data-testid="lm-auto-confirmations">
          <legend className="lm-settings-subtitle">办这件事的规矩（必须交代）</legend>
          <p className="lm-meta">
            常设工作是在你离开电脑后自己跑的。这四项说清楚，出问题时你才知道它该不该继续跑。
          </p>
          <label className="lm-compose-bar-field">
            <span className="lm-compose-bar-label">办完是什么样</span>
            <input
              className="lm-input"
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              placeholder="例：一份续签提醒清单，列合同名、到期日、对接人"
              data-testid="lm-auto-expected-result"
            />
          </label>
          <label className="lm-compose-bar-field">
            <span className="lm-compose-bar-label">哪些事必须先问我</span>
            <input
              className="lm-input"
              value={approvalBoundary}
              onChange={(e) => setApprovalBoundary(e.target.value)}
              placeholder="例：外发邮件前必须问我；不要自己改原稿"
              data-testid="lm-auto-approval-boundary"
            />
          </label>
          <label className="lm-compose-bar-field">
            <span className="lm-compose-bar-label">资料不全时</span>
            <select
              className="lm-compose-select"
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
          <label className="lm-compose-bar-field">
            <span className="lm-compose-bar-label">什么时候告诉我</span>
            <select
              className="lm-compose-select"
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
          <p className="lm-meta">
            没办成、或停下来等你拍板时，一定会通知你——不受最后一项影响。
          </p>
        </fieldset>

        <div className="lm-automations-create-actions">
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={busy || selectedPreset === "custom"}
            onClick={() => void createFromPreset()}
          >
            用所选模板创建
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={() => void seedDemoMail()}
          >
            写入演示邮件
          </button>
        </div>

        <label className="lm-compose-bar-field">
          <span className="lm-compose-bar-label">或用一句话自定义</span>
          <textarea
            className="lm-input"
            rows={3}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="例：每天早上整理本案邮箱来信；有合同附件就做初审，改完稿给我拍板后再发给客户。"
          />
        </label>
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          disabled={busy}
          onClick={() => void createFromInstruction()}
        >
          从这句话创建
        </button>
      </section>

      <LawmindMailAccountsSection
        apiBase={apiBase}
        matterId={selectedMatter || matterId}
        matterOptions={matterOptions}
      />
    </div>
  );
}
