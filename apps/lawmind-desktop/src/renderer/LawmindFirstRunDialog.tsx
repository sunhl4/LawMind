/**
 * LawmindFirstRunDialog — Deliverable-First Architecture P5 (30 秒首跑)
 *
 *   单步首跑：选好身份（solo / 律所协办 / 合伙人）即开工 → 建演示案件 + 默认交办。
 *   文书类型与写作习惯问卷已按产品决定删除：文书由对话判断，风格走记忆库
 *   （确认后写入）；首跑只设 UI 权限默认，不写任何冷启动偏好。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { lawmindDocUrl } from "./lawmind-public-urls.js";
import { LAWMIND_ATTORNEY_DISCLAIMER_SHORT } from "./lawmind-attorney-disclaimer";
import { applyPostFirstrunPermissionDefaults } from "./lawmind-compose-prefs";
import { FIRST_RUN_DEMO_MATTER_ID } from "./lawmind-day-one";
const DISMISS_KEY = "lm.firstRun.dismissed";

function rememberBrowserDismiss(stamp: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, stamp);
  } catch {
    /* 受限环境没有可用的 localStorage */
  }
}

function forgetBrowserDismiss(): void {
  try {
    window.localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* 同上 */
  }
}
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

/** 选完身份就放进对话的第一句交办：不依赖文书选择，落地默认风格。 */
const DEFAULT_SEED_PROMPT_BY_ROLE: Record<Role["id"], string> = {
  solo: "请按中国大陆法起草我交办文书的可审核初稿；必备要素齐全，缺项用【待补充】标记。",
  associate: "请按所内通用范式起草交办初稿，并标出须合伙人确认的留白与关键风险摘要。",
  partner: "请对我交办的材料做全要素审核；结论注明依据，占位用【待补充】。",
};

type Props = {
  apiBase: string;
  open?: boolean;
  suppressAutoOpen?: boolean;
  onClose: () => void;
  onSeedReady: (params: { matterId?: string; seedPrompt: string }) => void;
  onOpenWorkflowLibrary?: () => void;
  onOpenAdvancedSettings?: () => void;
};

