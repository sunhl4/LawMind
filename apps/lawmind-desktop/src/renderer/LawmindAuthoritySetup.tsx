/**
 * 权威库连接 — 只告诉律师接上没有、能不能查。
 */

import type { ReactNode } from "react";
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
};

export function LawmindAuthoritySetup({
  authorityCorpus,
  authorityUsage,
  onOpenApiWizard,
  probeControl,
  npcFlkEnabled = true,
  npcSaving = false,
  onToggleNpc,
}: Props) {
  const status = authorityCorpus?.status ?? "unset";
  const commercial = isAuthorityCorpusCommercialReady(status);
  const probeable = isAuthorityCorpusUiReady(status);
  return (
    <section
      className="lm-settings-block"
      data-testid="lm-authority-setup"
      aria-label="权威法条类案库连接"
    >
      <h3 className="lm-settings-subtitle">连接权威库</h3>
      <p className="lm-settings-caption" role="status">
        未命中则不编造。闭源库由管理员配置。
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
      <div className="lm-settings-actions">
        {onOpenApiWizard ? (
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenApiWizard}>
            连接向导
          </button>
        ) : null}
        {probeControl}
      </div>
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
