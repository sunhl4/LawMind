import { useMemo, useState, type ReactNode } from "react";
import {
  buildJobIntakeDispatchPrompt,
  defaultIntakeFieldsForDeliverable,
  type JobIntakeFieldDef,
} from "./lawmind-job-intake";
import {
  buildContractFastLanePrompt,
  CONTRACT_REVIEW_DEPTH_OPTIONS,
  CONTRACT_REVIEW_STANCE_OPTIONS,
  stanceIntakeValue,
  type ContractReviewDepth,
  type ContractReviewStance,
} from "./lawmind-contract-fast-lane";
import { appendCampaignUpgradeInstruction } from "../../../../src/lawmind/review-campaign/review-brief.ts";
import {
  apiPostTriageConfirm,
  apiPostTriagePreview,
  type TriageMatchedSkill,
} from "./lawmind-triage-api";
import type { TriageSession } from "../../../../src/lawmind/triage/types.ts";

export type JobIntakeTemplate = {
  id: string;
  name: string;
  description?: string;
  deliverableType?: string;
  intakeFields?: JobIntakeFieldDef[];
};

type Props = {
  template: JobIntakeTemplate;
  onCancel: () => void;
  /** Fill composer and close (lawyer may edit before send). Omit when host is not the chat surface. */
  onFillComposer?: (prompt: string) => void;
  /** Preferred: fill + send immediately as a structured job. */
  onDispatch?: (prompt: string) => void;
  /** Local API base for triage (Skills E1). When omitted, skips triage and dispatches directly. */
  apiBase?: string;
  matterId?: string | null;
  /** Solo preference: auto-confirm GREEN */
  skipGreenConfirm?: boolean;
};

type Step = "form" | "triage";