export function LawmindFirstRunDialog(props: Props): ReactNode {
  const { apiBase, open, suppressAutoOpen = false, onClose, onSeedReady, onOpenAdvancedSettings } = props;

  const [autoOpen, setAutoOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  /** 关掉引导后，进行中的「要不要自动打开」请求不能再把它弹回来。 */
  const dismissedThisSessionRef = useRef(false);

  useEffect(() => {
    if (open) {
      return undefined;
    }
    if (suppressAutoOpen) {
      setAutoOpen(false);
      return undefined;
    }
    if (typeof window === "undefined" || !apiBase) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      if (dismissedThisSessionRef.current) {
        return;
      }
      try {
        const requested =
          window.sessionStorage.getItem(REQUEST_OPEN_KEY) === "1" ||
          window.localStorage.getItem(REQUEST_OPEN_KEY) === "1";
        if (requested) {
          window.sessionStorage.removeItem(REQUEST_OPEN_KEY);
          window.localStorage.removeItem(REQUEST_OPEN_KEY);
          if (!cancelled && !dismissedThisSessionRef.current) {
            setAutoOpen(true);
          }
          return;
        }
        let dismissedHere = false;
        try {
          const state = await apiGetJson<{ ok?: boolean; dismissed?: boolean }>(
            apiBase,
            "/api/onboarding/firstrun",
          );
          dismissedHere = state.ok !== false && state.dismissed === true;
        } catch {
          dismissedHere = window.localStorage.getItem(DISMISS_KEY) != null;
        }
        if (cancelled || dismissedHere) {
          return;
        }
        const j = await apiGetJson<{ ok?: boolean; overviews?: unknown[] }>(
          apiBase,
          "/api/matters/overviews",
        );
        if (cancelled) {
          return;
        }
        const empty = j.ok !== false && Array.isArray(j.overviews) && j.overviews.length === 0;
        if (empty && !dismissedThisSessionRef.current) {
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

  const dismissForever = useCallback(() => {
    dismissedThisSessionRef.current = true;
    const stamp = new Date().toISOString();
    if (apiBase) {
      void apiSendJson<{ ok?: boolean }, Record<string, never>>(
        apiBase,
        "/api/onboarding/firstrun-dismiss",
        "POST",
        {},
      )
        .then((body) => {
          if (body.ok !== true) {
            throw new Error("dismiss failed");
          }
          // 工作区标记已写下。清掉浏览器副本，换工作区时不会把引导一起吞掉。
          forgetBrowserDismiss();
        })
        .catch(() => {
          rememberBrowserDismiss(stamp);
        });
    } else if (typeof window !== "undefined") {
      rememberBrowserDismiss(stamp);
    }
    setAutoOpen(false);
    onClose();
  }, [apiBase, onClose]);

  const dismissForNow = useCallback(() => {
    dismissedThisSessionRef.current = true;
    setAutoOpen(false);
    onClose();
  }, [onClose]);

  /** Skip wizard: still create demo matter + executable defaults (zero-choice after keys). */
  const skipWizardAndStart = useCallback(async () => {
    setSubmitBusy(true);
    setSubmitError(null);
    try {
      const matterId = FIRST_RUN_DEMO_MATTER_ID;
      const created = await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string }>(
        apiBase,
        "/api/matters/create",
        "POST",
        { matterId },
      );
      if (!created.ok) {
        throw new Error(created.error ?? "无法创建演示案件");
      }
      try {
        await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string }>(
          apiBase,
          "/api/onboarding/firstrun-wizard",
          "POST",
          { matterId },
        );
      } catch {
        /* 首跑审计失败不阻断 */
      }
      applyPostFirstrunPermissionDefaults({ executable: true });
      onSeedReady({
        matterId,
        seedPrompt: "",
      });
      dismissForever();
    } catch (e) {
      setSubmitError(errorMessage(e, "无法跳过向导并开始"));
    } finally {
      setSubmitBusy(false);
    }
  }, [apiBase, onSeedReady, dismissForever]);

  const startWithRole = useCallback(
    async (roleId: Role["id"]) => {
      setSubmitBusy(true);
      setSubmitError(null);
      try {
        const matterId = FIRST_RUN_DEMO_MATTER_ID;
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
        // No cold-start style/risk/tone preference writes — keep the model unconstrained
        // until habits are confirmed via 记忆库 / revisions / dialogue.
        applyPostFirstrunPermissionDefaults({ executable: true });
        onSeedReady({ matterId, seedPrompt: DEFAULT_SEED_PROMPT_BY_ROLE[roleId] });
        dismissForever();
      } catch (e) {
        setSubmitError(errorMessage(e, "无法创建案件"));
      } finally {
        setSubmitBusy(false);
      }
    },
    [apiBase, onSeedReady, dismissForever],
  );

  if (!visible) {
    return null;
  }

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="LawMind 新手引导">
      <div className="lm-wizard lm-firstrun">
        <div className="lm-firstrun-head">
          <h2>可以开始了</h2>
          <p className="lm-meta">
            选一个身份就开工。文书类型由对话判断，写作习惯以后在记忆库里从改稿与对话中沉淀。
          </p>
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

        {submitError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{submitError}</p>
          </div>
        ) : null}

        <div className="lm-firstrun-cards">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="lm-firstrun-card"
              disabled={submitBusy}
              onClick={() => {
                void startWithRole(r.id);
              }}
            >
              <div className="lm-firstrun-card-title">{r.label}</div>
              <div className="lm-firstrun-card-hint">{r.hint}</div>
            </button>
          ))}
        </div>

        <div className="lm-firstrun-footnote">
          <div className="lm-callout lm-callout-muted" role="note">
            <p className="lm-callout-body">
              {LAWMIND_ATTORNEY_DISCLAIMER_SHORT}
              <a
                href={lawmindDocUrl("archive/LAWMIND-DATA-PROCESSING")}
                target="_blank"
                rel="noreferrer noopener"
              >
                数据处理说明
              </a>
              。
            </p>
            <p className="lm-callout-body" data-testid="lm-firstrun-authority-boundary">
              未接权威库时只用演示语料；正式引用请核对原文。
            </p>
          </div>
        </div>

        <div className="lm-firstrun-actions">
          <button type="button" className="lm-btn lm-btn-secondary" onClick={dismissForNow}>
            稍后再说
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            data-testid="lm-firstrun-skip-wizard"
            disabled={submitBusy}
            onClick={() => void skipWizardAndStart()}
          >
            {submitBusy ? "正在开始…" : "直接开始"}
          </button>
          {onOpenAdvancedSettings ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              onClick={onOpenAdvancedSettings}
            >
              高级设置
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
