/**
 * Solo 空态：研究类交付一键入口（合规 / 调研 / 培训）。
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  buildResearchFastLanePrompt,
  RESEARCH_FAST_LANE_OPTIONS,
  type ResearchFastLaneKind,
} from "./lawmind-research-fast-lane";

export type LawmindResearchFastLaneCardProps = {
  onFillComposer: (prompt: string) => void;
  onDispatch?: (prompt: string) => void;
  onDismiss?: () => void;
  compact?: boolean;
  /** When false, compliance lane shows readiness CTA (联网关闭). */
  allowWebSearch?: boolean;
  webSearchPolicyBlocked?: boolean;
  onOpenSettings?: (section: "models" | "doctor") => void;
};

export function LawmindResearchFastLaneCard(props: LawmindResearchFastLaneCardProps): ReactNode {
  const {
    onFillComposer,
    onDispatch,
    onDismiss,
    compact = false,
    allowWebSearch = true,
    webSearchPolicyBlocked = false,
    onOpenSettings,
  } = props;
  const [kind, setKind] = useState<ResearchFastLaneKind>("compliance");
  const [topic, setTopic] = useState("");
  const [jurisdictions, setJurisdictions] = useState("");
  const [urls, setUrls] = useState("");

  const prompt = useMemo(
    () =>
      buildResearchFastLanePrompt(kind, topic, {
        jurisdictions: kind === "compliance" ? jurisdictions : undefined,
        urls: kind === "compliance" ? urls : undefined,
      }),
    [kind, topic, jurisdictions, urls],
  );
  const active = RESEARCH_FAST_LANE_OPTIONS.find((o) => o.id === kind);
  const complianceNeedsJurisdiction = kind === "compliance" && !jurisdictions.trim();
  const webNotReady =
    kind === "compliance" && (!allowWebSearch || webSearchPolicyBlocked);

  const dispatchBlocked = complianceNeedsJurisdiction || webNotReady;

  const submit = (mode: "fill" | "dispatch") => {
    if (complianceNeedsJurisdiction) {
      return;
    }
    if (mode === "dispatch") {
      if (webNotReady || !onDispatch) {
        return;
      }
      onDispatch(prompt);
      onDismiss?.();
      return;
    }
    onFillComposer(prompt);
    onDismiss?.();
  };

  return (
    <div
      className={`lm-contract-fast-lane lm-research-fast-lane${compact ? " lm-contract-fast-lane--compact" : ""}`}
      role="region"
      aria-label="研究与培训快车道"
      data-testid="lm-research-fast-lane"
    >
      <header className="lm-contract-fast-lane-head">
        <div>
          <strong>研究 / 培训快车道</strong>
          <p className="lm-meta">先大纲确认，再出可验收文稿</p>
        </div>
        {onDismiss ? (
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onDismiss}>
            收起
          </button>
        ) : null}
      </header>

      <div className="lm-contract-fast-lane-chips" role="group" aria-label="交付类型">
        {RESEARCH_FAST_LANE_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`lm-chip${kind === o.id ? " lm-chip-active" : ""}`}
            data-testid={`lm-research-lane-${o.id}`}
            aria-pressed={kind === o.id}
            onClick={() => setKind(o.id)}
          >
            {o.label}
            <span className="lm-meta"> · {o.hint}</span>
          </button>
        ))}
      </div>

      <label className="lm-contract-fast-lane-field">
        <span className="lm-meta">主题</span>
        <input
          className="lm-input"
          value={topic}
          placeholder={active ? `${active.label}主题…` : "主题"}
          data-testid="lm-research-lane-topic"
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>

      {kind === "compliance" ? (
        <>
          <label className="lm-contract-fast-lane-field">
            <span className="lm-meta">管辖区（必填）</span>
            <input
              className="lm-input"
              value={jurisdictions}
              placeholder="如：中国内地 / 欧盟"
              data-testid="lm-research-lane-jurisdictions"
              onChange={(e) => setJurisdictions(e.target.value)}
            />
          </label>
          <label className="lm-contract-fast-lane-field">
            <span className="lm-meta">相关 URL（选填）</span>
            <input
              className="lm-input"
              value={urls}
              placeholder="官网或法规页，可多条空格分隔"
              data-testid="lm-research-lane-urls"
              onChange={(e) => setUrls(e.target.value)}
            />
          </label>
        </>
      ) : null}

      {webNotReady ? (
        <div
          className="lm-callout lm-callout-warn"
          role="status"
          data-testid="lm-research-lane-readiness"
        >
          <p className="lm-callout-body">
            合规卷宗需要联网检索与可用模型。当前联网未开启或被策略关闭——请先修好再交办，避免空证据硬写。
          </p>
          {onOpenSettings ? (
            <div className="lm-draft-status-actions">
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                data-testid="lm-research-lane-open-models"
                onClick={() => onOpenSettings("models")}
              >
                去模型与检索
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                data-testid="lm-research-lane-open-doctor"
                onClick={() => onOpenSettings("doctor")}
              >
                系统健康
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="lm-contract-fast-lane-actions">
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-research-lane-fill"
          disabled={complianceNeedsJurisdiction}
          title={complianceNeedsJurisdiction ? "请先填写管辖区" : undefined}
          onClick={() => submit("fill")}
        >
          填入对话框
        </button>
        {onDispatch ? (
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            data-testid="lm-research-lane-dispatch"
            disabled={dispatchBlocked}
            title={
              complianceNeedsJurisdiction
                ? "请先填写管辖区"
                : webNotReady
                  ? "请先开启联网/修好模型后再交办"
                  : undefined
            }
            onClick={() => submit("dispatch")}
          >
            一键交办
          </button>
        ) : null}
      </div>
    </div>
  );
}
