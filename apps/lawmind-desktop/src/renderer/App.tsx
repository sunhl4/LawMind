import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactDraft, TaskRecord } from "../../../../src/lawmind/types.ts";
import { FileWorkbench } from "./FileWorkbench";
import { MatterWorkbench } from "./MatterWorkbench";
import { ReviewWorkbench } from "./ReviewWorkbench";
import { HelpPanel } from "./HelpPanel";
import { LawmindSettingsAssistants } from "./LawmindSettingsAssistants";
import { LawmindSettingsCollaboration, type CollabSummaryState } from "./LawmindSettingsCollaboration";
import { LawmindSettingsDisclaimer } from "./LawmindSettingsDisclaimer";
import { LawmindSettingsModelRetrieval } from "./LawmindSettingsModelRetrieval";
import { LawmindApiSetupWizard } from "./LawmindApiSetupWizard";
import { LawmindCitationBanner } from "./LawmindCitationBanner";
import { LawmindTaskCheckpoints } from "./LawmindTaskCheckpoints";
import { LawmindSettingsOnboarding } from "./LawmindSettingsOnboarding";
import { LawmindSettingsWorkspace } from "./LawmindSettingsWorkspace";
import type { AssistantRow } from "./lawmind-settings-models.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { TaskCheckpoint } from "../../../../src/lawmind/tasks/checkpoints.ts";
import { chatErrorUserText, type ApiErrorJson } from "./api-client";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/store.ts";

function resolveWorkspacePath(workspaceDir: string, rel: string): string {
  const r = rel.replace(/\\/g, "/").replace(/^\//, "");
  const w = workspaceDir.replace(/\\/g, "/").replace(/\/$/, "");
  return `${w}/${r}`;
}

/** Relative path for GET /api/artifact?path= (must stay under workspace `artifacts/`) */
function artifactApiRelFromOutput(outputPath?: string): string | null {
  if (!outputPath) {
    return null;
  }
  const norm = outputPath.replace(/\\/g, "/").replace(/^\//, "");
  if (norm.startsWith("artifacts/")) {
    return norm;
  }
  if (!norm.includes("/")) {
    return `artifacts/${norm}`;
  }
  return null;
}

function formatLocaleDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) {
      return iso;
    }
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) {
      return "刚刚";
    }
    if (diff < 3_600_000) {
      return `${Math.floor(diff / 60_000)} 分钟前`;
    }
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d >= today) {
      return `今天 ${hhmm}`;
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d >= yesterday) {
      return `昨天 ${hhmm}`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return iso;
  }
}

function legalStatusLabel(status: string | undefined, kind?: string): string {
  if (kind === "agent.instruction") {
    return "对话";
  }
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "done" || normalized === "completed") {
    return "已完成";
  }
  if (normalized === "running" || normalized === "processing") {
    return "处理中";
  }
  if (normalized === "error" || normalized === "failed") {
    return "处理失败";
  }
  if (normalized === "pending") {
    return "待处理";
  }
  if (normalized === "draft") {
    return "草稿";
  }
  if (normalized === "task") {
    return "任务";
  }
  return status ?? "任务";
}

function renderInlineLegalMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <code key={`code-${match.index}`} className="lm-md-code">
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderLegalMarkdown(text: string): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      blocks.push(<div key={`space-${index}`} className="lm-md-space" />);
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} className="lm-md-hr" />);
      index += 1;
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      blocks.push(
        <div key={`h2-${index}`} className="lm-md-h2">
          {renderInlineLegalMarkdown(h2[1])}
        </div>,
      );
      index += 1;
      continue;
    }

    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const bulletMatch = /^-\s+(.+)$/.exec(lines[index] ?? "");
        if (!bulletMatch) {
          break;
        }
        items.push(
          <li key={`ul-item-${index}`}>{renderInlineLegalMarkdown(bulletMatch[1])}</li>,
        );
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="lm-md-list">
          {items}
        </ul>,
      );
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const orderedMatch = /^\d+\.\s+(.+)$/.exec(lines[index] ?? "");
        if (!orderedMatch) {
          break;
        }
        items.push(
          <li key={`ol-item-${index}`}>{renderInlineLegalMarkdown(orderedMatch[1])}</li>,
        );
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="lm-md-list lm-md-ol">
          {items}
        </ol>,
      );
      continue;
    }

    blocks.push(
      <div key={`p-${index}`} className="lm-md-p">
        {renderInlineLegalMarkdown(line)}
      </div>,
    );
    index += 1;
  }

  return <>{blocks}</>;
}

type TimeRangeFilter = "all" | "today" | "7d" | "30d";

function rangeStartMs(range: TimeRangeFilter): number | null {
  if (range === "all") {
    return null;
  }
  const now = Date.now();
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === "7d") {
    return now - 7 * 86400000;
  }
  return now - 30 * 86400000;
}

type AppConfig = {
  apiBase: string;
  workspaceDir: string;
  projectDir: string | null;
  envFilePath: string;
  retrievalMode: "single" | "dual";
};

type TaskRow = {
  taskId: string;
  summary: string;
  title?: string;
  kind?: string;
  status: string;
  output?: string;
  outputPath?: string;
  updatedAt: string;
  createdAt?: string;
  matterId?: string;
  assistantId?: string;
  sessionId?: string;
};

type HistoryItem = {
  kind: "task" | "draft";
  id: string;
  label: string;
  updatedAt: string;
  createdAt?: string;
  status?: string;
  outputPath?: string;
  matterId?: string;
  taskRecordKind?: string;
  assistantId?: string;
};

type ChatMsg = { role: "user" | "assistant"; text: string };

type DelegationRow = {
  delegationId: string;
  fromAssistant: string;
  toAssistant: string;
  task: string;
  status: string;
  priority: string;
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
};

type CollabEvent = {
  eventId: string;
  kind: string;
  fromAssistantId: string;
  toAssistantId: string;
  matterId?: string;
  detail?: string;
  timestamp: string;
};

type PresetRow = { id: string; displayName: string; promptSection: string };

const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "起草律师函", prompt: "请帮我起草一封律师函，就以下事项发出法律警告：\n\n" },
  { label: "合同审查", prompt: "请对以下合同进行风险审查，逐条标注重点风险点：\n\n" },
  { label: "法规检索", prompt: "请检索以下法律问题的相关法规、司法解释和典型判例：\n\n" },
  { label: "起草诉状", prompt: "请帮我起草民事起诉状，案情简述如下：\n\n" },
  { label: "案例查询", prompt: "请查找与以下纠纷类似的典型判例及裁判要旨：\n\n" },
];

