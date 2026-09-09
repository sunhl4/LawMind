/**
 * 权威库连接 — 律师可见状态与向导；环境变量契约折叠给管理员。
 */

import type { ReactNode } from "react";
import {
  authorityCorpusStatusLabel,
  isAuthorityCorpusUiReady,
  type LawmindSettingsAuthorityCorpus,
} from "./lawmind-settings-models";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

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
};

export function LawmindAuthoritySetup({
  authorityCorpus,
  authorityUsage,
  envFilePath,
  onOpenApiWizard,
  probeControl,
}: Props) {
  const status = authorityCorpus?.status ?? "unset";
  const ready = isAuthorityCorpusUiReady(status);
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
            ready
              ? "lm-pill lm-pill-success"
              : status === "invalid"
                ? "lm-pill lm-pill-danger"
                : "lm-pill lm-pill-warn"
          }
          title={
            status === "unimplemented"
              ? "适配器未就绪"
              : status === "sample-ready"
                ? "演示语料"
                : undefined
          }
          data-testid="lm-authority-setup-status"
          data-status={status}
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
      <div className="lm-settings-actions">
        {onOpenApiWizard ? (
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenApiWizard}>
            API 配置向导
          </button>
        ) : null}
        {probeControl}
      </div>
      {status === "configured" &&
      (authorityCorpus?.provider === "pkulaw" || authorityCorpus?.provider === "generic") ? (
        <p className="lm-settings-caption" role="note">
          对话检索走这里的权威库。设置 → 安全与工具 → 外部对接里的法宝 MCP
          是同一网关的进阶入口，不是另一套未接上的库。正式引用请核对原文。
        </p>
      ) : (
        <p className="lm-settings-caption lm-settings-caption--warn" role="note">
          演示语料不等于完整法库。正式引用请核对权威来源。
        </p>
      )}
      <details className="lm-settings-hint">
        <summary>管理员：环境变量</summary>
        <ul className="lm-settings-caption">
          <li>
            <code className="lm-md-code">LAWMIND_AUTHORITY_PROVIDER</code> = open | generic | pkulaw |
            lexis
          </li>
          <li>
            开源：<code className="lm-md-code">LAWMIND_OPEN_LAW_CORPUS</code>、
            <code className="lm-md-code">LAWMIND_OPEN_LAW_MODE</code>、
            <code className="lm-md-code">LAWMIND_OPEN_LAW_NPC</code>、
            <code className="lm-md-code">LAWMIND_OPEN_LAW_COURTLISTENER</code>、
            <code className="lm-md-code">LAWMIND_OPEN_LAW_EURLEX</code>、
            <code className="lm-md-code">LAWMIND_OPEN_LAW_EGOV_JP</code>
          </li>
          <li>
            闭源：<code className="lm-md-code">LAWMIND_AUTHORITY_ENDPOINT</code> +{" "}
            <code className="lm-md-code">LAWMIND_AUTHORITY_API_KEY</code>
          </li>
          <li>
            法宝 MCP：<code className="lm-md-code">LAWMIND_PKULAW_MODE=mcp_tools_call</code>、
            <code className="lm-md-code">LAWMIND_PKULAW_CASE_ENDPOINT</code>
          </li>
        </ul>
        {envFilePath ? (
          <p className="lm-settings-caption">
            配置文件：<code className="lm-md-code">{envFilePath}</code>
          </p>
        ) : null}
        <p className="lm-settings-caption">
          详见{" "}
          <a
            href={lawmindDocUrl("archive/LAWMIND-INTEGRATIONS")}
            target="_blank"
            rel="noreferrer noopener"
          >
            集成与边界
          </a>
          。
        </p>
      </details>
    </section>
  );
}
