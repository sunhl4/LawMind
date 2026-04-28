/**
 * LawmindFirstRunDialog — Deliverable-First Architecture P5 (30 秒首跑).
 *
 *   role pick  →  starter deliverable pick  →  create matter + seed prompt
 *
 * The goal: a cold-start lawyer can see the first draft request flow into the
 * chat composer in under 30 seconds, with the matter already created and the
 * Acceptance Gate ready to score whatever comes back.
 *
 * Trigger model:
 *   - Mounted once at app shell.
 *   - Auto-opens when:
 *       (a) `localStorage["lm.firstRun.dismissed"]` is unset, AND
 *       (b) `GET /api/matters/overviews` returns zero existing matters.
 *   - User can also open it manually from settings (open prop).
 *   - Dismiss writes a sentinel into localStorage so we never nag again.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

const DISMISS_KEY = "lm.firstRun.dismissed";

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

type SpecSummary = {
  type: string;
  displayName: string;
  description?: string;
  defaultOutput: "docx" | "pptx" | "markdown";
  source: "builtin" | "workspace";
};

const STARTER_PROMPT_BY_ROLE: Record<Role["id"], (specName: string) => string> = {
  solo: (name) =>
    `请帮我起草一份《${name}》草稿。请先列出必备要素清单，再生成可交付的初稿（中国大陆法）。完成后请走 DFA 验收门禁。`,
  associate: (name) =>
    `请按照所内通用范式生成一份《${name}》草稿。先给出关键风险与裁判倾向，再给出条款级初稿，并标注必须由合伙人确认的留白。`,
  partner: (name) =>
    `请生成一份《${name}》全要素稿，作为合伙人复核样本。所有结论需附来源 ID，所有占位符以「【待补充:xxx】」标记，并在末尾给出 DFA 验收报告自查。`,
};

type Props = {
  apiBase: string;
  /** Force-open from settings/shortcut (overrides auto-open heuristics). */
  open?: boolean;
  /** Called when the user closes / dismisses the wizard. */
  onClose: () => void;
  /** Called after the matter is created so the host can switch chat context. */
  onSeedReady: (params: { matterId: string; seedPrompt: string }) => void;
};

type Step = "role" | "spec" | "confirm";

function autoMatterIdFromRole(role: Role["id"]): string {
  // matter IDs are validated against [A-Za-z0-9._-]{3,64} elsewhere; build a
  // human-readable but safe identifier so the cockpit shows something useful.
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 12);
  return `firstrun-${role}-${stamp}`;
}

export function LawmindFirstRunDialog(props: Props): ReactNode {
  const { apiBase, open, onClose, onSeedReady } = props;

  const [autoOpen, setAutoOpen] = useState(false);
  const [step, setStep] = useState<Step>("role");
  const [role, setRole] = useState<Role["id"] | null>(null);
  const [specs, setSpecs] = useState<SpecSummary[] | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [chosenSpec, setChosenSpec] = useState<SpecSummary | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-detect first-run: no dismiss sentinel + zero matters in workspace.
  useEffect(() => {
    if (open) {
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
      } catch {
        // Swallow silently; the wizard is a nice-to-have, not a blocker.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, open]);

  const visible = Boolean(open) || autoOpen;

  // Lazy-load the spec catalog when the user actually reaches the spec step.
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
    // Prefer workspace customisations first (firms put their templates here),
    // then fall back to built-in starters.
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

  const submit = useCallback(async () => {
    if (!role || !chosenSpec) {
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
      const seedPrompt = STARTER_PROMPT_BY_ROLE[role](chosenSpec.displayName);
      onSeedReady({ matterId, seedPrompt });
      dismissForever();
    } catch (e) {
      setSubmitError(errorMessage(e, "无法创建案件"));
    } finally {
      setSubmitBusy(false);
    }
  }, [role, chosenSpec, apiBase, onSeedReady, dismissForever]);

  if (!visible) {
    return null;
  }

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="LawMind 新手引导">
      <div className="lm-wizard lm-firstrun">
        <div className="lm-firstrun-head">
          <h2>三步开始用</h2>
          <p className="lm-meta">
            选好身份和文书类型后，会建好案件并把开头话放进对话。日常可在设置里加多个<strong>智能体</strong>分工；交付前请在顶部「<strong>审核</strong>」里通过再把关。
          </p>
          <ol className="lm-firstrun-steps" aria-label="进度">
            <li className={step === "role" ? "active" : "done"}>1. 身份</li>
            <li className={step === "spec" ? "active" : step === "confirm" ? "done" : ""}>2. 文书</li>
            <li className={step === "confirm" ? "active" : ""}>3. 开始</li>
          </ol>
        </div>

        {step === "role" ? (
          <div className="lm-firstrun-cards">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`lm-firstrun-card ${role === r.id ? "selected" : ""}`}
                onClick={() => {
                  setRole(r.id);
                  setStep("spec");
                }}
              >
                <div className="lm-firstrun-card-title">{r.label}</div>
                <div className="lm-firstrun-card-hint">{r.hint}</div>
              </button>
            ))}
          </div>
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
              <span className="lm-meta">文书</span>
              <span>{chosenSpec.displayName}</span>
            </div>
            <div className="lm-firstrun-confirm-row">
              <span className="lm-meta">将放进对话里的第一句话（可改）</span>
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
              LawMind 生成内容为辅助草稿，不构成法律意见；对外交付前请复核。详见{" "}
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
          <div className="lm-firstrun-spacer" />
          {step !== "role" ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary"
              onClick={() => setStep(step === "confirm" ? "spec" : "role")}
              disabled={submitBusy}
            >
              上一步
            </button>
          ) : null}
          {step === "confirm" ? (
            <button
              type="button"
              className="lm-btn"
              disabled={submitBusy || !role || !chosenSpec}
              onClick={() => void submit()}
            >
              {submitBusy ? "正在创建…" : "建案件并打开对话"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
