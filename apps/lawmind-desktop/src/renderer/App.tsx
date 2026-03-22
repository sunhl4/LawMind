import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArtifactDraft, TaskRecord } from "../../../../src/lawmind/types.ts";

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
};

type ChatMsg = { role: "user" | "assistant"; text: string };

type AssistantStats = {
  lastUsedAt: string;
  turnCount: number;
  sessionCount: number;
};

type AssistantRow = {
  assistantId: string;
  displayName: string;
  introduction: string;
  presetKey?: string;
  customRoleTitle?: string;
  customRoleInstructions?: string;
  createdAt: string;
  updatedAt: string;
  stats?: AssistantStats;
};

type PresetRow = { id: string; displayName: string; promptSection: string };

const DEFAULT_ASSISTANT_ID = "default";

export function App() {
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
  const [contextTaskId, setContextTaskId] = useState<string | null>(null);
  const [contextMatterId, setContextMatterId] = useState<string | null>(null);

  const currentMessages = messagesByAssistant[selectedAssistantId] ?? [];

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
        };
        if (!r.ok || !j.ok) {
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        if (kind === "task" && j.task) {
          setDetailTask(j.task);
        } else if (kind === "draft" && j.draft) {
          setDetailDraft(j.draft);
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
    return tasks.filter((t) => {
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
  }, [tasks, taskListQuery, listTimeRange]);

  const filteredHistory = useMemo(() => {
    const q = taskListQuery.trim().toLowerCase();
    const start = rangeStartMs(listTimeRange);
    return history.filter((h) => {
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
  }, [history, taskListQuery, listTimeRange]);

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
          envFilePath: c.envFilePath,
          retrievalMode: rm,
        });
        setWizRetrievalMode(rm);
        return;
      }
      const devApi = (import.meta.env.VITE_LAWMIND_DEV_API as string | undefined)?.trim();
      if (import.meta.env.DEV && devApi) {
        setConfig({
          apiBase: devApi.replace(/\/$/, ""),
          workspaceDir: "(browser dev — use Electron for full config)",
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [config, refreshLists, refreshAssistants]);

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
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        sessionId?: string;
        reply?: string;
      };
      if (!r.ok || !j.ok) {
        throw new Error(j.detail || j.error || `HTTP ${r.status}`);
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

  return (
    <div className="lm-shell">
      {showWizard && (
        <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="LawMind 首次配置">
          <div className="lm-wizard">
            <h2>欢迎使用 LawMind</h2>
            <p className="lm-meta">请配置模型 API（写入用户目录下的 .env.lawmind），可选自定义工作区路径。</p>
            <label className="lm-field">
              <span>API Key</span>
              <input
                type="password"
                autoComplete="off"
                value={wizApiKey}
                onChange={(e) => setWizApiKey(e.target.value)}
                placeholder="LAWMIND / Qwen 等"
              />
            </label>
            <label className="lm-field">
              <span>Base URL（可选）</span>
              <input
                type="text"
                value={wizBaseUrl}
                onChange={(e) => setWizBaseUrl(e.target.value)}
                placeholder="OpenAI-compatible /v1"
              />
            </label>
            <label className="lm-field">
              <span>模型名（可选）</span>
              <input
                type="text"
                value={wizModel}
                onChange={(e) => setWizModel(e.target.value)}
              />
            </label>
            <label className="lm-field">
              <span>工作区目录（可选）</span>
              <div className="lm-wizard-row">
                <input
                  type="text"
                  readOnly
                  value={wizWorkspace}
                  placeholder="默认：用户数据/LawMind/workspace"
                />
                <button type="button" className="lm-btn lm-btn-secondary" onClick={() => void pickWs()}>
                  浏览…
                </button>
              </div>
            </label>
            <fieldset className="lm-field" style={{ border: "none", padding: 0, margin: 0 }}>
              <legend className="lm-meta" style={{ marginBottom: 8 }}>
                检索策略（引擎工具 research / 工作流）
              </legend>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <input
                  type="radio"
                  name="wiz-retrieval"
                  checked={wizRetrievalMode === "single"}
                  onChange={() => setWizRetrievalMode("single")}
                />
                <span>统一模型 — 通用与法律检索用同一套 API</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input
                  type="radio"
                  name="wiz-retrieval"
                  checked={wizRetrievalMode === "dual"}
                  onChange={() => setWizRetrievalMode("dual")}
                />
                <span>
                  通用 + 法律专用 — 通用用上方 Key；法律检索需在{" "}
                  <code>.env.lawmind</code> 配置{" "}
                  <code>LAWMIND_CHATLAW_*</code> / <code>LAWMIND_LAWGPT_*</code> 等（未配时仍回退为通用模型）。
                </span>
              </label>
            </fieldset>
            {wizError && <div className="lm-error">{wizError}</div>}
            <div className="lm-wizard-actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary"
                onClick={() => setShowWizard(false)}
                disabled={wizBusy}
              >
                稍后
              </button>
              <button
                type="button"
                className="lm-btn"
                disabled={wizBusy || !wizApiKey.trim()}
                onClick={() => void runWizardSave()}
              >
                {wizBusy ? "保存中…" : "保存并重启服务"}
              </button>
            </div>
          </div>
        </div>
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
              </div>
            )}
            {!detailLoading && detailDraft && (
              <div className="lm-detail-body">
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
      <aside className="lm-side">
        <div className="lm-header">LawMind</div>
        {config && assistants.length > 0 && (
          <div className="lm-meta" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>助手</div>
            <label className="lm-field" style={{ marginBottom: 8 }}>
              <span>当前助手</span>
              <select
                value={selectedAssistantId}
                onChange={(e) => setSelectedAssistantId(e.target.value)}
              >
                {assistants.map((a) => (
                  <option key={a.assistantId} value={a.assistantId}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const cur = assistants.find((a) => a.assistantId === selectedAssistantId);
              const st = cur?.stats;
              return (
                <div className="lm-meta" style={{ marginBottom: 8 }}>
                  {cur?.presetKey && <div>岗位预设: {cur.presetKey}</div>}
                  {st && (
                    <>
                      <div>对话轮次: {st.turnCount}</div>
                      <div>会话数: {st.sessionCount}</div>
                      {st.lastUsedAt && <div>最近使用: {st.lastUsedAt}</div>}
                    </>
                  )}
                </div>
              );
            })()}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" className="lm-btn lm-btn-secondary" onClick={openNewAssistant}>
                新建助手
              </button>
              <button type="button" className="lm-btn lm-btn-secondary" onClick={openEditAssistant}>
                编辑
              </button>
              {selectedAssistantId !== DEFAULT_ASSISTANT_ID && (
                <button type="button" className="lm-btn lm-btn-secondary" onClick={() => void removeAssistant()}>
                  删除
                </button>
              )}
            </div>
          </div>
        )}
        {config && (
          <div className="lm-meta">
            Workspace: {config.workspaceDir}
            <br />
            配置: {config.envFilePath}
            <br />
            {health && (
              <>
                模型:{" "}
                {health.modelConfigured ? (
                  <span style={{ color: "var(--ok)" }}>已配置</span>
                ) : (
                  <span style={{ color: "var(--warn)" }}>
                    未配置 API Key（请编辑 .env.lawmind）
                  </span>
                )}
                <div style={{ marginTop: 10 }}>
                  <div className="lm-meta" style={{ marginBottom: 6 }}>
                    检索模式: {config.retrievalMode === "dual" ? "通用 + 法律" : "统一模型"}
                    {config.retrievalMode === "dual" && health.dualLegalConfigured === false && (
                      <span style={{ color: "var(--warn)" }}>
                        {" "}
                        （尚未检测到法律专用端点，法务检索将用通用模型）
                      </span>
                    )}
                  </div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <input
                      type="radio"
                      name="retrieval-mode"
                      checked={config.retrievalMode === "single"}
                      disabled={retrievalSaving}
                      onChange={() => void applyRetrievalMode("single")}
                    />
                    <span>统一模型</span>
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                    <input
                      type="radio"
                      name="retrieval-mode"
                      checked={config.retrievalMode === "dual"}
                      disabled={retrievalSaving}
                      onChange={() => void applyRetrievalMode("dual")}
                    />
                    <span>通用 + 法律（需 .env 法律变量）</span>
                  </label>
                  {retrievalSaving && <div className="lm-meta">正在切换并重启服务…</div>}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="lm-tab active"
                    onClick={() => {
                      setWizRetrievalMode(config.retrievalMode);
                      setShowWizard(true);
                    }}
                  >
                    配置向导…
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <div className="lm-sidebar-filters">
          <input
            type="search"
            className="lm-sidebar-search"
            placeholder="搜索标题、指令、ID…"
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
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="7d">7 天</option>
            <option value="30d">30 天</option>
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
            历史与交付
          </button>
        </div>
        {sideTab === "tasks" && (
          <ul className="lm-list">
            {filteredTasks.length === 0 && <li>暂无任务记录</li>}
            {filteredTasks.map((t) => {
              const headline = (t.title?.trim() ? t.title : t.summary).slice(0, 100);
              const badge =
                t.kind === "agent.instruction" ? "对话" : t.status;
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="lm-badge">{badge}</span>
                    <span style={{ fontWeight: 600 }}>{headline}</span>
                  </div>
                  <div className="lm-meta" style={{ marginTop: 4 }}>
                    {formatLocaleDateTime(t.updatedAt)}
                  </div>
                  {t.outputPath && (
                    <div className="lm-meta" style={{ marginTop: 6 }}>
                      交付: {t.outputPath}
                    </div>
                  )}
                  {t.assistantId && (
                    <div className="lm-meta" style={{ marginTop: 4 }}>
                      助手: {t.assistantId}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {sideTab === "history" && (
          <ul className="lm-list">
            {filteredHistory.length === 0 && <li>暂无历史</li>}
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
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="lm-badge">{h.kind}</span>
                  {h.kind === "task" && h.taskRecordKind === "agent.instruction" && (
                    <span className="lm-badge">对话</span>
                  )}
                  <span style={{ fontWeight: 600 }}>{h.label}</span>
                </div>
                {h.status && h.kind === "draft" && (
                  <span className="lm-badge" style={{ marginLeft: 4 }}>
                    {h.status}
                  </span>
                )}
                <div className="lm-meta" style={{ marginTop: 4 }}>
                  {formatLocaleDateTime(h.updatedAt)}
                </div>
                {h.outputPath && (
                  <div className="lm-meta" style={{ marginTop: 6 }}>
                    {h.outputPath}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="lm-main">
        <div className="lm-header">
          AI 助理
          {assistants.find((a) => a.assistantId === selectedAssistantId)?.displayName && (
            <span className="lm-meta" style={{ marginLeft: 8 }}>
              — {assistants.find((a) => a.assistantId === selectedAssistantId)?.displayName}
            </span>
          )}
        </div>
        <div className="lm-messages">
          {currentMessages.length === 0 && (
            <div className="lm-meta">
              输入法律工作指令（如起草文书、合同审查、检索）。任务与交付物会出现在左侧。
            </div>
          )}
          {currentMessages.map((msg, i) => (
            <div
              key={`${i}-${msg.role}`}
              className={`lm-msg ${msg.role === "user" ? "lm-msg-user" : "lm-msg-ai"}`}
            >
              {msg.text}
            </div>
          ))}
        </div>
        <div className="lm-compose">
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
          <label className="lm-web-toggle" title="勾选后本轮对话注册 web_search 工具（Brave Search API），与聊天模型配置独立">
            <input
              type="checkbox"
              checked={allowWebSearch}
              onChange={(e) => setAllowWebSearch(e.target.checked)}
            />
            <span>
              允许联网检索（<code>web_search</code>，Brave Search API）
              {health && health.webSearchApiKeyConfigured === false && (
                <span style={{ color: "var(--warn)" }}>
                  {" "}
                  — 未检测到 <code>LAWMIND_WEB_SEARCH_API_KEY</code> / <code>BRAVE_API_KEY</code>
                </span>
              )}
            </span>
          </label>
          <div className="lm-compose-row">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="向 LawMind 下达任务…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="button" className="lm-btn" disabled={loading} onClick={() => void send()}>
              {loading ? "处理中…" : "发送"}
            </button>
          </div>
        </div>
        {error && <div className="lm-error">{error}</div>}
      </main>
    </div>
  );
}
