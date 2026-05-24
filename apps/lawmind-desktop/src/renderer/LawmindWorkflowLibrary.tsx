import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PRACTICE_AREA_LABELS, PRACTICE_PERSONAS } from "../../../../src/lawmind/core/practice-personas.ts";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

export type WorkflowTemplateItem = {
  id: string;
  name: string;
  namedAgent?: string;
  description: string;
  stepCount: number;
  practiceArea?: string;
  deliverableType?: string;
  riskLevel?: string;
  starterPrompt?: string;
  acceptancePackRequired?: boolean;
  requiredSources?: string[];
  schedulable?: boolean;
};

type Props = {
  apiBase: string;
  matterId?: string | null;
  onApplyStarterPrompt?: (prompt: string) => void;
  onWorkflowStarted?: () => void;
  compact?: boolean;
};

const PRACTICE_LABELS: Record<string, string> = { ...PRACTICE_AREA_LABELS };

export function LawmindWorkflowLibrary(props: Props): ReactNode {
  const { apiBase, matterId, onApplyStarterPrompt, onWorkflowStarted, compact = false } = props;
  const [templates, setTemplates] = useState<WorkflowTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [practiceFilter, setPracticeFilter] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    setLoading(true);
    void apiGetJson<{ ok?: boolean; templates?: WorkflowTemplateItem[] }>(
      apiBase,
      "/api/collaboration/workflow-templates",
    )
      .then((r) => setTemplates(r.templates ?? []))
      .catch((e) => setError(errorMessage(e, "无法加载工作流")))
      .finally(() => setLoading(false));
  }, [apiBase]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const persona = practiceFilter
      ? PRACTICE_PERSONAS.find((p) => p.id === practiceFilter)
      : undefined;
    return templates.filter((t) => {
      if (practiceFilter) {
        const areaMatch = t.practiceArea === practiceFilter;
        const idMatch = persona?.suggestedWorkflowIds.includes(t.id);
        if (!areaMatch && !idMatch) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.deliverableType ?? "").toLowerCase().includes(q)
      );
    });
  }, [templates, filter, practiceFilter]);

  const runWorkflow = async (id: string) => {
    if (!matterId?.trim()) {
      setError("请先选择或创建案件后再运行工作流。");
      return;
    }
    setRunningId(id);
    setError(null);
    try {
      await apiSendJson(apiBase, "/api/collaboration/workflow-run", "POST", {
        templateId: id,
        matterId: matterId.trim(),
        async: true,
      });
      onWorkflowStarted?.();
    } catch (e) {
      setError(errorMessage(e, "启动工作流失败"));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <section className={`lm-workflow-library${compact ? " lm-workflow-library-compact" : ""}`}>
      <div className="lm-workflow-library-toolbar">
        <input
          type="search"
          className="lm-input"
          placeholder="搜索工作流…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="搜索工作流"
        />
        <select
          className="lm-compose-select"
          value={practiceFilter}
          onChange={(e) => setPracticeFilter(e.target.value)}
          aria-label="业务领域"
        >
          <option value="">全部领域</option>
          {PRACTICE_PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {loading ? <p className="lm-meta">加载工作流…</p> : null}
      {error ? <p className="lm-error">{error}</p> : null}
      {filtered.length === 0 && !loading ? (
        <p className="lm-meta">暂无匹配的工作流。可在工作区 `lawmind/workflows/` 添加 JSON 模板。</p>
      ) : (
        <ul className="lm-workflow-library-grid">
          {filtered.map((t) => (
            <li key={t.id} className="lm-workflow-card">
              <h4>{t.name}</h4>
              {t.namedAgent ? (
                <p className="lm-meta lm-workflow-named-agent">岗位：{t.namedAgent}</p>
              ) : null}
              <p className="lm-meta">{t.description}</p>
              <div className="lm-workflow-card-tags">
                {t.practiceArea ? (
                  <span className="lm-tag">{PRACTICE_LABELS[t.practiceArea] ?? t.practiceArea}</span>
                ) : null}
                {t.deliverableType ? <span className="lm-tag">{t.deliverableType}</span> : null}
                {t.riskLevel ? <span className="lm-tag">{t.riskLevel}</span> : null}
                {t.acceptancePackRequired ? (
                  <span className="lm-tag lm-tag-warn">需验收包</span>
                ) : null}
                {(t.requiredSources?.length ?? 0) > 0 ? (
                  <span className="lm-tag">需来源 {t.requiredSources!.length}</span>
                ) : null}
                <span className="lm-tag">{t.stepCount} 步</span>
                {t.schedulable ? (
                  <span className="lm-tag" title="协作运行时可传 scheduleRunAt 预约执行">
                    可预约执行
                  </span>
                ) : null}
              </div>
              <div className="lm-workflow-card-actions">
                {t.starterPrompt && onApplyStarterPrompt ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    onClick={() => onApplyStarterPrompt(t.starterPrompt!)}
                  >
                    带入对话
                  </button>
                ) : null}
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  disabled={runningId === t.id}
                  onClick={() => void runWorkflow(t.id)}
                >
                  {runningId === t.id ? "启动中…" : "在本案件运行"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
