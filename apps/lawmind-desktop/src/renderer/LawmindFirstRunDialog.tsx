/**
 * LawmindFirstRunDialog — Deliverable-First Architecture P5 (30 秒首跑)
 * + cold-start preference interview (P1).
 *
 *   role → prefs → starter deliverable → create matter + seed prompt + write preferences
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { lawmindDocUrl } from "./lawmind-public-urls.js";
import { LAWMIND_ATTORNEY_DISCLAIMER_SHORT } from "./lawmind-attorney-disclaimer";
import { writeComposePermissionMode } from "./lawmind-compose-prefs";

const DISMISS_KEY = "lm.firstRun.dismissed";
/** Set by API wizard after successful save to open first-run once suppress lifts. */
const REQUEST_OPEN_KEY = "lm.firstRun.requestOpen";

type Role = {
  id: "solo" | "associate" | "partner";
  label: string;
  hint: string;
};

const ROLES: Role[] = [
  { id: "solo", label: "独立执业", hint: "合同、函件、意见书等日常草拟" },
  { id: "associate", label: "律所协办", hint: "配合团队，偏研究与初稿" },
  { id: "partner", label: "合伙人", hint: "把关定稿与风险" },
];

type PrefChoice = { id: string; label: string };

const WRITING_STYLE: PrefChoice[] = [
  { id: "concise", label: "简洁直接" },
  { id: "detailed", label: "详尽论证" },
  { id: "litigation", label: "偏诉讼对抗" },
];

const RISK_POSTURE: PrefChoice[] = [
  { id: "conservative", label: "偏保守" },
  { id: "balanced", label: "平衡" },
  { id: "assertive", label: "偏进取" },
];

const CLIENT_TONE: PrefChoice[] = [
  { id: "formal", label: "正式严谨" },
  { id: "plain", label: "通俗易懂" },
  { id: "warm", label: "亲和说明" },
];

type SpecSummary = {
  type: string;
  displayName: string;
  description?: string;
  defaultOutput: "docx" | "pptx" | "markdown";
  source: "builtin" | "workspace";
};

const STARTER_PROMPT_BY_ROLE: Record<Role["id"], (specName: string) => string> = {
  solo: (name) =>
    `【交办】首跑《${name}》\n交付物类型：首跑文书\n交办要点：\n- 要完成什么：按中国大陆法起草可审核初稿\n- 必须包含的要点：必备要素齐全，缺项用【待补充】标记\n\n【先计划】当前为「先计划」权限：请先给出执行步骤、所需材料与验收要点，不要直接写文件或出稿；等我切换到「标准」并确认后再起草。信息不足时用结构化问题追问。`,
  associate: (name) =>
    `【交办】首跑《${name}》\n交付物类型：首跑文书\n交办要点：\n- 要完成什么：按所内通用范式生成初稿并标出须合伙人确认的留白\n- 必须包含的要点：关键风险与裁判倾向摘要\n\n【先计划】请先列执行计划与互审点，勿直接写盘；待我确认后再起草并进入文书台。`,
  partner: (name) =>
    `【交办】首跑《${name}》\n交付物类型：首跑文书\n交办要点：\n- 要完成什么：全要素复核样本\n- 必须包含的要点：结论附来源 ID；占位符用【待补充:xxx】\n\n【先计划】请先给出复核清单与验收门禁，勿直接出稿；待我确认后再执行，提交文书台前完成验收自查。`,
};

type Props = {
  apiBase: string;
  open?: boolean;
  suppressAutoOpen?: boolean;
  onClose: () => void;
  onSeedReady: (params: { matterId: string; seedPrompt: string }) => void;
  onOpenWorkflowLibrary?: () => void;
  onOpenAdvancedSettings?: () => void;
};

type Step = "role" | "prefs" | "spec" | "confirm";

function autoMatterIdFromRole(role: Role["id"]): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 12);
  return `firstrun-${role}-${stamp}`;
}

function labelOf(choices: PrefChoice[], id: string | null): string {
  return choices.find((c) => c.id === id)?.label ?? "";
}

