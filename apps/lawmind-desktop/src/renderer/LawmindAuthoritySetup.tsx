/**
 * 权威库连接 — 律师在这里接北大法宝，或继续用公开法规。
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  authorityCorpusStatusLabel,
  isAuthorityCorpusCommercialReady,
  isAuthorityCorpusUiReady,
  type LawmindSettingsAuthorityCorpus,
} from "./lawmind-settings-models";

export type LawmindAuthorityUsageSummary = {
  day?: string;
  ok?: number;
  error?: number;
  total?: number;
  message?: string;
};

export type AuthoritySavePayload = {
  provider: "pkulaw" | "open";
  lawEndpoint?: string;
  caseEndpoint?: string;
  apiKey?: string;
};

const DEFAULT_LAW_ENDPOINT = "https://apim-gateway.pkulaw.com/mcp-law-search-service";
const DEFAULT_CASE_ENDPOINT = "https://apim-gateway.pkulaw.com/mcp-case-search-service";

type Props = {
  authorityCorpus?: LawmindSettingsAuthorityCorpus | null;
  authorityUsage?: LawmindAuthorityUsageSummary | null;
  envFilePath?: string | null;
  onOpenApiWizard?: () => void;
  probeControl?: ReactNode;
  /** 国家法律法规数据库（NPC FLK）开关状态；默认启用。 */
  npcFlkEnabled?: boolean;
  npcSaving?: boolean;
  onToggleNpc?: (enabled: boolean) => void;
  authoritySaving?: boolean;
  onSaveAuthority?: (payload: AuthoritySavePayload) => Promise<void>;
};

