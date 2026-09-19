/**
 * 交办成绩单 + 支持诊断包（Doctor 的律师可见区）。
 * 成绩单只读展示；诊断包导出前须律师确认（按钮走二次点击确认）。
 */

import { useCallback, useState, type ReactNode } from "react";
import { apiGetJson, fetchApi } from "./api-client";
import { errorMessage } from "./api-client";

export type ScorecardRow = {
  id: string;
  label: string;
  value: string;
  rate: number | null;
  detail?: string;
};

type Props = {
  apiBase?: string;
  rows: ScorecardRow[];
};

export function LawmindSettingsScorecard({ apiBase, rows }: Props): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 第一步：先看将包含哪些文件（不下载）。 */
  const previewBundle = useCallback(async () => {
    if (!apiBase || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const j = await apiGetJson<{
        ok?: boolean;
        files?: Array<{ name: string; bytes: number }>;
        note?: string;
      }>(apiBase, "/api/support/bundle");
      const names = (j.files ?? []).map((f) => f.name).join("、");
      setMessage(`${j.note ?? ""}\n将包含：${names}`);
      setConfirming(true);
    } catch (e) {
      setError(errorMessage(e, "无法生成诊断包预览"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, busy]);

  /** 第二步：律师确认后真正下载。 */
  const downloadBundle = useCallback(async () => {
    if (!apiBase || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetchApi(`${apiBase}/api/support/bundle?download=1`);
      if (!response.ok) {
        throw new Error(`下载失败（${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lawmind-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("诊断包已下载（已脱敏）。");
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e, "下载诊断包失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, busy]);

  return (
    <section
      className="lm-settings-block"
      data-testid="lm-settings-scorecard"
      aria-label="交办成绩单"
    >
      <h3 className="lm-settings-subtitle">交办成绩单</h3>
      <p className="lm-settings-caption" role="note">
        只统计本机数据，不联网上报。样本不足时显示「暂无样本」，不编造比例。
      </p>
      <div className="lm-settings-scorecard">
        {rows.map((row) => (
          <div className="lm-settings-scorecard-row" key={row.id} data-testid={`lm-scorecard-${row.id}`}>
            <span className="lm-settings-key">{row.label}</span>
            <span className="lm-settings-scorecard-value">{row.value}</span>
            {row.detail ? <span className="lm-settings-caption">{row.detail}</span> : null}
          </div>
        ))}
      </div>

      <div className="lm-settings-actions">
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-support-bundle-preview"
          disabled={busy}
          onClick={() => void previewBundle()}
        >
          导出诊断包
        </button>
        {confirming ? (
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            data-testid="lm-support-bundle-download"
            disabled={busy}
            onClick={() => void downloadBundle()}
          >
            确认下载（已脱敏）
          </button>
        ) : null}
      </div>
      {message ? (
        <p className="lm-settings-caption" role="status" data-testid="lm-support-bundle-message">
          {message}
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
