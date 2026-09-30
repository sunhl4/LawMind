/**
 * Account home: identity, plan, and where models come from.
 * Cloud sign-in is not live. The page shows that, plus the license and model
 * source this computer actually has, so a later subscription can fill the same rows.
 */

import { useEffect, useState, type ReactNode } from "react";
import { formatUsageSummaryForLawyer } from "../../../../src/lawmind/models/model-usage.ts";
import { apiGetJson } from "./api-client";
import { requestFirstRunReopen } from "./lawmind-firstrun-reopen-bus";
import { LawmindSettingsLicense } from "./LawmindSettingsLicense";
import {
  licenseStatusLabel,
  type LawmindSettingsLicenseState,
} from "./lawmind-settings-models";

type PlatformMode = "proxy" | "platform_key" | "none";

type UsageSummaryPayload = {
  entries?: number;
  totalTokens?: number;
  byTier?: Array<{ tier: string; label: string; entries: number; totalTokens: number }>;
};

type Props = {
  apiBase?: string;
  license?: LawmindSettingsLicenseState | null;
  platformMode?: PlatformMode;
  modelConfigured?: boolean;
  modelName?: string | null;
  onOpenModels: () => void;
};

type LicensePhase = "loading" | "ready" | "error";

function modelSourceLabel(platformMode: PlatformMode, modelConfigured: boolean): string {
  if (platformMode === "proxy" || platformMode === "platform_key") {
    return "组织提供";
  }
  return modelConfigured ? "自备密钥" : "尚未连接";
}

function modelSourceDetail(source: string): string {
  if (source === "组织提供") {
    return "当前模型由组织提供。套餐若另附模型额度，开通后记在用量里。";
  }
  if (source === "自备密钥") {
    return "当前模型来自你自己的密钥。套餐若附带模型，开通后优先用套餐额度，密钥可以保留。";
  }
  return "还没有连接模型。可以在「模型与连接」里填写密钥；套餐开通后也可以改用套餐里的模型。";
}

export function LawmindSettingsAccount({
  apiBase,
  license: licenseFromParent,
  platformMode = "none",
  modelConfigured = false,
  modelName,
  onOpenModels,
}: Props): ReactNode {
  const [license, setLicense] = useState<LawmindSettingsLicenseState | null>(licenseFromParent ?? null);
  const [licensePhase, setLicensePhase] = useState<LicensePhase>(apiBase ? "loading" : "ready");
  const [licenseReload, setLicenseReload] = useState(0);
  const [usageLabel, setUsageLabel] = useState<string | null>(null);
  const modelLabel = modelName?.trim() || "";
  const source = modelSourceLabel(platformMode, modelConfigured);

  useEffect(() => {
    if (!apiBase) {
      setLicense(licenseFromParent ?? null);
      setLicensePhase("ready");
      setUsageLabel(null);
      return undefined;
    }
    let cancelled = false;
    setLicensePhase("loading");
    void (async () => {
      try {
        const health = await apiGetJson<{
          doctor?: { license?: LawmindSettingsLicenseState | null };
          usageSummary?: UsageSummaryPayload;
        }>(apiBase, "/api/health");
        if (cancelled) {
          return;
        }
        setLicense(health.doctor?.license ?? null);
        setLicensePhase("ready");
        const usage = health.usageSummary;
        setUsageLabel(
          usage
            ? formatUsageSummaryForLawyer({
                entries: usage.entries ?? 0,
                totalTokens: usage.totalTokens ?? 0,
                byTier: usage.byTier,
              }, { sinceDays: 30 })
            : null,
        );
      } catch {
        if (!cancelled) {
          setLicensePhase("error");
          setUsageLabel(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, licenseFromParent, licenseReload]);

  const licenseLabel = !apiBase && !license
    ? "本地服务未就绪"
    : licensePhase === "loading"
      ? "读取中"
      : licensePhase === "error"
        ? "暂时读不到"
        : licenseStatusLabel(license);

  return (
    <div className="lm-settings-section" data-testid="lm-settings-account">
      <section className="lm-account-card" aria-label="账号身份">
        <span className="lm-account-avatar" aria-hidden>
          账
        </span>
        <div className="lm-account-copy">
          <div className="lm-account-name" data-testid="lm-account-name">
            尚未登录
          </div>
          <p className="lm-account-detail">
            订阅开放后用邮箱登录。下面是这台电脑现在的许可和模型。
          </p>
        </div>
      </section>

      <section className="lm-settings-group" aria-label="方案">
        <h3 className="lm-settings-subtitle">方案</h3>
        <div className="lm-settings-row">
          <span className="lm-settings-key">当前方案</span>
          <span className="lm-settings-val" data-testid="lm-account-plan">
            本机使用
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">云端订阅</span>
          <span className="lm-pill lm-pill-info" data-testid="lm-account-subscription">
            尚未开放
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">本机许可</span>
          <span className="lm-settings-val" data-testid="lm-account-license">
            {licenseLabel}
          </span>
        </div>
        <p className="lm-settings-caption">
          试用或到期都不锁功能。云端套餐开放后，方案和套餐附带的模型会显示在这里。
        </p>
        {apiBase ? (
          <LawmindSettingsLicense
            embedded
            apiBase={apiBase}
            license={license}
            onChanged={() => setLicenseReload((n) => n + 1)}
          />
        ) : null}
      </section>

      <section className="lm-settings-group" aria-label="模型来源">
        <h3 className="lm-settings-subtitle">模型</h3>
        <div className="lm-settings-row">
          <span className="lm-settings-key">来源</span>
          <span className="lm-settings-val" data-testid="lm-account-model-source">
            {source}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">当前模型</span>
          <span className="lm-settings-val" data-testid="lm-account-model-name">
            {modelLabel || "未设置"}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">套餐内置</span>
          <span className="lm-settings-val" data-testid="lm-account-included-models">
            未包含
          </span>
        </div>
        <p className="lm-settings-caption">{modelSourceDetail(source)}</p>
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-account-open-models"
            onClick={onOpenModels}
          >
            打开模型与连接
          </button>
        </div>
      </section>

      <section className="lm-settings-group" aria-label="本机">
        <h3 className="lm-settings-subtitle">本机</h3>
        <div className="lm-settings-row">
          <span className="lm-settings-key-stack">
            <span className="lm-settings-key">开始时的偏好</span>
            <span className="lm-settings-caption">身份、文风、常交付的文书</span>
          </span>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-reopen-firstrun"
            onClick={() => requestFirstRunReopen()}
          >
            重新填写
          </button>
        </div>
      </section>

      <section className="lm-settings-group" aria-label="用量">
        <h3 className="lm-settings-subtitle">用量</h3>
        <div className="lm-settings-row">
          <span className="lm-settings-key">近 30 天</span>
          <span className="lm-settings-val" data-testid="lm-account-usage">
            {usageLabel ?? "尚无记录"}
          </span>
        </div>
        <p className="lm-settings-caption">
          {usageLabel
            ? "数字来自本机模型调用账本。订阅套餐开放后，套餐额度会另行列出。"
            : "订阅按计费周期计。自备密钥的调用记在本机账本，不记入套餐。"}
        </p>
      </section>
    </div>
  );
}