const SCENARIO_CARDS: Array<{ title: string; description: string; prompt: string }> = [
  {
    title: "起草文书",
    description: "律师函、诉状、公函",
    prompt: "请帮我起草一份律师函，核心事实与诉求如下：\n\n",
  },
  {
    title: "法规检索",
    description: "条文、判例、政策文件",
    prompt: "请检索以下法律问题的相关法规、司法解释与裁判要旨：\n\n",
  },
  {
    title: "合同审查",
    description: "逐条标注风险与建议",
    prompt: "请对以下合同进行逐条审查，并列出关键风险点与修改建议：\n\n",
  },
];

export function App() {
  const [mainView, setMainView] = useState<"chat" | "files" | "matters" | "review">("chat");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [health, setHealth] = useState<{
    modelConfigured: boolean;
    retrievalMode?: string;
    dualLegalConfigured?: boolean;
    webSearchApiKeyConfigured?: boolean;
  } | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizApiKey, setWizApiKey] = useState("");
  const [wizBaseUrl, setWizBaseUrl] = useState("https://dashscope.aliyuncs.com/compatible-mode/v1");
  const [wizModel, setWizModel] = useState("qwen-plus");
  const [wizWorkspace, setWizWorkspace] = useState("");
  const [wizBusy, setWizBusy] = useState(false);
  const [wizError, setWizError] = useState<string | null>(null);
  const [wizRetrievalMode, setWizRetrievalMode] = useState<"single" | "dual">("single");
  const [retrievalSaving, setRetrievalSaving] = useState(false);
  const [allowWebSearch, setAllowWebSearch] = useState(false);
  const [sideTab, setSideTab] = useState<"tasks" | "history">("tasks");
  const [taskListQuery, setTaskListQuery] = useState("");
  const [listTimeRange, setListTimeRange] = useState<TimeRangeFilter>("all");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [messagesByAssistant, setMessagesByAssistant] = useState<Record<string, ChatMsg[]>>({});
  const [sessionByAssistant, setSessionByAssistant] = useState<Record<string, string | undefined>>(
    {},
  );
  const [assistants, setAssistants] = useState<AssistantRow[]>([]);
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(DEFAULT_ASSISTANT_ID);
  const [showAssistantEditor, setShowAssistantEditor] = useState(false);
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(null);
  const [asstDisplayName, setAsstDisplayName] = useState("");
  const [asstIntroduction, setAsstIntroduction] = useState("");
  const [asstPresetKey, setAsstPresetKey] = useState("");
  const [asstCustomTitle, setAsstCustomTitle] = useState("");
  const [asstCustomInstr, setAsstCustomInstr] = useState("");
  const [asstBusy, setAsstBusy] = useState(false);
  const [asstError, setAsstError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailKind, setDetailKind] = useState<"task" | "draft" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [detailDraft, setDetailDraft] = useState<ArtifactDraft | null>(null);
  const [detailCitationIntegrity, setDetailCitationIntegrity] = useState<
    DraftCitationIntegrityView | null
  >(null);
  const [detailCheckpoints, setDetailCheckpoints] = useState<TaskCheckpoint[] | null>(null);
  const [contextTaskId, setContextTaskId] = useState<string | null>(null);
  const [contextMatterId, setContextMatterId] = useState<string | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [collabSummarySettings, setCollabSummarySettings] = useState<CollabSummaryState>(undefined);
  const [collabExpanded, setCollabExpanded] = useState(false);
  const [delegations, setDelegations] = useState<DelegationRow[]>([]);
  const [collabEvents, setCollabEvents] = useState<CollabEvent[]>([]);
  const [collabTab, setCollabTab] = useState<"delegations" | "timeline">("delegations");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentMessages = messagesByAssistant[selectedAssistantId] ?? [];

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  const canUseFilesystemBridge = Boolean(
    config && !config.workspaceDir.trim().startsWith("("),
  );

  const openDetail = useCallback(
    async (kind: "task" | "draft", id: string) => {
      if (!config) {
        return;
      }
      setDetailOpen(true);
      setDetailKind(kind);
      setDetailId(id);
      setDetailLoading(true);
      setDetailError(null);
      setDetailTask(null);
      setDetailDraft(null);
      setDetailCitationIntegrity(null);
      setDetailCheckpoints(null);
      try {
        const rel =
          kind === "task"
            ? `/api/tasks/${encodeURIComponent(id)}`
            : `/api/drafts/${encodeURIComponent(id)}`;
        const r = await fetch(`${config.apiBase}${rel}`);
        const j = (await r.json()) as {
          ok?: boolean;
          error?: string;
          task?: TaskRecord;
          draft?: ArtifactDraft;
          citationIntegrity?: DraftCitationIntegrityView;
          checkpoints?: TaskCheckpoint[];
        };
        if (!r.ok || !j.ok) {
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        if (kind === "task" && j.task) {
          setDetailTask(j.task);
          setDetailCheckpoints(Array.isArray(j.checkpoints) ? j.checkpoints : null);
        } else if (kind === "draft" && j.draft) {
          setDetailDraft(j.draft);
          setDetailCitationIntegrity(j.citationIntegrity ?? null);
        } else {
          throw new Error("empty response");
        }
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
      }
    },
    [config],
  );

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailKind(null);
    setDetailId(null);
    setDetailTask(null);
    setDetailDraft(null);
    setDetailCitationIntegrity(null);
    setDetailCheckpoints(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const previewArtifact = (outputPath?: string) => {
    if (!config) {
      return;
    }
    const rel = artifactApiRelFromOutput(outputPath);
    if (!rel) {
      return;
    }
    const url = `${config.apiBase}/api/artifact?path=${encodeURIComponent(rel)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openOutputInFolder = (outputPath?: string) => {
    if (!config || !outputPath || !canUseFilesystemBridge) {
      return;
    }
    const full = resolveWorkspacePath(config.workspaceDir, outputPath);
    void window.lawmindDesktop?.showItemInFolder?.(full);
  };

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!config) {
        throw new Error("Not configured");
      }
      const headers = new Headers(init?.headers);
      headers.set("content-type", "application/json");
      const r = await fetch(`${config.apiBase}${path}`, {
        ...init,
        headers,
      });
      return r;
    },
    [config],
  );

  const refreshLists = useCallback(async () => {
    if (!config) {
      return;
    }
    try {
      const [tr, hi] = await Promise.all([
        fetch(`${config.apiBase}/api/tasks`).then((r) => r.json()),
        fetch(`${config.apiBase}/api/history`).then((r) => r.json()),
      ]);
      if (tr.ok && Array.isArray(tr.tasks)) {
        setTasks(tr.tasks);
      }
      if (hi.ok && Array.isArray(hi.items)) {
        setHistory(hi.items);
      }
    } catch {
      /* ignore */
    }
  }, [config]);

  const filteredTasks = useMemo(() => {
    const q = taskListQuery.trim().toLowerCase();
    const start = rangeStartMs(listTimeRange);
    const aid = selectedAssistantId;
    return tasks.filter((t) => {
      if (t.assistantId && t.assistantId !== aid) {
        return false;
      }
      if (start !== null) {
        const u = Date.parse(t.updatedAt);
        if (!Number.isFinite(u) || u < start) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      const hay = [t.taskId, t.title ?? "", t.summary, t.kind ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, taskListQuery, listTimeRange, selectedAssistantId]);

  const filteredHistory = useMemo(() => {
    const q = taskListQuery.trim().toLowerCase();
    const start = rangeStartMs(listTimeRange);
    const aid = selectedAssistantId;
    return history.filter((h) => {
      if (h.assistantId && h.assistantId !== aid) {
        return false;
      }
      if (start !== null) {
        const u = Date.parse(h.updatedAt);
        if (!Number.isFinite(u) || u < start) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      const hay = [h.id, h.label, h.kind, h.taskRecordKind ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [history, taskListQuery, listTimeRange, selectedAssistantId]);

  const refreshCollaboration = useCallback(async () => {
    if (!config) {
      return;
    }
    try {
      const [dr, er] = await Promise.all([
        fetch(`${config.apiBase}/api/delegations`).then((r) => r.json()),
        fetch(`${config.apiBase}/api/collaboration-events`).then((r) => r.json()),
      ]);
      if (dr.ok && Array.isArray(dr.delegations)) {
        setDelegations(dr.delegations);
      }
      if (er.ok && Array.isArray(er.events)) {
        setCollabEvents(er.events.slice(-50));
      }
    } catch {
      /* ignore */
    }
  }, [config]);

  const refreshAssistants = useCallback(async () => {
    if (!config) {
      return;
    }
    try {
      const r = await fetch(`${config.apiBase}/api/assistants`);
      const j = (await r.json()) as {
        ok?: boolean;
        assistants?: AssistantRow[];
        presets?: PresetRow[];
      };
      if (j.ok && Array.isArray(j.assistants)) {
        setAssistants(j.assistants);
      }
      if (Array.isArray(j.presets)) {
        setPresets(j.presets);
      }
    } catch {
      /* ignore */
    }
  }, [config]);

  useEffect(() => {
    if (assistants.length === 0) {
      return;
    }
    setSelectedAssistantId((prev) => {
      if (prev && assistants.some((a) => a.assistantId === prev)) {
        return prev;
      }
      return assistants[0]?.assistantId ?? DEFAULT_ASSISTANT_ID;
    });
  }, [assistants]);

  useEffect(() => {
    void (async () => {
      const bridge = window.lawmindDesktop;
      if (bridge?.getConfig) {
        const c = await bridge.getConfig();
        const rm = c.retrievalMode === "dual" ? "dual" : "single";
        setConfig({
          apiBase: c.apiBase,
          workspaceDir: c.workspaceDir,
          projectDir: c.projectDir ?? null,
          envFilePath: c.envFilePath,
          retrievalMode: rm,
        });
        setWizRetrievalMode(rm);
        return;
      }
      const devApi = (import.meta.env.VITE_LAWMIND_DEV_API as string | undefined)?.trim();
      if (devApi) {
        setConfig({
          apiBase: devApi.replace(/\/$/, ""),
          workspaceDir: "(browser dev / E2E — use Electron for full config)",
          projectDir: null,
          envFilePath: "",
          retrievalMode: "single",
        });
        return;
      }
      setError(
        "Preload bridge missing: run `pnpm lawmind:desktop` and use the Electron window (do not open this tab in Chrome/Safari).",
      );
    })();
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }
    void (async () => {
      try {
        const r = await fetch(`${config.apiBase}/api/health`);
        const j = await r.json();
        const okModel = Boolean(j.modelConfigured);
        setHealth({
          modelConfigured: okModel,
          retrievalMode: typeof j.retrievalMode === "string" ? j.retrievalMode : undefined,
          dualLegalConfigured: Boolean(j.dualLegalConfigured),
          webSearchApiKeyConfigured: Boolean(j.webSearchApiKeyConfigured),
        });
        if (!okModel) {
          setShowWizard(true);
        }
        await refreshLists();
        await refreshAssistants();
        await refreshCollaboration();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [config, refreshLists, refreshAssistants, refreshCollaboration]);

  useEffect(() => {
    if (!showSettings || !config) {
      return;
    }
    let cancelled = false;
    setCollabSummarySettings(undefined);
    void (async () => {
      try {
        const r = await fetch(`${config.apiBase}/api/collaboration/summary`);
        const j = (await r.json()) as {
          ok?: boolean;
          collaborationEnabled?: boolean;
          collaborationHint?: string;
          delegationCount?: number;
        };
        if (cancelled) {
          return;
        }
        if (!j.ok) {
          setCollabSummarySettings(null);
          return;
        }
        setCollabSummarySettings({
          collaborationEnabled: Boolean(j.collaborationEnabled),
          collaborationHint: typeof j.collaborationHint === "string" ? j.collaborationHint : undefined,
          delegationCount: Number.isFinite(j.delegationCount) ? Number(j.delegationCount) : 0,
        });
      } catch {
        if (!cancelled) {
          setCollabSummarySettings(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showSettings, config]);

  const applyRetrievalMode = async (mode: "single" | "dual") => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.setRetrievalMode || !config) {
      return;
    }
    setRetrievalSaving(true);
    setError(null);
    try {
      const res = await bridge.setRetrievalMode(mode);
      if (!res.ok) {
        throw new Error(res.error || "切换失败");
      }
      const nextBase = res.apiBase ?? config.apiBase;
      const nextMode: "single" | "dual" =
        res.retrievalMode === "dual" ? "dual" : res.retrievalMode === "single" ? "single" : mode;
      setConfig({ ...config, apiBase: nextBase, retrievalMode: nextMode });
      const r = await fetch(`${nextBase}/api/health`);
      const j = await r.json();
      setHealth({
        modelConfigured: Boolean(j.modelConfigured),
        retrievalMode: typeof j.retrievalMode === "string" ? j.retrievalMode : undefined,
        dualLegalConfigured: Boolean(j.dualLegalConfigured),
        webSearchApiKeyConfigured: Boolean(j.webSearchApiKeyConfigured),
      });
      await refreshLists();
      await refreshAssistants();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrievalSaving(false);
    }
  };

  const runWizardSave = async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.saveSetup) {
      return;
    }
    setWizBusy(true);
    setWizError(null);
    try {
      const res = await bridge.saveSetup({
        apiKey: wizApiKey.trim(),
        baseUrl: wizBaseUrl.trim() || undefined,
        model: wizModel.trim() || undefined,
        workspaceDir: wizWorkspace.trim() || undefined,
        retrievalMode: wizRetrievalMode,
      });
      if (!res.ok) {
        throw new Error(res.error || "save failed");
      }
      if (res.apiBase && res.workspaceDir && res.envFilePath) {
        const rm =
          res.retrievalMode === "dual" || wizRetrievalMode === "dual" ? "dual" : "single";
        setConfig({
          apiBase: res.apiBase,
          workspaceDir: res.workspaceDir,
          projectDir: config?.projectDir ?? null,
          envFilePath: res.envFilePath,
          retrievalMode: rm,
        });
        setWizRetrievalMode(rm);
      }
      setShowWizard(false);
      setWizApiKey("");
      const apiBaseNext = res.apiBase ?? config?.apiBase;
      if (!apiBaseNext) {
        throw new Error("missing api base after save");
      }
      const r = await fetch(`${apiBaseNext}/api/health`);
      const j = await r.json();
      setHealth({
        modelConfigured: Boolean(j.modelConfigured),
        retrievalMode: typeof j.retrievalMode === "string" ? j.retrievalMode : undefined,
        dualLegalConfigured: Boolean(j.dualLegalConfigured),
        webSearchApiKeyConfigured: Boolean(j.webSearchApiKeyConfigured),
      });
      const [tr, hi] = await Promise.all([
        fetch(`${apiBaseNext}/api/tasks`).then((x) => x.json()),
        fetch(`${apiBaseNext}/api/history`).then((x) => x.json()),
      ]);
      if (tr.ok && Array.isArray(tr.tasks)) {
        setTasks(tr.tasks);
      }
      if (hi.ok && Array.isArray(hi.items)) {
        setHistory(hi.items);
      }
      const ja = await fetch(`${apiBaseNext}/api/assistants`).then((x) => x.json());
      if (ja.ok && Array.isArray(ja.assistants)) {
        setAssistants(ja.assistants);
      }
      if (Array.isArray(ja.presets)) {
        setPresets(ja.presets);
      }
    } catch (e) {
      setWizError(e instanceof Error ? e.message : String(e));
    } finally {
      setWizBusy(false);
    }
  };

  const pickWs = async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.pickWorkspace) {
      return;
    }
    const r = await bridge.pickWorkspace();
    if (r.ok && r.path) {
      setWizWorkspace(r.path);
    }
  };

  const pickProject = async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.pickProject || !bridge.setProjectDir || !config) {
      return;
    }
    const r = await bridge.pickProject();
    if (r.ok && r.path) {
      const setRes = await bridge.setProjectDir(r.path);
      if (!setRes.ok) {
        setError(setRes.error || "设置项目目录失败");
        return;
      }
      setConfig({ ...config, projectDir: setRes.projectDir ?? null });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !config || loading) {
      return;
    }
    const aid = selectedAssistantId;
    setError(null);
    setInput("");
    setMessagesByAssistant((prev) => ({
      ...prev,
      [aid]: [...(prev[aid] ?? []), { role: "user", text }],
    }));
    setLoading(true);
    try {
      const sid = sessionByAssistant[aid];
      const r = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          sessionId: sid,
          assistantId: aid,
          allowWebSearch,
          ...(contextMatterId ? { matterId: contextMatterId } : {}),
          ...(projectDir ? { projectDir } : {}),
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        code?: string;
        message?: string;
        error?: string;
        detail?: string;
        sessionId?: string;
        reply?: string;
      };
      if (!r.ok || j.ok === false) {
        throw new Error(chatErrorUserText(r.status, j as ApiErrorJson));
      }
      if (j.sessionId) {
        setSessionByAssistant((prev) => ({ ...prev, [aid]: j.sessionId }));
      }
      setMessagesByAssistant((prev) => ({
        ...prev,
        [aid]: [...(prev[aid] ?? []), { role: "assistant", text: j.reply || "(empty)" }],
      }));
      await refreshLists();
      await refreshAssistants();
      await refreshCollaboration();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessagesByAssistant((prev) => ({
        ...prev,
        [aid]: [
          ...(prev[aid] ?? []),
          { role: "assistant", text: `错误: ${String(e)}` },
        ],
      }));
    } finally {
      setLoading(false);
    }
  };

  const openNewAssistant = () => {
    setEditingAssistantId(null);
    setAsstDisplayName("新助手");
    setAsstIntroduction("");
    setAsstPresetKey(presets[0]?.id ?? "general_default");
    setAsstCustomTitle("");
    setAsstCustomInstr("");
    setAsstError(null);
    setShowAssistantEditor(true);
  };

  const openEditAssistant = () => {
    const a = assistants.find((x) => x.assistantId === selectedAssistantId);
    if (!a) {
      return;
    }
    setEditingAssistantId(a.assistantId);
    setAsstDisplayName(a.displayName);
    setAsstIntroduction(a.introduction);
    setAsstPresetKey(a.presetKey ?? "general_default");
    setAsstCustomTitle(a.customRoleTitle ?? "");
    setAsstCustomInstr(a.customRoleInstructions ?? "");
    setAsstError(null);
    setShowAssistantEditor(true);
  };

  const saveAssistant = async () => {
    if (!config) {
      return;
    }
    setAsstBusy(true);
    setAsstError(null);
    try {
      const body = {
        displayName: asstDisplayName.trim(),
        introduction: asstIntroduction.trim(),
        presetKey: asstPresetKey.trim() || undefined,
        customRoleTitle: asstCustomTitle.trim() || undefined,
        customRoleInstructions: asstCustomInstr.trim() || undefined,
      };
      const path =
        editingAssistantId === null
          ? "/api/assistants"
          : `/api/assistants/${encodeURIComponent(editingAssistantId)}`;
      const method = editingAssistantId === null ? "POST" : "PATCH";
      const r = await fetch(`${config.apiBase}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; assistant?: AssistantRow };
      if (!r.ok || !j.ok) {
        throw new Error(j.error || "save failed");
      }
      if (j.assistant?.assistantId) {
        setSelectedAssistantId(j.assistant.assistantId);
      }
      setShowAssistantEditor(false);
      await refreshAssistants();
    } catch (e) {
      setAsstError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsstBusy(false);
    }
  };

  const removeAssistant = async () => {
    if (!config || selectedAssistantId === DEFAULT_ASSISTANT_ID) {
      return;
    }
    if (!window.confirm("确定删除该助手？其会话记录仍保留在工作区。")) {
      return;
    }
    try {
      const r = await fetch(
        `${config.apiBase}/api/assistants/${encodeURIComponent(selectedAssistantId)}`,
        { method: "DELETE" },
      );
      const j = (await r.json()) as { ok?: boolean };
      if (!r.ok || !j.ok) {
        throw new Error("delete failed");
      }
      setSessionByAssistant((prev) => {
        const next = { ...prev };
        delete next[selectedAssistantId];
        return next;
      });
      setMessagesByAssistant((prev) => {
        const next = { ...prev };
        delete next[selectedAssistantId];
        return next;
      });
      setSelectedAssistantId(DEFAULT_ASSISTANT_ID);
      await refreshAssistants();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyMessage = useCallback(async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedMessageIndex(index);
    window.setTimeout(() => {
      setCopiedMessageIndex((prev) => (prev === index ? null : prev));
    }, 2000);
  }, []);

  function taskBadgeClass(status: string, kind?: string): string {
    if (kind === "agent.instruction") {
      return "lm-badge lm-badge-chat";
    }
    const normalized = status.toLowerCase();
    if (normalized === "done" || normalized === "completed") {
      return "lm-badge lm-badge-done";
    }
    if (normalized === "running" || normalized === "processing") {
      return "lm-badge lm-badge-running";
    }
    if (normalized === "error" || normalized === "failed") {
      return "lm-badge lm-badge-error";
    }
    return "lm-badge";
  }

  function historyBadgeClass(kind: string, taskRecordKind?: string, status?: string): string {
    if (kind === "draft") {
      return "lm-badge lm-badge-draft";
    }
    if (taskRecordKind === "agent.instruction") {
      return "lm-badge lm-badge-chat";
    }
    if (status) {
      return taskBadgeClass(status);
    }
    return "lm-badge";
  }

  const selectedAssistant = assistants.find((a) => a.assistantId === selectedAssistantId);
  const selectedAssistantStats = selectedAssistant?.stats;
  const projectDir = config?.projectDir ?? null;
  const workspaceLabel =
    config?.workspaceDir.split(/[\\/]/).filter(Boolean).pop() ?? "默认工作区";
  const retrievalLabel = config?.retrievalMode === "dual" ? "通用 + 法律" : "统一模型";
  const currentMatterLabel = contextMatterId ?? detailTask?.matterId ?? detailDraft?.matterId ?? null;

  return (
    <div className="lm-shell">
      {showWizard && (
        <LawmindApiSetupWizard
          wizApiKey={wizApiKey}
          setWizApiKey={setWizApiKey}
          wizBaseUrl={wizBaseUrl}
          setWizBaseUrl={setWizBaseUrl}
          wizModel={wizModel}
          setWizModel={setWizModel}
          wizWorkspace={wizWorkspace}
          wizRetrievalMode={wizRetrievalMode}
          setWizRetrievalMode={setWizRetrievalMode}
          wizError={wizError}
          wizBusy={wizBusy}
          onPickWorkspace={() => void pickWs()}
          onCancel={() => setShowWizard(false)}
          onSave={() => void runWizardSave()}
        />
      )}
      {detailOpen && (
        <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="任务或草稿详情">
          <div className="lm-wizard" style={{ maxWidth: 560 }}>
            <h2>
              {detailKind === "task" ? "任务详情" : "草稿详情"}
              {detailId ? (
                <span className="lm-meta" style={{ marginLeft: 8 }}>
                  — {detailId}
                </span>
              ) : null}
            </h2>
            {detailLoading && <div className="lm-meta">加载中…</div>}
            {detailError && <div className="lm-error">{detailError}</div>}
            {!detailLoading && detailTask && (
              <div className="lm-detail-body">
                {detailTask.title && (
                  <div className="lm-detail-kv">
                    <span>任务名称</span>
                    {detailTask.title}
                  </div>
                )}
                <div className="lm-detail-kv">
                  <span>{detailTask.kind === "agent.instruction" ? "用户指令" : "摘要"}</span>
                  {detailTask.summary}
                </div>
                <div className="lm-detail-kv">
                  <span>状态</span>
                  {detailTask.kind === "agent.instruction" ? "对话" : detailTask.status}
                </div>
                {detailTask.matterId && (
                  <div className="lm-detail-kv">
                    <span>案件 matterId</span>
                    {detailTask.matterId}
                  </div>
                )}
                <div className="lm-detail-kv">
                  <span>类型 kind</span>
                  {detailTask.kind}
                </div>
                {detailTask.sessionId && (
                  <div className="lm-detail-kv">
                    <span>会话 sessionId</span>
                    {detailTask.sessionId}
                  </div>
                )}
                {detailTask.outputPath && (
                  <div className="lm-detail-kv">
                    <span>交付路径 outputPath</span>
                    {detailTask.outputPath}
                  </div>
                )}
                {detailTask.assistantId && (
                  <div className="lm-detail-kv">
                    <span>助手</span>
                    {detailTask.assistantId}
                  </div>
                )}
                <div className="lm-detail-kv">
                  <span>创建时间</span>
                  {formatLocaleDateTime(detailTask.createdAt)}
                </div>
                <div className="lm-detail-kv">
                  <span>更新时间</span>
                  {formatLocaleDateTime(detailTask.updatedAt)}
                </div>
                <LawmindTaskCheckpoints checkpoints={detailCheckpoints} />
              </div>
            )}
            {!detailLoading && detailDraft && (
              <div className="lm-detail-body">
                <LawmindCitationBanner view={detailCitationIntegrity} />
                <div className="lm-detail-kv">
                  <span>标题</span>
                  {detailDraft.title}
                </div>
                {detailDraft.matterId && (
                  <div className="lm-detail-kv">
                    <span>案件 matterId</span>
                    {detailDraft.matterId}
                  </div>
                )}
                <div className="lm-detail-kv">
                  <span>审核</span>
                  {detailDraft.reviewStatus}
                </div>
                {detailDraft.outputPath && (
                  <div className="lm-detail-kv">
                    <span>交付路径</span>
                    {detailDraft.outputPath}
                  </div>
                )}
                <div className="lm-detail-kv">
                  <span>摘要</span>
                  {detailDraft.summary}
                </div>
              </div>
            )}
            <div className="lm-wizard-actions" style={{ flexWrap: "wrap", gap: 8 }}>
              {(() => {
                const out = detailTask?.outputPath ?? detailDraft?.outputPath;
                const rel = artifactApiRelFromOutput(out);
                const showPreview = Boolean(rel);
                const showFolder = Boolean(out && canUseFilesystemBridge);
                return (
                  <>
                    {showPreview && (
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary"
                        onClick={() => previewArtifact(out)}
                      >
                        预览交付物
                      </button>
                    )}
                    {showFolder && (
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary"
                        onClick={() => openOutputInFolder(out)}
                      >
                        在文件夹中显示
                      </button>
                    )}
                  </>
                );
              })()}
              {(detailTask || detailDraft) && (
                <button
                  type="button"
                  className="lm-btn"
                  onClick={() => {
                    if (detailTask) {
                      setContextTaskId(detailTask.taskId);
                      setContextMatterId(detailTask.matterId ?? null);
                    } else if (detailDraft) {
                      setContextTaskId(detailDraft.taskId);
                      setContextMatterId(detailDraft.matterId ?? null);
                    }
                    closeDetail();
                  }}
                >
                  用此任务上下文继续
                </button>
              )}
              <button type="button" className="lm-btn lm-btn-secondary" onClick={closeDetail}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {showAssistantEditor && (
        <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="助手编辑">
          <div className="lm-wizard">
            <h2>{editingAssistantId === null ? "新建助手" : "编辑助手"}</h2>
            <p className="lm-meta">设置名称、简介与岗位；岗位可套用内置预设并补充说明。</p>
            <label className="lm-field">
              <span>显示名称</span>
              <input
                type="text"
                value={asstDisplayName}
                onChange={(e) => setAsstDisplayName(e.target.value)}
              />
            </label>
            <label className="lm-field">
              <span>简介</span>
              <textarea
                rows={3}
                value={asstIntroduction}
                onChange={(e) => setAsstIntroduction(e.target.value)}
                placeholder="助手自我介绍，会写入系统提示"
              />
            </label>
            <label className="lm-field">
              <span>岗位预设</span>
              <select
                value={asstPresetKey}
                onChange={(e) => setAsstPresetKey(e.target.value)}
              >
                {(presets.length > 0
                  ? presets
                  : [{ id: "general_default", displayName: "通用法律助理" }]
                ).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="lm-field">
              <span>自定义岗位标题（可选）</span>
              <input
                type="text"
                value={asstCustomTitle}
                onChange={(e) => setAsstCustomTitle(e.target.value)}
                placeholder="覆盖预设展示名"
              />
            </label>
            <label className="lm-field">
              <span>岗位补充说明（可选）</span>
              <textarea
                rows={4}
                value={asstCustomInstr}
                onChange={(e) => setAsstCustomInstr(e.target.value)}
                placeholder="工作方式、输出风格等"
              />
            </label>
            {asstError && <div className="lm-error">{asstError}</div>}
            <div className="lm-wizard-actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary"
                onClick={() => setShowAssistantEditor(false)}
                disabled={asstBusy}
              >
                取消
              </button>
              <button
                type="button"
                className="lm-btn"
                disabled={asstBusy || !asstDisplayName.trim()}
                onClick={() => void saveAssistant()}
              >
                {asstBusy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showSettings && (
        <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="设置">
          <div className="lm-wizard lm-settings-panel">
            <div className="lm-settings-header">
              <h2>设置</h2>
              <button
                type="button"
                className="lm-settings-close"
                onClick={() => setShowSettings(false)}
                aria-label="关闭设置"
              >
                ×
              </button>
            </div>

            {config && <LawmindSettingsOnboarding health={health} projectDir={projectDir} />}

            {config && <LawmindSettingsCollaboration collabSummarySettings={collabSummarySettings} />}

            <LawmindSettingsAssistants
              assistants={assistants}
              selectedAssistantId={selectedAssistantId}
              onSelectAssistantId={setSelectedAssistantId}
              selectedAssistant={selectedAssistant}
              selectedAssistantStats={selectedAssistantStats}
              onOpenNew={openNewAssistant}
              onOpenEdit={openEditAssistant}
              onRemove={() => void removeAssistant()}
            />

            {config && (
              <LawmindSettingsModelRetrieval
                config={{
                  workspaceDir: config.workspaceDir,
                  projectDir: config.projectDir,
                  retrievalMode: config.retrievalMode,
                }}
                health={health}
                retrievalLabel={retrievalLabel}
                retrievalSaving={retrievalSaving}
                applyRetrievalMode={applyRetrievalMode}
                onOpenApiWizard={() => {
                  setWizRetrievalMode(config.retrievalMode);
                  setShowWizard(true);
                  setShowSettings(false);
                }}
              />
            )}

            {config && (
              <LawmindSettingsWorkspace
                config={{
                  workspaceDir: config.workspaceDir,
                  projectDir: config.projectDir,
                  retrievalMode: config.retrievalMode,
                }}
                workspaceLabel={workspaceLabel}
                projectDir={projectDir}
                onPickProject={() => void pickProject()}
                onClearProject={() => {
                  void (async () => {
                    const bridge = window.lawmindDesktop;
                    if (!bridge?.setProjectDir || !config) {
                      return;
                    }
                    const res = await bridge.setProjectDir(null);
                    if (!res.ok) {
                      setError(res.error || "关闭项目失败");
                      return;
                    }
                    setConfig({ ...config, projectDir: null });
                  })();
                }}
              />
            )}
            <LawmindSettingsDisclaimer />
          </div>
        </div>
      )}
      <aside className="lm-side">
        <div className="lm-brand">
          <div className="lm-logo-mark">L</div>
          <div className="lm-brand-copy">
            <div className="lm-brand-title">LawMind</div>
            <div className="lm-brand-subtitle">Legal Workbench</div>
          </div>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={() => setShowHelp(true)}
            aria-label="帮助"
            title="帮助"
          >
            ?
          </button>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={() => setShowSettings(true)}
            aria-label="设置"
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6.5.75h3l.3 1.77a5.5 5.5 0 0 1 1.28.74l1.72-.58 1.5 2.6-1.42 1.19a5.6 5.6 0 0 1 0 1.06l1.42 1.19-1.5 2.6-1.72-.58a5.5 5.5 0 0 1-1.28.74l-.3 1.77h-3l-.3-1.77a5.5 5.5 0 0 1-1.28-.74l-1.72.58-1.5-2.6 1.42-1.19a5.6 5.6 0 0 1 0-1.06L1.7 5.28l1.5-2.6 1.72.58a5.5 5.5 0 0 1 1.28-.74L6.5.75Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        </div>
        <div className="lm-side-scroll">
          {config && assistants.length > 1 && (
            <div className="lm-side-asst-row">
              <select
                className="lm-asst-select"
                value={selectedAssistantId}
                onChange={(e) => setSelectedAssistantId(e.target.value)}
              >
                {assistants.map((a) => (
                  <option key={a.assistantId} value={a.assistantId}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {projectDir && (
            <div className="lm-side-project-pill" title={projectDir}>
              <span className="lm-side-project-icon">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3.88a1.5 1.5 0 0 1 1.06.44l.62.62a1.5 1.5 0 0 0 1.06.44H12.5A1.5 1.5 0 0 1 14 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              </span>
              <span className="lm-side-project-name">
                {projectDir.split(/[\\/]/).filter(Boolean).pop()}
              </span>
            </div>
          )}

          <button
            type="button"
            className="lm-section-toggle"
            onClick={() => setRecordsExpanded((v) => !v)}
            aria-expanded={recordsExpanded}
          >
            <span className={`lm-section-arrow ${recordsExpanded ? "lm-section-arrow-open" : ""}`}>
              ›
            </span>
            <span className="lm-section-label">
              工作记录
              <span className="lm-section-count">
                {filteredTasks.length + filteredHistory.length}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="lm-section-toggle"
            onClick={() => setCollabExpanded((v) => !v)}
            aria-expanded={collabExpanded}
          >
            <span className={`lm-section-arrow ${collabExpanded ? "lm-section-arrow-open" : ""}`}>
              ›
            </span>
            <span className="lm-section-label">
              助手协作
              <span className="lm-section-count">
                {delegations.filter((d) => d.status === "running" || d.status === "pending").length}
              </span>
            </span>
          </button>
          {collabExpanded && (
            <div className="lm-records-body">
              <div className="lm-tabs">
                <button
                  type="button"
                  className={`lm-tab ${collabTab === "delegations" ? "active" : ""}`}
                  onClick={() => setCollabTab("delegations")}
                >
                  委派任务
                </button>
                <button
                  type="button"
                  className={`lm-tab ${collabTab === "timeline" ? "active" : ""}`}
                  onClick={() => setCollabTab("timeline")}
                >
                  协作动态
                </button>
              </div>
              {collabTab === "delegations" && (
                <ul className="lm-list">
                  {delegations.length === 0 && (
                    <li className="lm-list-empty">暂无委派任务</li>
                  )}
                  {delegations.map((d) => (
                    <li key={d.delegationId} className="lm-list-clickable" tabIndex={0}>
                      <div className="lm-list-row">
                        <span className={`lm-badge ${
                          d.status === "completed" ? "lm-badge-done" :
                          d.status === "running" ? "lm-badge-running" :
                          d.status === "failed" || d.status === "timeout" ? "lm-badge-error" :
                          ""
                        }`}>
                          {d.status === "completed" ? "已完成" :
                           d.status === "running" ? "进行中" :
                           d.status === "failed" ? "失败" :
                           d.status === "timeout" ? "超时" :
                           d.status === "pending" ? "等待中" :
                           d.status === "cancelled" ? "已取消" : d.status}
                        </span>
                        <span className="lm-list-title">{d.task.slice(0, 80)}</span>
                      </div>
                      <div className="lm-list-time">
                        {d.fromAssistant} → {d.toAssistant}
                        {" · "}
                        {formatRelativeTime(d.startedAt)}
                      </div>
                      {d.error && (
                        <div className="lm-list-path" style={{ color: "var(--danger, #e74c3c)" }}>
                          {d.error}
                        </div>
                      )}
                      {d.result && (
                        <div className="lm-list-path">
                          {d.result.slice(0, 100)}{d.result.length > 100 ? "…" : ""}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {collabTab === "timeline" && (
                <ul className="lm-list">
                  {collabEvents.length === 0 && (
                    <li className="lm-list-empty">暂无协作动态</li>
                  )}
                  {[...collabEvents].toReversed().slice(0, 30).map((e: CollabEvent) => (
                    <li key={e.eventId}>
                      <div className="lm-list-row">
                        <span className="lm-badge">
                          {e.kind.split(".").pop()}
                        </span>
                        <span className="lm-list-title">
                          {e.fromAssistantId} → {e.toAssistantId}
                        </span>
                      </div>
                      <div className="lm-list-time">
                        {e.detail?.slice(0, 80)}
                        {" · "}
                        {formatRelativeTime(e.timestamp)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {recordsExpanded && (
            <div className="lm-records-body">
              <div className="lm-sidebar-filters">
                <input
                  type="search"
                  className="lm-sidebar-search"
                  placeholder="搜索任务、交付物或案件…"
                  value={taskListQuery}
                  onChange={(e) => setTaskListQuery(e.target.value)}
                  aria-label="搜索任务与历史"
                />
                <select
                  className="lm-sidebar-range"
                  value={listTimeRange}
                  onChange={(e) => setListTimeRange(e.target.value as TimeRangeFilter)}
                  aria-label="时间范围"
                >
                  <option value="all">全部</option>
                  <option value="today">今天</option>
                  <option value="7d">7天</option>
                  <option value="30d">30天</option>
                </select>
              </div>
              <div className="lm-tabs">
                <button
                  type="button"
                  className={`lm-tab ${sideTab === "tasks" ? "active" : ""}`}
                  onClick={() => setSideTab("tasks")}
                >
                  任务
                </button>
                <button
                  type="button"
                  className={`lm-tab ${sideTab === "history" ? "active" : ""}`}
                  onClick={() => setSideTab("history")}
                >
                  交付
                </button>
              </div>
              {sideTab === "tasks" && (
                <ul className="lm-list">
                  {filteredTasks.length === 0 && <li className="lm-list-empty">暂无任务记录</li>}
                  {filteredTasks.map((t) => {
                    const headline = (t.title?.trim() ? t.title : t.summary).slice(0, 100);
                    return (
                      <li
                        key={t.taskId}
                        className="lm-list-clickable"
                        tabIndex={0}
                        onClick={() => void openDetail("task", t.taskId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void openDetail("task", t.taskId);
                          }
                        }}
                      >
                        <div className="lm-list-row">
                          <span className={taskBadgeClass(t.status, t.kind)}>
                            {legalStatusLabel(t.status, t.kind)}
                          </span>
                          <span className="lm-list-title">{headline}</span>
                          {t.matterId && <span className="lm-matter-badge">{t.matterId}</span>}
                        </div>
                        <div className="lm-list-time">{formatRelativeTime(t.updatedAt)}</div>
                        {t.outputPath && <div className="lm-list-path">{t.outputPath}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {sideTab === "history" && (
                <ul className="lm-list">
                  {filteredHistory.length === 0 && <li className="lm-list-empty">暂无历史</li>}
                  {filteredHistory.map((h) => (
                    <li
                      key={`${h.kind}-${h.id}`}
                      className="lm-list-clickable"
                      tabIndex={0}
                      onClick={() => void openDetail(h.kind, h.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openDetail(h.kind, h.id);
                        }
                      }}
                    >
                      <div className="lm-list-row">
                        <span className={historyBadgeClass(h.kind, h.taskRecordKind, h.status)}>
                          {legalStatusLabel(h.status ?? h.kind, h.taskRecordKind)}
                        </span>
                        <span className="lm-list-title">{h.label}</span>
                        {h.matterId && <span className="lm-matter-badge">{h.matterId}</span>}
                      </div>
                      <div className="lm-list-time">{formatRelativeTime(h.updatedAt)}</div>
                      {h.outputPath && <div className="lm-list-path">{h.outputPath}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
      <main className="lm-main">
        <div className="lm-main-header">
          <div>
            <div className="lm-main-eyebrow">法律工作台</div>
            <div className="lm-main-title">{selectedAssistant?.displayName ?? "LawMind"}</div>
            <div className="lm-main-subtitle">
              {selectedAssistant?.introduction?.trim() || "起草文书、法规检索、合同审查与案件跟进。"}
            </div>
          </div>
          <div className="lm-header-spacer" />
          <div className="lm-tabs lm-main-nav-tabs" style={{ marginBottom: 0, minWidth: 280 }}>
            <button
              type="button"
              className={`lm-tab ${mainView === "chat" ? "active" : ""}`}
              onClick={() => setMainView("chat")}
            >
              对话
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "files" ? "active" : ""}`}
              onClick={() => setMainView("files")}
            >
              文件
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "matters" ? "active" : ""}`}
              onClick={() => setMainView("matters")}
            >
              案件
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "review" ? "active" : ""}`}
              onClick={() => setMainView("review")}
            >
              审核
            </button>
          </div>
          {projectDir && (
            <div className="lm-header-meta lm-header-project" title={projectDir}>
              {projectDir.split(/[\\/]/).filter(Boolean).pop()}
            </div>
          )}
          {currentMatterLabel && <div className="lm-header-meta">案件 {currentMatterLabel}</div>}
        </div>
        {mainView === "files" ? (
          <FileWorkbench
            workspaceDir={config?.workspaceDir ?? ""}
            projectDir={projectDir}
            canUseFilesystemBridge={canUseFilesystemBridge}
          />
        ) : mainView === "matters" && config ? (
          <div className="lm-main-workbench">
            <MatterWorkbench
              apiBase={config.apiBase}
              onUseInChat={(matterId) => {
                setContextMatterId(matterId);
                setMainView("chat");
              }}
            />
          </div>
        ) : mainView === "review" && config ? (
          <div className="lm-main-workbench">
            <ReviewWorkbench
              apiBase={config.apiBase}
              assistantId={selectedAssistantId}
              onShowArtifact={(relPath) => openOutputInFolder(relPath)}
              onRecordsChanged={() => void refreshLists()}
            />
          </div>
        ) : (
          <>
        <div className="lm-messages">
          {currentMessages.length === 0 ? (
            <div className="lm-messages-empty">
              <div className="lm-messages-empty-icon">L</div>
              <div className="lm-messages-empty-title">有什么可以帮您？</div>
              <div className="lm-messages-empty-hint">
                描述您的需求，我来协助起草、检索或分析。
              </div>
              <div className="lm-scenario-cards">
                {SCENARIO_CARDS.map((card) => (
                  <button
                    key={card.title}
                    type="button"
                    className="lm-scenario-card"
                    onClick={() => {
                      setInput(card.prompt);
                      textareaRef.current?.focus();
                    }}
                  >
                    <span className="lm-scenario-title">{card.title}</span>
                    <span className="lm-scenario-hint">{card.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            currentMessages.map((msg, i) => (
              <div
                key={`${i}-${msg.role}`}
                className={`lm-msg-row ${msg.role === "user" ? "lm-msg-row-user" : ""}`}
              >
                <div
                  className={`lm-msg-avatar ${
                    msg.role === "user" ? "lm-msg-avatar-user" : "lm-msg-avatar-ai"
                  }`}
                >
                  {msg.role === "user" ? "我" : "LM"}
                </div>
                <div className={`lm-msg-wrap ${msg.role === "user" ? "lm-msg-wrap-user" : ""}`}>
                  <div className={`lm-msg ${msg.role === "user" ? "lm-msg-user" : "lm-msg-ai"}`}>
                    {msg.role === "assistant" ? renderLegalMarkdown(msg.text) : msg.text}
                  </div>
                  {msg.role === "assistant" && (
                    <button
                      type="button"
                      className="lm-msg-copy-btn"
                      onClick={() => void copyMessage(msg.text, i)}
                    >
                      {copiedMessageIndex === i ? "已复制 ✓" : "复制"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="lm-compose">
          {error && <div className="lm-error">{error}</div>}
          {contextTaskId && (
            <div className="lm-context-banner">
              <span>
                当前上下文：任务 <strong>{contextTaskId}</strong>
                {contextMatterId ? (
                  <>
                    {" "}
                    · 案件 <strong>{contextMatterId}</strong>
                  </>
                ) : null}
              </span>
              <button
                type="button"
                className="lm-btn lm-btn-secondary"
                onClick={() => {
                  setContextTaskId(null);
                  setContextMatterId(null);
                }}
              >
                清除
              </button>
            </div>
          )}
          <div className="lm-chip-row">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                className="lm-chip"
                onClick={() => {
                  setInput(action.prompt);
                  textareaRef.current?.focus();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="lm-compose-box">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="描述您的法律需求…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="lm-compose-footer">
              <label
                className="lm-web-toggle"
                title="勾选后本轮对话注册 web_search 工具（Brave Search API），与聊天模型配置独立"
              >
                <input
                  type="checkbox"
                  checked={allowWebSearch}
                  onChange={(e) => setAllowWebSearch(e.target.checked)}
                />
                <span>
                  联网检索
                  {health && health.webSearchApiKeyConfigured === false && (
                    <span style={{ color: "var(--warn)" }}> — 未配置 API Key</span>
                  )}
                </span>
              </label>
              <div className="lm-compose-actions">
                <span className="lm-send-hint">⌘↵</span>
                <button
                  type="button"
                  className="lm-btn"
                  disabled={loading || !input.trim()}
                  onClick={() => void send()}
                >
                  {loading ? "处理中…" : "发送"}
                </button>
              </div>
            </div>
          </div>
        </div>
          </>
        )}
      </main>
    </div>
  );
}
