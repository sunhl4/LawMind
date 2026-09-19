/**
 * 许可（离线软门槛）— 设置里的状态与激活区。
 * 到期/未激活只提醒，不锁功能；不联网校验。
 */

import { useCallback, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson } from "./api-client";
import {
  licenseStatusLabel,
  type LawmindSettingsLicenseState,
} from "./lawmind-settings-models";

type Props = {
  apiBase?: string;
  license?: LawmindSettingsLicenseState | null;
  onChanged?: () => void;
};

export function LawmindSettingsLicense({ apiBase, license, onChanged }: Props): ReactNode {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const activate = useCallback(async () => {
    if (!apiBase || !code.trim() || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string; license?: LawmindSettingsLicenseState },
        { code: string }
      >(apiBase, "/api/license/activate", "POST", { code: code.trim() });
      if (!j.ok) {
        throw new Error(j.error || "激活失败");
      }
      setCode("");
      setNotice(j.license?.message ?? "已激活。");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "激活失败");
    } finally {
      setBusy(false);
    }
  }, [apiBase, busy, code, onChanged]);

  const clear = useCallback(async () => {
    if (!apiBase || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; license?: LawmindSettingsLicenseState },
        Record<string, never>
      >(apiBase, "/api/license/clear", "POST", {});
      setNotice(j.license?.message ?? "已清除激活码。");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  }, [apiBase, busy, onChanged]);

  const revealFingerprint = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    try {
      const j = await apiGetJson<{ ok?: boolean; fingerprint?: string }>(
        apiBase,
        "/api/license/fingerprint",
      );
      setFingerprint(j.fingerprint ?? null);
    } catch {
      setFingerprint(null);
    }
  }, [apiBase]);

  const status = license?.status ?? "missing";
  const needsAttention =
    status === "trial_expired" || status === "licensed_expired" || status === "invalid";

  return (
    <section className="lm-settings-block" data-testid="lm-settings-license" aria-label="许可">
      <h3 className="lm-settings-subtitle">许可</h3>
      <p className="lm-settings-caption" role="status">
        本机离线校验；不联网、不上报。试用或到期都不锁功能，只提醒激活。
      </p>
      <div className="lm-settings-row">
        <span className="lm-settings-key">状态</span>
        <span
          className={
            status === "licensed"
              ? "lm-pill lm-pill-success"
              : needsAttention
                ? "lm-pill lm-pill-warn"
                : "lm-pill lm-pill-info"
          }
          data-testid="lm-license-status"
          data-status={status}
        >
          {licenseStatusLabel(license)}
        </span>
      </div>
      {license?.message ? (
        <p className="lm-settings-caption" role="status" data-testid="lm-license-message">
          {license.message}
        </p>
      ) : null}
      {license?.expiresAt ? (
        <p className="lm-settings-caption">到期日：{license.expiresAt.slice(0, 10)}</p>
      ) : null}

      <div className="lm-settings-row">
        <span className="lm-settings-key">激活码</span>
        <input
          className="lm-input"
          data-testid="lm-license-code-input"
          placeholder="粘贴激活码（发版方提供）"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="lm-settings-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-license-activate"
          disabled={busy || !code.trim()}
          onClick={() => void activate()}
        >
          {busy ? "校验中…" : "激活"}
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-license-clear"
          disabled={busy}
          onClick={() => void clear()}
        >
          清除激活码
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          data-testid="lm-license-fingerprint"
          onClick={() => void revealFingerprint()}
        >
          显示本机指纹
        </button>
      </div>
      {fingerprint ? (
        <p className="lm-settings-caption" data-testid="lm-license-fingerprint-value">
          本机指纹：<code className="lm-md-code">{fingerprint}</code>
          （绑机许可需在签发时提供）
        </p>
      ) : null}
      {notice ? (
        <p className="lm-settings-caption" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