export function LawmindFirstRunDialog(props: Props): ReactNode {
  const {
    apiBase,
    open,
    suppressAutoOpen = false,
    onClose,
    onSeedReady,
    onOpenWorkflowLibrary,
    onOpenAdvancedSettings,
  } = props;

  const [autoOpen, setAutoOpen] = useState(false);
  const [step, setStep] = useState<Step>("role");
  const [role, setRole] = useState<Role["id"] | null>(null);
  const [writingStyle, setWritingStyle] = useState<string | null>(null);
  const [riskPosture, setRiskPosture] = useState<string | null>(null);
  const [clientTone, setClientTone] = useState<string | null>(null);
  const [specs, setSpecs] = useState<SpecSummary[] | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [chosenSpec, setChosenSpec] = useState<SpecSummary | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      return;
    }
    if (suppressAutoOpen) {
      setAutoOpen(false);
      return;
    }
    if (typeof window === "undefined" || !apiBase) {
      return;
    }
    if (window.localStorage.getItem(DISMISS_KEY)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const requested =
          window.sessionStorage.getItem(REQUEST_OPEN_KEY) === "1" ||
          window.localStorage.getItem(REQUEST_OPEN_KEY) === "1";
        if (requested) {
          window.sessionStorage.removeItem(REQUEST_OPEN_KEY);
          window.localStorage.removeItem(REQUEST_OPEN_KEY);
          if (!cancelled) {
            setAutoOpen(true);
          }
          return;
        }
        const j = await apiGetJson<{ ok?: boolean; overviews?: unknown[] }>(
          apiBase,
          "/api/matters/overviews",
        );
        if (cancelled) {
          return;
        }
        const empty =
          j.ok !== false && Array.isArray(j.overviews) && j.overviews.length === 0;
        if (empty) {
          setAutoOpen(true);
        }
      } catch (e) {
        if (!cancelled) {
          setBootstrapError(errorMessage(e, "无法检查工作区案件列表，首跑引导可能无法自动打开。"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, open, suppressAutoOpen]);

  const visible = Boolean(open) || autoOpen;

  useEffect(() => {
    if (step !== "spec" || specs !== null || !apiBase) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const j = await apiGetJson<{ ok?: boolean; specs?: SpecSummary[] }>(
          apiBase,
          "/api/deliverables/specs",
        );
        if (cancelled) {
          return;
        }
        if (!j.ok || !Array.isArray(j.specs)) {
          throw new Error("无法加载文书类型");
        }
        setSpecs(j.specs);
      } catch (e) {
        if (!cancelled) {
          setSpecError(errorMessage(e, "无法加载文书类型"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, specs, apiBase]);

  const featuredSpecs = useMemo(() => {
    if (!specs) {
      return [];
    }
    const workspace = specs.filter((s) => s.source === "workspace");
    const builtin = specs.filter((s) => s.source === "builtin");
    return [...workspace, ...builtin].slice(0, 6);
  }, [specs]);

  const dismissForever = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    }
    setAutoOpen(false);
    onClose();
  }, [onClose]);

  const dismissForNow = useCallback(() => {
    setAutoOpen(false);
    onClose();
  }, [onClose]);

  const prefsReady = Boolean(writingStyle && riskPosture && clientTone);

  const submit = useCallback(async () => {
    if (!role || !chosenSpec || !prefsReady) {
      return;
    }
    setSubmitBusy(true);
    setSubmitError(null);
    try {
      const matterId = autoMatterIdFromRole(role);
      const created = await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string }>(
        apiBase,
        "/api/matters/create",
        "POST",
        { matterId },
      );
      if (!created.ok) {
        throw new Error(created.error ?? "无法创建案件");
      }
      try {
        await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string }>(
          apiBase,
          "/api/onboarding/firstrun-wizard",
          "POST",
          { matterId },
        );
      } catch {
        // 首跑审计失败不阻断进入对话
      }
      const prefNotes = [
        `冷启动偏好：行文风格=${labelOf(WRITING_STYLE, writingStyle)}`,
        `冷启动偏好：风险口径=${labelOf(RISK_POSTURE, riskPosture)}`,
        `冷启动偏好：对客语气=${labelOf(CLIENT_TONE, clientTone)}`,
      ];
      for (const note of prefNotes) {
        try {
          await apiSendJson<
            { ok?: boolean },
            { note: string; source: "manual" }
          >(apiBase, "/api/lawyer-profile/learning", "POST", {
            note,
            source: "manual",
          });
        } catch {
          // 偏好写入失败不阻断首跑
        }
      }
      const seedPrompt = STARTER_PROMPT_BY_ROLE[role](chosenSpec.displayName);
      // 首跑默认「先计划」：降低误写盘风险，律师确认后再切标准执行。
      writeComposePermissionMode("readonly");
      onSeedReady({ matterId, seedPrompt });
      dismissForever();
    } catch (e) {
      setSubmitError(errorMessage(e, "无法创建案件"));
    } finally {
      setSubmitBusy(false);
    }
  }, [
    role,
    chosenSpec,
    prefsReady,
    writingStyle,
    riskPosture,
    clientTone,
    apiBase,
    onSeedReady,
    dismissForever,
  ]);

  if (!visible) {
    return null;
  }

  const stepBack = () => {
    if (step === "confirm") {
      setStep("spec");
    } else if (step === "spec") {
      setStep("prefs");
    } else if (step === "prefs") {
      setStep("role");
    }
  };

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="LawMind 新手引导">
      <div className="lm-wizard lm-firstrun">
        <div className="lm-firstrun-head">
          <h2>几步开始用</h2>
            <p className="lm-meta">
            选身份与文书即可上手；习惯可跳过。首跑默认「先计划」再动手，交付前在「
            <strong>文书台</strong>」完成必核与签批。
          </p>
          <ol className="lm-firstrun-steps" aria-label="进度">
            <li className={step === "role" ? "active" : "done"}>1. 身份</li>
            <li
              className={
                step === "prefs" ? "active" : step === "spec" || step === "confirm" ? "done" : ""
              }
            >
              2. 习惯
            </li>
            <li className={step === "spec" ? "active" : step === "confirm" ? "done" : ""}>3. 文书</li>
            <li className={step === "confirm" ? "active" : ""}>4. 开始</li>
          </ol>
        </div>
        {bootstrapError ? (
          <div className="lm-callout lm-callout-warn" role="alert">
            <p className="lm-callout-body">{bootstrapError}</p>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              onClick={() => {
                setBootstrapError(null);
                setAutoOpen(true);
              }}
            >
              重试检查
            </button>
          </div>
        ) : null}

        {step === "role" ? (
          <div className="lm-firstrun-cards">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`lm-firstrun-card ${role === r.id ? "selected" : ""}`}
                onClick={() => {
                  setRole(r.id);
                  setStep("prefs");
                }}
              >
                <div className="lm-firstrun-card-title">{r.label}</div>
                <div className="lm-firstrun-card-hint">{r.hint}</div>
              </button>
            ))}
          </div>
        ) : null}

        {step === "prefs" ? (
          <div className="lm-firstrun-prefs">
            <p className="lm-meta">选三项即可，后面随时可在文书台继续沉淀。</p>
            <p className="lm-firstrun-express">
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                data-testid="lm-firstrun-skip-prefs"
                onClick={() => {
                  setWritingStyle("concise");
                  setRiskPosture("balanced");
                  setClientTone("formal");
                  setStep("spec");
                }}
              >
                用推荐默认，跳过习惯
              </button>
              <span className="lm-meta">简洁 · 平衡风险 · 正式语气</span>
            </p>
            <fieldset className="lm-firstrun-pref-group">
              <legend>行文风格</legend>
              <div className="lm-firstrun-pref-options">
                {WRITING_STYLE.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`lm-firstrun-card ${writingStyle === c.id ? "selected" : ""}`}
                    onClick={() => setWritingStyle(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="lm-firstrun-pref-group">
              <legend>风险口径</legend>
              <div className="lm-firstrun-pref-options">
                {RISK_POSTURE.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`lm-firstrun-card ${riskPosture === c.id ? "selected" : ""}`}
                    onClick={() => setRiskPosture(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="lm-firstrun-pref-group">
              <legend>对客语气</legend>
              <div className="lm-firstrun-pref-options">
                {CLIENT_TONE.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`lm-firstrun-card ${clientTone === c.id ? "selected" : ""}`}
                    onClick={() => setClientTone(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {step === "spec" && onOpenWorkflowLibrary ? (
          <p className="lm-meta lm-firstrun-workflow-hint">
            也可先浏览{" "}
            <button type="button" className="lm-link-btn" onClick={onOpenWorkflowLibrary}>
              工作流库
            </button>
            ，再选文书类型。
          </p>
        ) : null}

        {step === "spec" ? (
          <div className="lm-firstrun-cards lm-firstrun-cards-grid">
            {specError ? (
              <div className="lm-callout lm-callout-danger" role="alert">
                <p className="lm-callout-body">{specError}</p>
              </div>
            ) : null}
            {!specError && specs === null ? (
              <div className="lm-settings-loading" aria-busy="true" aria-label="加载文书类型">
                <div className="lm-shimmer lm-shimmer-line" />
                <div className="lm-shimmer lm-shimmer-line lm-shimmer-short" />
              </div>
            ) : null}
            {featuredSpecs.map((spec) => (
              <button
                key={spec.type}
                type="button"
                className={`lm-firstrun-card ${chosenSpec?.type === spec.type ? "selected" : ""}`}
                onClick={() => {
                  setChosenSpec(spec);
                  setStep("confirm");
                }}
              >
                <div className="lm-firstrun-card-title">{spec.displayName}</div>
                <div className="lm-firstrun-card-hint">{spec.description ?? spec.type}</div>
                <div className="lm-firstrun-card-foot">
                  <span>{spec.defaultOutput.toUpperCase()}</span>
                  <span>{spec.source === "workspace" ? "本所自定义" : "内置"}</span>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {step === "confirm" && role && chosenSpec ? (
          <div className="lm-firstrun-confirm">
            <div className="lm-firstrun-confirm-row">
              <span className="lm-meta">身份</span>
              <span>{ROLES.find((r) => r.id === role)?.label}</span>
            </div>
            <div className="lm-firstrun-confirm-row">
              <span className="lm-meta">习惯</span>
              <span>
                {labelOf(WRITING_STYLE, writingStyle)} · {labelOf(RISK_POSTURE, riskPosture)} ·{" "}
                {labelOf(CLIENT_TONE, clientTone)}
              </span>
            </div>
            <div className="lm-firstrun-confirm-row">
              <span className="lm-meta">文书</span>
              <span>{chosenSpec.displayName}</span>
            </div>
            <div className="lm-firstrun-confirm-row">
              <span className="lm-meta">将放进对话的第一句交办（可改）</span>
              <pre className="lm-firstrun-seed">{STARTER_PROMPT_BY_ROLE[role](chosenSpec.displayName)}</pre>
            </div>
            {submitError ? (
              <div className="lm-callout lm-callout-danger" role="alert">
                <p className="lm-callout-body">{submitError}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="lm-firstrun-footnote">
          <div className="lm-callout lm-callout-muted" role="note">
            <p className="lm-callout-body">
              {LAWMIND_ATTORNEY_DISCLAIMER_SHORT}详见{" "}
              <a href={lawmindDocUrl("LAWMIND-DATA-PROCESSING")} target="_blank" rel="noreferrer noopener">
                数据处理说明
              </a>
              与{" "}
              <a href={lawmindDocUrl("LAWMIND-USER-MANUAL")} target="_blank" rel="noreferrer noopener">
                完整使用手册
              </a>
              （推荐从「桌面版快速上手」读起）。
            </p>
          </div>
        </div>

        <div className="lm-firstrun-actions">
          <button type="button" className="lm-btn lm-btn-secondary" onClick={dismissForNow}>
            稍后再说
          </button>
          <button type="button" className="lm-btn lm-btn-secondary" onClick={dismissForever}>
            不用了
          </button>
          {onOpenAdvancedSettings ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              onClick={onOpenAdvancedSettings}
            >
              IT / 高级设置
            </button>
          ) : null}
          <div className="lm-firstrun-spacer" />
          {step !== "role" ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary"
              onClick={stepBack}
              disabled={submitBusy}
            >
              上一步
            </button>
          ) : null}
          {step === "prefs" ? (
            <button
              type="button"
              className="lm-btn"
              disabled={!prefsReady}
              onClick={() => setStep("spec")}
            >
              下一步
            </button>
          ) : null}
          {step === "confirm" ? (
            <button
              type="button"
              className="lm-btn"
              disabled={submitBusy || !role || !chosenSpec || !prefsReady}
              onClick={() => void submit()}
            >
              {submitBusy ? "正在创建…" : "建案件并开始交办"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