export function LawmindJobIntakeForm(props: Props): ReactNode {
  const {
    template,
    onCancel,
    onFillComposer,
    onDispatch,
    apiBase,
    matterId,
    skipGreenConfirm,
  } = props;
  const fields = useMemo(
    () =>
      template.intakeFields && template.intakeFields.length > 0
        ? template.intakeFields
        : defaultIntakeFieldsForDeliverable(template.deliverableType),
    [template.intakeFields, template.deliverableType],
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        if (f.key === "stance" && template.deliverableType === "contract.review") {
          return [f.key, "client"];
        }
        if (f.key === "depth" && template.deliverableType === "contract.review") {
          return [f.key, "standard"];
        }
        return [f.key, ""];
      }),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<TriageSession | null>(null);
  const [matchedSkills, setMatchedSkills] = useState<TriageMatchedSkill[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const missingRequired = fields.filter((f) => f.required && !values[f.key]?.trim());

  const isContractReview = template.deliverableType === "contract.review";

  const buildPrompt = (): string => {
    if (isContractReview) {
      const stance = (values.stance || "client") as ContractReviewStance;
      const depth = (values.depth || "standard") as ContractReviewDepth;
      return buildContractFastLanePrompt({
        materials: values.materials ?? "",
        focus: values.focus,
        stance: CONTRACT_REVIEW_STANCE_OPTIONS.some((o) => o.id === stance) ? stance : "client",
        depth: CONTRACT_REVIEW_DEPTH_OPTIONS.some((o) => o.id === depth) ? depth : "standard",
      });
    }
    return buildJobIntakeDispatchPrompt({
      templateName: template.name,
      deliverableType: template.deliverableType,
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        value: values[f.key] ?? "",
      })),
    });
  };

  const tryBuild = (): string | null => {
    if (missingRequired.length > 0) {
      setError(`请先填写：${missingRequired.map((f) => f.label).join("、")}`);
      return null;
    }
    setError(null);
    return buildPrompt();
  };

  const dispatchPrompt = (prompt: string) => {
    if (onDispatch) {
      onDispatch(prompt);
    } else {
      onFillComposer?.(prompt);
    }
  };

  const runTriageThenMaybeDispatch = async () => {
    const prompt = tryBuild();
    if (!prompt) {
      return;
    }
    if (!apiBase?.trim()) {
      dispatchPrompt(prompt);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await apiPostTriagePreview(apiBase, {
        text: prompt,
        matterId,
        deliverableTypeHint: template.deliverableType,
        skipGreenConfirm: skipGreenConfirm !== false,
        dispatchPrompt: prompt,
      });
      if (!j.ok || !j.session) {
        throw new Error(j.error ?? "分诊失败");
      }
      if (j.autoConfirmed || j.session.status === "confirmed") {
        dispatchPrompt(prompt);
        return;
      }
      setPendingPrompt(prompt);
      setSession(j.session);
      setMatchedSkills(Array.isArray(j.matchedSkills) ? j.matchedSkills : []);
      setAnswers({});
      setStep("triage");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmTriage = async (saveOnly: boolean, promptOverride?: string) => {
    const prompt = (promptOverride ?? pendingPrompt)?.trim() ?? "";
    if (!apiBase || !session || !prompt) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await apiPostTriageConfirm(apiBase, {
        sessionId: session.id,
        matterId: session.matterId,
        clarificationAnswers: answers,
        dispatchPrompt: prompt,
        saveOnly,
      });
      if (!j.ok || !j.session) {
        if (j.error === "missing_clarification") {
          throw new Error(`请先回答澄清项：${j.key ?? ""}`);
        }
        throw new Error(j.error ?? "确认分诊失败");
      }
      if (saveOnly) {
        onCancel();
        return;
      }
      dispatchPrompt(prompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "triage" && session) {
    const { result } = session;
    const effortLabel =
      result.estimatedEffort === "low"
        ? "约 15–30 分钟"
        : result.estimatedEffort === "high"
          ? "约 2–4 小时"
          : "约 45–90 分钟";
    return (
      <div className="lm-job-intake lm-job-intake--triage" role="region" aria-label="分诊确认">
        <header className="lm-job-intake-head">
          <div>
            <span className="lm-assignment-kicker">分诊结果</span>
            <strong>{template.name}</strong>
          </div>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-small"
            onClick={() => setStep("form")}
            disabled={busy}
          >
            返回修改
          </button>
        </header>

        <div className="lm-triage-layout">
          <div className="lm-triage-main">
            <div className="lm-triage-tier-rows" aria-label="分诊层级" data-testid="lm-triage-tier">
              {(
                [
                  {
                    tier: "green",
                    title: "绿灯 · 可自动推进",
                    body: "",
                    badge: "AI 可处理",
                  },
                  {
                    tier: "yellow",
                    title: "黄灯 · 需律师确认",
                    body: "",
                    badge: "需律师确认",
                  },
                  {
                    tier: "red",
                    title: "红灯 · 建议完整审查",
                    body: "",
                    badge: "建议完整审查",
                  },
                ] as const
              ).map((row) => {
                const on = result.tier === row.tier;
                return (
                  <div
                    key={row.tier}
                    className={
                      on
                        ? `lm-triage-tier-row lm-triage-tier-row--${row.tier} is-selected`
                        : `lm-triage-tier-row lm-triage-tier-row--${row.tier}`
                    }
                    aria-current={on ? "true" : undefined}
                  >
                    <div className="lm-triage-tier-row-main">
                      <strong>{on ? result.tierLabel : row.title}</strong>
                      {on && result.reasons[0] ? (
                        <p className="lm-meta">{result.reasons[0]}</p>
                      ) : null}
                    </div>
                    <span className="lm-triage-tier-badge">{on ? "当前选择" : row.badge}</span>
                  </div>
                );
              })}
            </div>
            <ul className="lm-triage-reasons">
              {result.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {result.matchedRuleIds.length > 0 ? (
              <div className="lm-triage-chips" aria-label="命中规则">
                {result.matchedRuleIds.slice(0, 6).map((chip) => (
                  <span key={chip} className="lm-triage-chip">
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="lm-triage-side">
            <div className="lm-triage-workflow-card">
              <span className="lm-meta">推荐工作流</span>
              <strong>{result.recommendedWorkflowLabel}</strong>
              <span className="lm-triage-reco-badge">推荐</span>
              <p className="lm-meta">预估投入：{effortLabel}</p>
            </div>
            {matchedSkills.length > 0 ? (
              <div className="lm-triage-skills" data-testid="lm-triage-matched-skills" aria-label="将启用技能">
                <span className="lm-meta">将启用技能</span>
                <div className="lm-triage-chips">
                  {matchedSkills.slice(0, 8).map((s) => (
                    <span key={s.id} className="lm-triage-chip" title={s.id}>
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {result.clarifications.length > 0 ? (
              <div className="lm-job-intake-fields">
                <span className="lm-meta">待澄清问题</span>
                {result.clarifications.map((c) => (
                  <label key={c.key} className="lm-job-intake-field">
                    <span>
                      {c.question}
                      {c.required ? <abbr title="必填">*</abbr> : null}
                    </span>
                    <input
                      className="lm-input"
                      type="text"
                      value={answers[c.key] ?? ""}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [c.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="lm-meta">无需额外澄清，可直接确认执行。</p>
            )}
          </aside>
        </div>

        {error ? <p className="lm-error">{error}</p> : null}
        <div className="lm-job-intake-actions lm-triage-actions">
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-triage-cta-primary"
            disabled={busy}
            onClick={() => void confirmTriage(false)}
            data-testid="lm-triage-confirm"
          >
            <strong>确认并执行</strong>
            <span className="lm-meta">进入推荐工作流</span>
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            disabled={busy}
            onClick={() => void confirmTriage(true)}
          >
            <strong>仅保存分诊</strong>
            <span className="lm-meta">稍后执行</span>
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            disabled={busy}
            data-testid="lm-triage-upgrade-full"
            onClick={() => {
              if (!pendingPrompt) {
                return;
              }
              const stance = (values.stance || "client") as ContractReviewStance;
              const depth = (values.depth || "standard") as ContractReviewDepth;
              const upgraded = appendCampaignUpgradeInstruction(pendingPrompt, {
                stance: stanceIntakeValue(
                  CONTRACT_REVIEW_STANCE_OPTIONS.some((o) => o.id === stance) ? stance : "client",
                ),
                focus: values.focus,
                depth:
                  depth === "deep" ? "深度" : depth === "quick" ? "快速" : "标准",
              });
              setPendingPrompt(upgraded);
              void confirmTriage(false, upgraded);
            }}
          >
            <strong>改为完整审查</strong>
            <span className="lm-meta">升级专案组</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lm-job-intake" role="region" aria-label={`交办：${template.name}`}>
      <header className="lm-job-intake-head">
        <div>
          <span className="lm-assignment-kicker">填表交办</span>
          <strong>{template.name}</strong>
          {template.description ? <p className="lm-meta">{template.description}</p> : null}
        </div>
        <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={onCancel}>
          返回
        </button>
      </header>
      <div className="lm-job-intake-fields">
        {fields.map((f) => {
          if (isContractReview && f.key === "stance") {
            return (
              <div key={f.key} className="lm-job-intake-field" role="group" aria-label={f.label}>
                <span>
                  {f.label}
                  {f.required ? <abbr title="必填">*</abbr> : null}
                </span>
                <div className="lm-contract-fast-lane-chips">
                  {CONTRACT_REVIEW_STANCE_OPTIONS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`lm-chip${values.stance === o.id ? " lm-chip-active" : ""}`}
                      data-testid={`lm-job-intake-stance-${o.id}`}
                      aria-pressed={values.stance === o.id}
                      onClick={() => setValues((prev) => ({ ...prev, stance: o.id }))}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (isContractReview && f.key === "depth") {
            return (
              <div key={f.key} className="lm-job-intake-field" role="group" aria-label={f.label}>
                <span>
                  {f.label}
                  {f.required ? <abbr title="必填">*</abbr> : null}
                </span>
                <div className="lm-contract-fast-lane-chips">
                  {CONTRACT_REVIEW_DEPTH_OPTIONS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`lm-chip${values.depth === o.id ? " lm-chip-active" : ""}`}
                      title={o.hint}
                      data-testid={`lm-job-intake-depth-${o.id}`}
                      aria-pressed={values.depth === o.id}
                      onClick={() => setValues((prev) => ({ ...prev, depth: o.id }))}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <label key={f.key} className="lm-job-intake-field">
              <span>
                {f.label}
                {f.required ? <abbr title="必填">*</abbr> : null}
              </span>
              {f.multiline ? (
                <textarea
                  className="lm-input"
                  rows={3}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  className="lm-input"
                  type="text"
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              )}
            </label>
          );
        })}
      </div>
      {error ? <p className="lm-error">{error}</p> : null}
      <div className="lm-job-intake-actions">
        {onFillComposer ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            disabled={busy}
            onClick={() => {
              const prompt = tryBuild();
              if (prompt) {
                onFillComposer(prompt);
              }
            }}
          >
            填入对话（可再改）
          </button>
        ) : null}
        <button
          type="button"
          className="lm-btn"
          disabled={busy || (!onDispatch && !onFillComposer)}
          onClick={() => void runTriageThenMaybeDispatch()}
          data-testid="lm-job-intake-submit"
        >
          {apiBase ? "分诊并交办" : "开始交办"}
        </button>
      </div>
    </div>
  );
}