export function LawmindAuthoritySetup({
  authorityCorpus,
  authorityUsage,
  onOpenApiWizard,
  probeControl,
  npcFlkEnabled = true,
  npcSaving = false,
  onToggleNpc,
  authoritySaving = false,
  onSaveAuthority,
}: Props) {
  const status = authorityCorpus?.status ?? "unset";
  const commercial = isAuthorityCorpusCommercialReady(status);
  const probeable = isAuthorityCorpusUiReady(status);
  const pkulawOn = authorityCorpus?.provider === "pkulaw";
  const [lawEndpoint, setLawEndpoint] = useState(DEFAULT_LAW_ENDPOINT);
  const [caseEndpoint, setCaseEndpoint] = useState(DEFAULT_CASE_ENDPOINT);
  const [apiKey, setApiKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(Boolean(authorityCorpus?.authConfigured));
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(
    () => typeof window.lawmindDesktop?.readAuthoritySettings !== "function",
  );

  useEffect(() => {
    const read = window.lawmindDesktop?.readAuthoritySettings;
    let cancelled = false;
    if (!read) {
      setSettingsReady(true);
      return () => {
        cancelled = true;
      };
    }
    setSettingsReady(false);
    void read()
      .then((res) => {
        if (cancelled || !res?.ok) {
          return;
        }
        if (res.lawEndpoint) {
          setLawEndpoint(res.lawEndpoint);
        }
        if (res.caseEndpoint) {
          setCaseEndpoint(res.caseEndpoint);
        }
        setHasExistingKey(Boolean(res.hasApiKey));
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authorityCorpus?.provider, authorityCorpus?.status, authorityCorpus?.authConfigured]);

  async function save(payload: AuthoritySavePayload) {
    if (!onSaveAuthority) {
      setFormMsg("请在桌面应用里保存。");
      return;
    }
    setFormMsg(null);
    try {
      await onSaveAuthority(payload);
      setApiKey("");
      setHasExistingKey(payload.provider === "pkulaw" ? true : hasExistingKey);
      setFormMsg(payload.provider === "pkulaw" ? "已连接北大法宝。" : "已改用公开法规。");
    } catch (cause) {
      setFormMsg(cause instanceof Error ? cause.message : "保存失败");
    }
  }

  return (
    <section
      className="lm-settings-block"
      data-testid="lm-authority-setup"
      aria-label="权威法条类案库连接"
    >
      <h3 className="lm-settings-subtitle">连接权威库</h3>
      <p className="lm-settings-caption" role="status">
        未命中则不编造。北大法宝用你自己的访问令牌，只存在这台电脑上。
      </p>
      <div className="lm-settings-row">
        <span className="lm-settings-key">状态</span>
        <span
          className={
            commercial
              ? "lm-pill lm-pill-success"
              : status === "invalid"
                ? "lm-pill lm-pill-danger"
                : "lm-pill lm-pill-warn"
          }
          title={
            status === "unimplemented"
              ? "适配器未就绪"
              : status === "sample-ready"
                ? "演示语料（非正式权威库）"
                : undefined
          }
          data-testid="lm-authority-setup-status"
          data-status={status}
          data-probeable={probeable ? "1" : "0"}
        >
          {authorityCorpusStatusLabel(authorityCorpus)}
        </span>
      </div>
      {authorityCorpus?.message ? (
        <p className="lm-settings-caption" role="status">
          {authorityCorpus.message}
        </p>
      ) : null}
      {authorityUsage?.message ? (
        <p className="lm-settings-caption" data-testid="lm-authority-usage" role="status">
          {authorityUsage.message}
        </p>
      ) : null}
      <div className="lm-settings-row" data-testid="lm-authority-npc-row">
        <span className="lm-settings-key">国家法律法规数据库</span>
        <span
          className={npcFlkEnabled ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}
          data-testid="lm-authority-npc-status"
        >
          {npcFlkEnabled ? "已启用（默认）" : "已关闭"}
        </span>
        {onToggleNpc ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-authority-npc-toggle"
            disabled={npcSaving}
            onClick={() => onToggleNpc(!npcFlkEnabled)}
          >
            {npcSaving ? "正在切换…" : npcFlkEnabled ? "关闭" : "启用"}
          </button>
        ) : null}
      </div>
      <p className="lm-settings-caption" role="note">
        官方公开检索，命中标「国家法律法规数据库」；未命中或不可达时回退演示语料并如实标注。
      </p>
      <label className="lm-field">
        <span>北大法宝访问令牌</span>
        <input
          type="password"
          autoComplete="off"
          data-testid="lm-authority-token"
          value={apiKey}
          disabled={authoritySaving || !settingsReady}
          placeholder={hasExistingKey ? "留空则保留已保存的令牌" : "粘贴你自己的访问令牌"}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <details className="lm-settings-advanced">
        <summary>地址（一般不用改）</summary>
        <div className="lm-settings-advanced-body">
          <label className="lm-field">
            <span>法规地址</span>
            <input
              type="text"
              data-testid="lm-authority-law-endpoint"
              value={lawEndpoint}
              disabled={authoritySaving || !settingsReady}
              onChange={(e) => setLawEndpoint(e.target.value)}
            />
          </label>
          <label className="lm-field">
            <span>案例地址</span>
            <input
              type="text"
              data-testid="lm-authority-case-endpoint"
              value={caseEndpoint}
              disabled={authoritySaving || !settingsReady}
              onChange={(e) => setCaseEndpoint(e.target.value)}
            />
          </label>
        </div>
      </details>
      <div className="lm-settings-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-authority-save"
          disabled={authoritySaving || !settingsReady || !onSaveAuthority}
          onClick={() =>
            void save({
              provider: "pkulaw",
              lawEndpoint,
              caseEndpoint,
              apiKey,
            })
          }
        >
          {authoritySaving ? "正在保存…" : pkulawOn ? "更新北大法宝" : "连接北大法宝"}
        </button>
        {pkulawOn ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-authority-use-open"
            disabled={authoritySaving || !settingsReady || !onSaveAuthority}
            onClick={() => void save({ provider: "open" })}
          >
            改用公开法规
          </button>
        ) : null}
        {onOpenApiWizard ? (
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenApiWizard}>
            连接向导
          </button>
        ) : null}
        {probeControl}
      </div>
      {formMsg ? (
        <p className="lm-settings-caption" role="status" data-testid="lm-authority-save-msg">
          {formMsg}
        </p>
      ) : null}
      {status === "configured" &&
      (authorityCorpus?.provider === "pkulaw" || authorityCorpus?.provider === "generic") ? (
        <p className="lm-settings-caption" role="note">
          对话检索走这里的权威库。正式引用请核对原文。
        </p>
      ) : (
        <p className="lm-settings-caption lm-settings-caption--warn" role="note">
          演示语料不等于完整法库。正式引用请核对权威来源。
        </p>
      )}
    </section>
  );
}
