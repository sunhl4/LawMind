/**
 * 交付模板（上传 .docx / .pptx）：列表、拖拽/选取导入、登记、扫描预览。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { readLawmindFsDragFromDataTransfer } from "./lawmind-file-drag";
import { confirmDialog } from "./lawmind-confirm-dialog";

type UploadedRow = {
  id: string;
  format: string;
  label: string;
  enabled: boolean;
  version: number;
};

type TemplateFormat = "docx" | "pptx";

type SelectedSource =
  | { kind: "absolute"; absolutePath: string; fileName: string }
  | { kind: "workspace"; relPath: string; fileName: string };

type Props = {
  apiBase: string;
  /** Optional materials folder — for resolving project-tree drops. */
  projectDir?: string | null;
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

function isTemplateExt(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".docx") || lower.endsWith(".pptx");
}

function fileNameFromPath(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function displayNameFromFileName(fileName: string): string {
  return fileName.replace(/\.(docx|pptx|ppt)$/i, "").trim() || fileName;
}

function electronFilePath(file: File): string | null {
  const withPath = file as File & { path?: string };
  return typeof withPath.path === "string" && withPath.path.trim() ? withPath.path.trim() : null;
}

export function LawmindSettingsTemplates({ apiBase, projectDir }: Props): ReactNode {
  const [uploaded, setUploaded] = useState<UploadedRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [source, setSource] = useState<SelectedSource | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [format, setFormat] = useState<TemplateFormat>("docx");
  const [scanPreview, setScanPreview] = useState<string[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const applySelectedFile = useCallback((next: SelectedSource) => {
    setSource(next);
    setScanPreview(null);
    setHint(null);
    setFormat(inferFormatFromPath(next.fileName));
    setDisplayName((prev) => (prev.trim() ? prev : displayNameFromFileName(next.fileName)));
  }, []);

  const pickFromDialog = useCallback(async () => {
    const dlg = window.lawmindDesktop?.openFilesDialog;
    if (!dlg) {
      fileInputRef.current?.click();
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const r = await dlg({
        title: "选择 Word / PPT 模板",
        multi: false,
        filters: [
          { name: "Office 模板", extensions: ["docx", "pptx"] },
          { name: "Word", extensions: ["docx"] },
          { name: "PowerPoint", extensions: ["pptx"] },
        ],
      });
      if (r.canceled || !r.filePaths?.[0]) {
        return;
      }
      const abs = r.filePaths[0];
      const name = fileNameFromPath(abs);
      if (!isTemplateExt(name)) {
        setHint("请选择 .docx 或 .pptx 文件");
        return;
      }
      applySelectedFile({ kind: "absolute", absolutePath: abs, fileName: name });
    } catch (e) {
      setHint(errorMessage(e, "无法打开文件选择"));
    } finally {
      setBusy(false);
    }
  }, [applySelectedFile]);

  const onNativeFileInput = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) {
        return;
      }
      if (!isTemplateExt(file.name)) {
        setHint("请选择 .docx 或 .pptx 文件");
        return;
      }
      const abs = electronFilePath(file);
      if (!abs) {
        setHint("请使用「选择文件」或在桌面应用中拖入文件");
        return;
      }
      applySelectedFile({ kind: "absolute", absolutePath: abs, fileName: file.name });
    },
    [applySelectedFile],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (busy) {
        return;
      }

      const fsDrag = readLawmindFsDragFromDataTransfer(e.dataTransfer);
      if (fsDrag) {
        if (fsDrag.kind !== "file") {
          setHint("请拖入文件（不要拖文件夹）");
          return;
        }
        const name = fileNameFromPath(fsDrag.relPath);
        if (!isTemplateExt(name)) {
          setHint("请拖入 .docx 或 .pptx 文件");
          return;
        }
        if (fsDrag.root === "workspace") {
          applySelectedFile({
            kind: "workspace",
            relPath: fsDrag.relPath.replace(/^\/+/, ""),
            fileName: name,
          });
          return;
        }
        const base = projectDir?.trim();
        if (!base) {
          setHint("尚未选择本机材料夹，无法使用侧栏「工作区」外的文件；请改用「选择文件」");
          return;
        }
        const abs = `${base.replace(/[/\\]+$/, "")}/${fsDrag.relPath.replace(/^\/+/, "")}`;
        applySelectedFile({ kind: "absolute", absolutePath: abs, fileName: name });
        return;
      }

      const file = e.dataTransfer.files?.[0];
      if (file) {
        onNativeFileInput(e.dataTransfer.files);
        return;
      }
      setHint("未识别到可导入的文件");
    },
    [applySelectedFile, busy, onNativeFileInput, projectDir],
  );

  const sourcePayload = (): { path?: string; absolutePath?: string } | null => {
    if (!source) {
      return null;
    }
    if (source.kind === "absolute") {
      return { absolutePath: source.absolutePath };
    }
    return { path: source.relPath };
  };

  const onScan = async () => {
    if (!apiBase?.trim()) {
      return;
    }
    const payload = sourcePayload();
    if (!payload) {
      setHint("请先选择或拖入模板文件");
      return;
    }
    if (format === "pptx") {
      setHint("PPT 模板暂不支持扫描占位符；可直接登记。");
      return;
    }
    setBusy(true);
    setHint(null);
    setScanPreview(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; placeholders?: string[]; error?: string },
        { path?: string; absolutePath?: string }
      >(apiBase, "/api/templates/scan", "POST", payload);
      if (j.ok && Array.isArray(j.placeholders)) {
        setScanPreview(j.placeholders);
        setHint(
          j.placeholders.length
            ? `可识别 ${j.placeholders.length} 个占位符`
            : "未发现 {{占位符}}，仍可登记",
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
    const payload = sourcePayload();
    const name = displayName.trim();
    if (!payload || !name) {
      setHint("请选择文件并填写显示名称");
      return;
    }
    const id = templateId.trim() ? templateId.trim() : slugUploadIdFromLabel(name);
    const pathForFormat = source?.fileName ?? "";
    const resolvedFormat =
      format === "pptx" || inferFormatFromPath(pathForFormat) === "pptx" ? "pptx" : "docx";
    setBusy(true);
    setHint(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string; template?: { id: string; label: string } },
        {
          id: string;
          label: string;
          path?: string;
          absolutePath?: string;
          format: TemplateFormat;
        }
      >(apiBase, "/api/templates/register", "POST", {
        id,
        label: name,
        format: resolvedFormat,
        ...payload,
      });
      if (j.ok) {
        setHint(`已登记：${j.template?.label ?? name}`);
        setSource(null);
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
    if (!apiBase?.trim()) {
      return;
    }
    if (
      !(await confirmDialog({
        title: `确定移除模板「${id}」？`,
        body: "已生成的文书不受影响。",
        confirmLabel: "移除",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const q = new URLSearchParams({ id });
      await apiSendJson(apiBase, `/api/templates/uploaded?${q.toString()}`, "DELETE", undefined);
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
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">交付模板</div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-subtitle">已登记</div>
        {loadError ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
            {loadError}
          </p>
        ) : null}
        {uploaded.length === 0 && !loadError ? (
          <p className="lm-settings-caption">暂无模板，请在下方导入</p>
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
        <div className="lm-settings-subtitle">导入模板</div>

        <div
          className={`lm-template-dropzone${dragOver ? " is-dragover" : ""}${source ? " has-file" : ""}`}
          data-testid="lm-template-dropzone"
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {source ? (
            <div className="lm-template-dropzone__selected">
              <div className="lm-template-dropzone__file">
                <span className="lm-template-dropzone__name">{source.fileName}</span>
                <span className="lm-template-dropzone__path" title={source.kind === "absolute" ? source.absolutePath : source.relPath}>
                  {source.kind === "absolute" ? source.absolutePath : source.relPath}
                </span>
              </div>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                disabled={busy}
                onClick={() => {
                  setSource(null);
                  setScanPreview(null);
                }}
              >
                清除
              </button>
            </div>
          ) : (
            <div className="lm-template-dropzone__empty">
              <p className="lm-template-dropzone__title">拖拽 .docx / .pptx 到此处</p>
              <p className="lm-template-dropzone__hint">或从本机选择文件</p>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                disabled={busy}
                data-testid="lm-template-pick"
                onClick={() => void pickFromDialog()}
              >
                选择文件
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="lm-template-dropzone__input"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              onNativeFileInput(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="lm-settings-template-form">
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
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="如：所函、办案备忘录"
            />
          </label>
          <label>
            <span>模板 ID（可选）</span>
            <input
              type="text"
              className="lm-settings-template-input"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              placeholder="留空自动生成"
            />
          </label>
        </div>

        <div className="lm-settings-actions lm-settings-template-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy || !source || format === "pptx"}
            title={format === "pptx" ? "PPT 暂不支持占位符扫描" : undefined}
            onClick={() => void onScan()}
          >
            扫描占位符
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            disabled={busy || !source || !displayName.trim()}
            onClick={() => void onRegister()}
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
