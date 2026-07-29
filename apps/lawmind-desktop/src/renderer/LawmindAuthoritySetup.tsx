/**
 * 权威库连接说明向导（C1-6）— 展示 Doctor live 状态与 env 契约；
 * 写入密钥仍走本机 `.env.lawmind` / API 配置向导（不在此粘贴落盘密钥）。
 */

import type { ReactNode } from "react";
import {
  authorityCorpusStatusLabel,
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
        默认 <code className="lm-md-code">open</code>
        ：本地开源语料（内置少量 sample，非正式完整法库；可扩充 CORPUS）。闭源法宝/Lexis
        仅作手动 BYOK 占位（Lexis 适配器尚未实现时显示「适配器未实现」，不是端点配错）。无命中则拒答/缺源，不会编造法条。
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
              ? "该 provider 适配器尚未实现；端点可能已记录但不会探测报绿"
              : status === "sample-ready"
                ? "内置演示 sample，非正式完整法库"
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
      <ul className="lm-settings-caption">
        <li>
          <code className="lm-md-code">LAWMIND_AUTHORITY_PROVIDER</code> = open | generic | pkulaw |
          lexis
        </li>
        <li>
          开源：<code className="lm-md-code">LAWMIND_OPEN_LAW_CORPUS</code>（可选 JSONL）、
          <code className="lm-md-code">LAWMIND_OPEN_LAW_MODE</code>=local|hybrid|npc_flk
        </li>
        <li>
          闭源手动：<code className="lm-md-code">LAWMIND_AUTHORITY_ENDPOINT</code> +{" "}
          <code className="lm-md-code">LAWMIND_AUTHORITY_API_KEY</code>
        </li>
      </ul>
      {envFilePath ? (
        <p className="lm-settings-caption">
          配置文件：<code className="lm-md-code">{envFilePath}</code>
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
      <p className="lm-settings-caption lm-settings-caption--warn" role="note">
        开源路径开箱即用（演示 sample ≠ 完整法库）。扩充：设置{" "}
        <code className="lm-md-code">LAWMIND_OPEN_LAW_CORPUS</code>
        （JSONL 格式见 open-law README）。闭源法宝/Lexis：见{" "}
        <code className="lm-md-code">docs/LAWMIND-EXTERNAL-INTEGRATIONS.md</code> §10 手动清单。
      </p>
    </section>
  );
}
