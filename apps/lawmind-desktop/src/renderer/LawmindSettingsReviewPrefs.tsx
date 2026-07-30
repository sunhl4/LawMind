import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import { apiPatch } from "./lawmind-api-routes.ts";
import { readAutoExportOnApprove, writeAutoExportOnApprove } from "./lawmind-review-prefs";

type CitationMode = "grounded" | "assisted" | "off";

type Props = {
  apiBase?: string;
};

export function LawmindSettingsReviewPrefs({ apiBase }: Props): ReactNode {
  const [autoExport, setAutoExport] = useState(readAutoExportOnApprove);
  const [citationMode, setCitationMode] = useState<CitationMode>("assisted");
  const [citationBusy, setCitationBusy] = useState(false);
  const [citationError, setCitationError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; citationMode?: CitationMode | null }>(
      apiBase,
      "/api/policy/workspace",
    )
      .then((r) => {
        if (cancelled) {
          return;
        }
        const m = r.citationMode;
        if (m === "grounded" || m === "assisted" || m === "off") {
          setCitationMode(m);
        }
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const onAutoExportChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    writeAutoExportOnApprove(next);
    setAutoExport(next);
  };

  const onCitationModeChange = async (next: CitationMode) => {
    const prev = citationMode;
    setCitationMode(next);
    if (!apiBase) {
      return;
    }
    setCitationBusy(true);
    setCitationError(null);
    try {
      const r = await apiPatch(apiBase, "/api/policy/workspace", { citationMode: next });
      const m = r.citationMode as CitationMode | null | undefined;
      if (m === "grounded" || m === "assisted" || m === "off") {
        setCitationMode(m);
      }
    } catch (e) {
      setCitationMode(prev);
      setCitationError(errorMessage(e, "更新引用模式失败"));
    } finally {
      setCitationBusy(false);
    }
  };

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">审核与导出</div>
      <div className="lm-settings-group lm-settings-surface">
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">签批后自动导出 Word</span>
          <input type="checkbox" checked={autoExport} onChange={onAutoExportChange} />
        </label>
        <p className="lm-settings-caption">本地生成 .docx；出稿检查未通过时会询问。默认关闭。</p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <label className="lm-settings-row">
          <span className="lm-settings-key">引用模式</span>
          <select
            className="lm-settings-val-select"
            value={citationMode}
            disabled={!apiBase || citationBusy}
            aria-label="引用模式"
            data-testid="lm-settings-citation-mode"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "grounded" || v === "assisted" || v === "off") {
                void onCitationModeChange(v);
              }
            }}
          >
            <option value="assisted">辅助标注</option>
            <option value="grounded">严格援引</option>
            <option value="off">关闭</option>
          </select>
        </label>
        <p className="lm-settings-caption">
          辅助：缺源阻断导出，未锚定仅提示。关闭：不因引用阻断导出。
        </p>
        {citationMode === "grounded" ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="status">
            严格援引：无检索快照、缺失来源或长段未锚定时将阻断导出 Word。请确保检索与引用锚定齐全。
          </p>
        ) : null}
        {citationError ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
            {citationError}
          </p>
        ) : null}
        {citationBusy ? (
          <p className="lm-settings-caption" role="status" aria-live="polite">
            正在保存…
          </p>
        ) : null}
      </div>
    </div>
  );
}
