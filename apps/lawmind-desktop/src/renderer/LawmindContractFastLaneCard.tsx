/**
 * Solo 空态 / 快捷入口：「5 分钟合同审查」卡片（立场 × 深度）。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";
import {
  extractAppliedPreferencesFromProfile,
  formatAppliedPreferencesHint,
} from "../../../../src/lawmind/memory/applied-preferences.ts";
import {
  buildContractFastLanePrompt,
  CONTRACT_REVIEW_DEPTH_OPTIONS,
  CONTRACT_REVIEW_STANCE_OPTIONS,
  type ContractReviewDepth,
  type ContractReviewStance,
} from "./lawmind-contract-fast-lane";

export type LawmindContractFastLaneCardProps = {
  /** 已引用文件时的默认材料说明（如路径列表） */
  materialsHint?: string;
  onFillComposer: (prompt: string) => void;
  /** 有则一键交办发送；否则仅填入输入框 */
  onDispatch?: (prompt: string) => void;
  onDismiss?: () => void;
  compact?: boolean;
  apiBase?: string;
  lawyerPrefs?: string;
};

export function LawmindContractFastLaneCard(props: LawmindContractFastLaneCardProps): ReactNode {
  const {
    materialsHint = "",
    onFillComposer,
    onDispatch,
    onDismiss,
    compact = false,
    apiBase,
    lawyerPrefs,
  } = props;
  const [loadedPrefs, setLoadedPrefs] = useState("");
  const [stance, setStance] = useState<ContractReviewStance>("client");
  const [depth, setDepth] = useState<ContractReviewDepth>("standard");
  const [materials, setMaterials] = useState(materialsHint);
  const [focus, setFocus] = useState("付款、违约、管辖、责任限制");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (materialsHint.trim() && !materials.trim()) {
      setMaterials(materialsHint);
    }
  }, [materialsHint, materials]);

  useEffect(() => {
    if (lawyerPrefs?.trim() || !apiBase) {
      return;
    }
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; text?: string }>(
      apiBase,
      "/api/memory/source-text?path=LAWYER_PROFILE.md&maxChars=4000",
    )
      .then((j) => {
        if (cancelled || !j.text?.trim()) {
          return;
        }
        const hint = formatAppliedPreferencesHint(extractAppliedPreferencesFromProfile(j.text, 8));
        if (hint) {
          setLoadedPrefs(hint);
        }
      })
      .catch(() => {
        /* 无画像则不加 */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, lawyerPrefs]);

  const prompt = useMemo(
    () =>
      buildContractFastLanePrompt({
        materials,
        focus,
        stance,
        depth,
        lawyerPrefs: lawyerPrefs?.trim() || loadedPrefs,
      }),
    [materials, focus, stance, depth, lawyerPrefs, loadedPrefs],
  );

  const submit = (mode: "fill" | "dispatch") => {
    if (!materials.trim() && !materialsHint.trim()) {
      setError("请说明合同材料，或先在对话中引用合同文件。");
      return;
    }
    setError(null);
    if (mode === "dispatch" && onDispatch) {
      onDispatch(prompt);
    } else {
      onFillComposer(prompt);
    }
    onDismiss?.();
  };

  return (
    <div
      className={`lm-contract-fast-lane${compact ? " lm-contract-fast-lane--compact" : ""}`}
      role="region"
      aria-label="5 分钟合同审查"
      data-testid="lm-contract-fast-lane"
    >
      <header className="lm-contract-fast-lane-head">
        <div>
          <strong>5 分钟合同审查</strong>
          <p className="lm-meta">选立场与深度</p>
        </div>
        {onDismiss ? (
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onDismiss}>
            收起
          </button>
        ) : null}
      </header>

      <div className="lm-contract-fast-lane-chips" role="group" aria-label="审查立场">
        <span className="lm-meta">立场</span>
        {CONTRACT_REVIEW_STANCE_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`lm-chip${stance === o.id ? " lm-chip-active" : ""}`}
            data-testid={`lm-contract-stance-${o.id}`}
            aria-pressed={stance === o.id}
            onClick={() => setStance(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="lm-contract-fast-lane-chips" role="group" aria-label="审查深度">
        <span className="lm-meta">深度</span>
        {CONTRACT_REVIEW_DEPTH_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`lm-chip${depth === o.id ? " lm-chip-active" : ""}`}
            title={o.hint}
            data-testid={`lm-contract-depth-${o.id}`}
            aria-pressed={depth === o.id}
            onClick={() => setDepth(o.id)}
          >
            {o.label}
          </button>
        ))}
        {depth === "quick" ? <span className="lm-meta">过门不等于已审透</span> : null}
      </div>

      <label className="lm-job-intake-field">
        <span>合同/材料</span>
        <textarea
          rows={compact ? 2 : 3}
          value={materials}
          onChange={(e) => setMaterials(e.target.value)}
          placeholder="合同名称或关键条款位置"
          data-testid="lm-contract-fast-lane-materials"
        />
      </label>
      <label className="lm-job-intake-field">
        <span>审查重点</span>
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="如付款、违约、管辖…"
          data-testid="lm-contract-fast-lane-focus"
        />
      </label>

      {error ? (
        <p className="lm-meta lm-text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="lm-contract-fast-lane-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-contract-fast-lane-dispatch"
          onClick={() => submit(onDispatch ? "dispatch" : "fill")}
        >
          {onDispatch ? "开始审查" : "填入交办"}
        </button>
        {onDispatch ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={() => submit("fill")}
          >
            仅填入
          </button>
        ) : null}
      </div>
    </div>
  );
}
