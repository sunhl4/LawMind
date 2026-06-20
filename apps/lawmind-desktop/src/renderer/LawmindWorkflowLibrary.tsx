import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PRACTICE_AREA_LABELS, PRACTICE_PERSONAS } from "../../../../src/lawmind/core/practice-personas.ts";
import { apiGetJson, errorMessage } from "./api-client";
import { apiPost } from "./lawmind-api-routes.ts";
import type { WorkflowRunRequest } from "./lawmind-api-request-types.ts";
import {
  sortWorkflowTemplatesForLawyer,
  workflowTemplateKindLabel,
} from "./lawmind-workflow-display";

import type { WorkflowTemplateKind } from "../../../../src/lawmind/agent/collaboration/workspace-workflow-template-kind.ts";

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
  kind?: WorkflowTemplateKind;
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
    const visible = templates.filter((t) => {
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
    return sortWorkflowTemplatesForLawyer(visible, { preferOffice: !matterId?.trim() });
  }, [templates, filter, practiceFilter, matterId]);

  const runWorkflow = async (id: string) => {
    if (!matterId?.trim()) {
      setError("请先选择或创建案件后再运行工作流。");
      return;
    }
    setRunningId(id);
    setError(null);
    try {
      const runBody: WorkflowRunRequest = {
        templateId: id,
        matterId: matterId.trim(),
        async: true,
      };
      await apiPost(apiBase, "/api/collaboration/workflow-run", runBody);
      onWorkflowStarted?.();
    } catch (e) {
      setError(errorMessage(e, "启动工作流失败"));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <section className={`lm-workflow-library${compact ? " lm-workflow-library-compact" : ""}`}>
      <div className="lm-workflow-library-intro">
        <strong>{matterId?.trim() ? "选择一件事开始办案" : "写文稿 / 做材料"}</strong>
        <p className="lm-meta">
          {matterId?.trim()
            ? "优先选择一个常用场景，LawMind 会在后台处理来源、验收和审计。"
            : "不需要先建案件。选择模板后会把清晰提示带入对话，你可以直接改要求、附材料、导出 Word 或 PPT。"}
        </p>
      </div>
      <div className="lm-workflow-library-toolbar">
        <input
          type="search"
          className="lm-input"
          placeholder={matterId?.trim() ? "搜索案件工作…" : "搜索文稿、PPT、报告…"}
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
          <option value="">全部</option>
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
            <li key={t.id} className="lm-workflow-card lm-workflow-card-harvey">
              <h4>{t.name}</h4>
              <p className="lm-meta lm-workflow-card-lead">{t.description}</p>
              <div className="lm-workflow-card-tags">
                <span className="lm-tag">{workflowTemplateKindLabel(t)}</span>
                {t.deliverableType ? (
                  <span className="lm-tag lm-tag-deliverable">{t.deliverableType}</span>
                ) : null}
                {t.practiceArea ? (
                  <span className="lm-tag">{PRACTICE_LABELS[t.practiceArea] ?? t.practiceArea}</span>
                ) : null}
                {t.acceptancePackRequired ? (
                  <span className="lm-tag lm-tag-warn">需验收包</span>
                ) : null}
              </div>
              <details className="lm-workflow-card-details">
                <summary>查看要求</summary>
                <div className="lm-meta">
                  {t.deliverableType ? <div>交付：{t.deliverableType}</div> : null}
                  {t.riskLevel ? <div>风险：{t.riskLevel}</div> : null}
                  {(t.requiredSources?.length ?? 0) > 0 ? (
                    <div>建议材料：{t.requiredSources!.join("、")}</div>
                  ) : null}
                  {t.namedAgent ? <div>后台岗位：{t.namedAgent}</div> : null}
                  <div>步骤：{t.stepCount}</div>
                </div>
              </details>
              <div className="lm-workflow-card-actions">
                {t.starterPrompt && onApplyStarterPrompt ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    onClick={() => onApplyStarterPrompt(t.starterPrompt!)}
                  >
                    {matterId?.trim() ? "先填入对话" : "开始写"}
                  </button>
                ) : null}
                {matterId?.trim() ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    disabled={runningId === t.id}
                    onClick={() => void runWorkflow(t.id)}
                  >
                    {runningId === t.id ? "启动中…" : "在本案件运行"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
