/**
 * 交付模板（上传 .docx / .pptx）：列表、登记、扫描预览。
 * 复杂逻辑在服务端与 lawmind 核心包中完成，这里只做最少操作。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type UploadedRow = {
  id: string;
  format: string;
  label: string;
  enabled: boolean;
  version: number;
};

type TemplateFormat = "docx" | "pptx";

type Props = {
  apiBase: string;
};

function slugUploadIdFromLabel(label: string): string {
  const raw = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+/, "");
  const core = (raw.length >= 2 ? raw : `memo-${raw || "1"}`).slice(0, 48);
  return `upload/${core}`;
}

function templateFeedbackCalloutClass(message: string): string {
  if (/失败|错误|无法|无效|无结果/.test(message)) {
    return "lm-callout lm-callout-danger";
  }
  return "lm-callout lm-callout-muted";
}

function inferFormatFromPath(rel: string): TemplateFormat {
  return rel.toLowerCase().endsWith(".pptx") || rel.toLowerCase().endsWith(".ppt") ? "pptx" : "docx";
}

export function LawmindSettingsTemplates({ apiBase }: Props): ReactNode {
  const [uploaded, setUploaded] = useState<UploadedRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const [filePath, setFilePath] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [format, setFormat] = useState<TemplateFormat>("docx");
  const [scanPreview, setScanPreview] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    if (!apiBase?.trim()) {
      return;
    }
    setLoadError(null);
    try {
      const j = await apiGetJson<{ ok?: boolean; uploaded?: UploadedRow[] }>(apiBase, "/api/templates");
      if (j.ok && Array.isArray(j.uploaded)) {
        setUploaded(j.uploaded);
      } else {
        setLoadError("无法加载模板列表");
      }
    } catch (e) {
      setLoadError(errorMessage(e, "无法加载模板列表"));
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onScan = async () => {
    if (!apiBase?.trim() || !filePath.trim()) {
      setHint("请填写相对路径（相对工作区根目录）");
      return;
    }
    if (format === "pptx") {
      setHint("PPT 模板暂不支持扫描 {{占位符}}；可直接登记，渲染时按内置字段填充。");
      return;
    }
    setBusy(true);
    setHint(null);
    setScanPreview(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; placeholders?: string[]; error?: string },
        { path: string }
      >(apiBase, "/api/templates/scan", "POST", { path: filePath.trim() });
      if (j.ok && Array.isArray(j.placeholders)) {
        setScanPreview(j.placeholders);
        setHint(
          j.placeholders.length
            ? `可识别 ${j.placeholders.length} 个占位符，登记后将自动与文书字段对应（能识别的会填入）。`
            : "未在文档中发现 {{占位符}}，仍可作为空白模板登记。",
        );
      } else {
        setHint("扫描无结果");
      }
    } catch (e) {
      setHint(errorMessage(e, "扫描失败"));
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    if (!apiBase?.trim()) {
      return;
    }
    const rel = filePath.trim();
    const name = displayName.trim();
    if (!rel || !name) {
      setHint("请填写「文件路径」和「显示名称」");
      return;
    }
    const id = templateId.trim() ? templateId.trim() : slugUploadIdFromLabel(name);
    const resolvedFormat = format === "pptx" || inferFormatFromPath(rel) === "pptx" ? "pptx" : "docx";
    setBusy(true);
    setHint(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string; template?: { id: string; label: string } },
        { id: string; label: string; path: string; format: TemplateFormat }
      >(apiBase, "/api/templates/register", "POST", {
        id,
        label: name,
        path: rel,
        format: resolvedFormat,
      });
      if (j.ok) {
        setHint(`已登记：${j.template?.label ?? name}（${resolvedFormat}）`);
        setFilePath("");
        setDisplayName("");
        setTemplateId("");
        setScanPreview(null);
        await refresh();
      }
    } catch (e) {
      setHint(errorMessage(e, "登记失败"));
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (id: string, enabled: boolean) => {
    if (!apiBase?.trim()) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/templates/enabled", "POST", { id, enabled });
      await refresh();
    } catch (e) {
      setHint(errorMessage(e, "更新失败"));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!apiBase?.trim() || !window.confirm(`确定移除模板「${id}」？\n已生成的文书不受影响。`)) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const q = new URLSearchParams({ id });
      await apiSendJson(
        apiBase,
        `/api/templates/uploaded?${q.toString()}`,
        "DELETE",
        undefined,
      );
      setHint("已删除");
      await refresh();
    } catch (e) {
      setHint(errorMessage(e, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  if (!apiBase?.trim()) {
    return null;
  }

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">交付模板</div>
      <p className="lm-settings-hint lm-settings-template-intro">
        登记工作区内的 <strong>.docx</strong> 或 <strong>.pptx</strong>
        （路径相对工作区根）。Word 可用 <code>{"{{title}}"}</code> 等占位符；PPT
        登记后在文书台渲染时选用。内置文书类型也可直接导出 pptx（见「版本与文书类型」清单中的默认输出）。
      </p>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-subtitle">已登记模板</div>
        {loadError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{loadError}</p>
          </div>
        ) : null}
        {uploaded.length === 0 && !loadError ? (
          <div className="lm-settings-empty" role="status">
            <div className="lm-collab-empty-title">暂无登记模板</div>
            <p className="lm-collab-empty-body">在下方填写相对路径并登记后，列表会显示在此处。</p>
          </div>
        ) : null}
        <ul className="lm-settings-template-list">
          {uploaded.map((row) => (
            <li key={row.id} className="lm-settings-template-row">
              <div className="lm-settings-template-row-main">
                <span className="lm-settings-template-label">{row.label}</span>
                <code className="lm-settings-template-id" title={row.id}>
                  {row.id}
                </code>
                <span className="lm-meta">{row.format || "docx"}</span>
                <span className="lm-meta">v{row.version}</span>
              </div>
              <div className="lm-settings-template-row-actions">
                <label className="lm-settings-template-check">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={busy}
                    onChange={(e) => {
                      void onToggle(row.id, e.target.checked);
                    }}
                  />
                  选用
                </label>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  disabled={busy}
                  onClick={() => {
                    void onDelete(row.id);
                  }}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-subtitle">登记新模板</div>
        <div className="lm-settings-template-form">
          <label>
            <span>文件路径（相对工作区）</span>
            <input
              type="text"
              className="lm-settings-template-input"
              value={filePath}
              onChange={(e) => {
                const next = e.target.value;
                setFilePath(next);
                setScanPreview(null);
                setFormat(inferFormatFromPath(next));
              }}
              placeholder="例如 projects/某项目/templates/所函.docx"
              autoComplete="off"
            />
          </label>
          <label>
            <span>格式</span>
            <select
              className="lm-settings-template-input"
              value={format}
              onChange={(e) => setFormat(e.target.value as TemplateFormat)}
            >
              <option value="docx">Word（.docx）</option>
              <option value="pptx">演示文稿（.pptx）</option>
            </select>
          </label>
          <label>
            <span>显示名称</span>
            <input
              type="text"
              className="lm-settings-template-input"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
              placeholder="如：所函、办案备忘录、汇报 PPT"
            />
          </label>
          <label>
            <span>模板 ID（可选）</span>
            <input
              type="text"
              className="lm-settings-template-input"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
              }}
              placeholder="留空则根据显示名称生成，如 upload/memos"
            />
          </label>
        </div>
        <div className="lm-settings-actions lm-settings-template-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy || format === "pptx"}
            title={format === "pptx" ? "PPT 暂不支持占位符扫描" : undefined}
            onClick={() => {
              void onScan();
            }}
          >
            扫描占位符
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            disabled={busy}
            onClick={() => {
              void onRegister();
            }}
          >
            登记
          </button>
        </div>
        {scanPreview && scanPreview.length > 0 ? (
          <p className="lm-meta lm-settings-template-scan">
            本文件中：<code>{scanPreview.join(", ")}</code>
          </p>
        ) : null}
        {hint ? (
          <div className={templateFeedbackCalloutClass(hint)} role="status">
            <p className="lm-callout-body">{hint}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
