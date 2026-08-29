import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type ContractReviewDraftItem = {
  draftId: string;
  initialPath: string;
  revisedPath: string;
  matterId?: string;
  updatedAt: string;
  lawyerAnnotations?: string;
  status: string;
};

type Props = {
  apiBase: string;
  /** Settings page already shows section title/description. */
  embedInSettings?: boolean;
  onDraftCountChange?: (count: number) => void;
};

function formatPathLabel(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "（未指定路径）";
  }
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? trimmed;
}

export function LawmindContractReviewLearningPanel({
  apiBase,
  embedInSettings = false,
  onDraftCountChange,
}: Props): ReactNode {
  const [items, setItems] = useState<ContractReviewDraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [finalizeInitial, setFinalizeInitial] = useState("");
  const [finalizeFinal, setFinalizeFinal] = useState("");
  const [finalizeMatterId, setFinalizeMatterId] = useState("");
  const [finalizeKeys, setFinalizeKeys] = useState("");
  const [finalizeBusy, setFinalizeBusy] = useState(false);

  useEffect(() => {
    onDraftCountChange?.(items.length);
  }, [items.length, onDraftCountChange]);

  const refresh = useCallback(async () => {
    if (!apiBase?.trim()) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const j = await apiGetJson<{ ok?: boolean; items?: ContractReviewDraftItem[] }>(
        apiBase,
        "/api/learning/contract-review/drafts",
      );
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (err) {
      setLoadError(errorMessage(err, "无法加载待确认改稿"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function acceptDraft(draft: ContractReviewDraftItem): Promise<void> {
    const label = formatPathLabel(draft.revisedPath || draft.initialPath);
    const ok = window.confirm(
      `确认将「${label}」写入修订学习库？\n\n批注与改点会用于后续同类合同参考。`,
    );
    if (!ok) {
      return;
    }
    setAcceptBusyId(draft.draftId);
    setStatusHint(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; revisionId?: string; message?: string },
        { draftId: string }
      >(apiBase, "/api/learning/contract-review/drafts/accept", "POST", {
        draftId: draft.draftId,
      });
      if (j.ok) {
        setStatusHint(j.revisionId ? `已写入学习库（${j.revisionId}）` : "已写入学习库");
        await refresh();
      } else {
        setStatusHint(j.message ?? "写入失败，请稍后重试");
      }
    } catch (err) {
      setStatusHint(errorMessage(err, "写入失败"));
    } finally {
      setAcceptBusyId(null);
    }
  }

  async function finalizePack(): Promise<void> {
    const initialPath = finalizeInitial.trim();
    const finalPath = finalizeFinal.trim();
    if (!initialPath || !finalPath) {
      setStatusHint("请填写初稿与定稿相对路径。");
      return;
    }
    setFinalizeBusy(true);
    setStatusHint(null);
    try {
      const keys = finalizeKeys
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const j = await apiSendJson<
        { ok?: boolean; revisionId?: string; error?: string; message?: string },
        {
          initialPath: string;
          finalPath: string;
          matterId?: string;
          keyModifications?: string[];
        }
      >(apiBase, "/api/learning/contract-revision/finalize", "POST", {
        initialPath,
        finalPath,
        matterId: finalizeMatterId.trim() || undefined,
        keyModifications: keys.length > 0 ? keys : undefined,
      });
      if (!j.ok) {
        setStatusHint(j.message ?? j.error ?? "写入失败");
        return;
      }
      setStatusHint(j.revisionId ? `已写入学习库（${j.revisionId}）` : "已写入学习库");
      setFinalizeInitial("");
      setFinalizeFinal("");
      setFinalizeKeys("");
    } catch (err) {
      setStatusHint(errorMessage(err, "写入失败"));
    } finally {
      setFinalizeBusy(false);
    }
  }

  return (
    <section
      className={`lm-contract-learning${embedInSettings ? " lm-contract-learning--embed" : " lm-settings-group lm-settings-surface"}`}
    >
      {!embedInSettings ? (
        <>
          <h3 className="lm-contract-learning__title">合同修订学习</h3>
          <p className="lm-settings-caption">签批后的改稿样本，确认后写入学习库。</p>
        </>
      ) : null}

      {loadError ? (
        <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
          {loadError}
        </p>
      ) : null}
      {loading ? <p className="lm-settings-caption">加载中…</p> : null}

      {!loading && !loadError && items.length === 0 ? (
        <div className="lm-memory-empty lm-memory-empty--compact">
          <p className="lm-memory-empty__title">暂无待积累改稿</p>
          <p className="lm-memory-empty__desc">在办签批通过后会出现在这里。</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="lm-contract-review-draft-list">
          {items.map((draft) => (
            <li key={draft.draftId} className="lm-contract-review-draft-row">
              <div className="lm-contract-review-draft-main">
                <div className="lm-contract-review-draft-name">{formatPathLabel(draft.revisedPath)}</div>
                <p className="lm-meta">
                  {draft.updatedAt ? draft.updatedAt.slice(0, 10) : ""}
                  {draft.lawyerAnnotations?.trim()
                    ? ` · ${draft.lawyerAnnotations.trim().slice(0, 80)}${
                        draft.lawyerAnnotations.trim().length > 80 ? "…" : ""
                      }`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                disabled={acceptBusyId === draft.draftId}
                onClick={() => void acceptDraft(draft)}
              >
                {acceptBusyId === draft.draftId ? "写入中…" : "确认积累"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="lm-memory-fold lm-memory-fold--nested lm-contract-finalize" data-testid="lm-contract-finalize">
        <summary>
          <span className="lm-memory-fold__label">从文件路径写入</span>
          <span className="lm-memory-fold__hint">少用</span>
        </summary>
        <div className="lm-memory-fold__body">
          <div className="lm-contract-finalize__form">
            <label>
              初稿
              <input
                className="lm-input"
                value={finalizeInitial}
                onChange={(e) => setFinalizeInitial(e.target.value)}
                placeholder="drafts/nda-v1.md"
              />
            </label>
            <label>
              定稿
              <input
                className="lm-input"
                value={finalizeFinal}
                onChange={(e) => setFinalizeFinal(e.target.value)}
                placeholder="drafts/nda-v2.md"
              />
            </label>
            {!embedInSettings ? (
              <>
                <label>
                  案件 ID（可选）
                  <input
                    className="lm-input"
                    value={finalizeMatterId}
                    onChange={(e) => setFinalizeMatterId(e.target.value)}
                  />
                </label>
                <label>
                  关键修改点（可选）
                  <textarea
                    className="lm-input"
                    rows={2}
                    value={finalizeKeys}
                    onChange={(e) => setFinalizeKeys(e.target.value)}
                    placeholder="逗号或换行分隔"
                  />
                </label>
              </>
            ) : null}
            <div className="lm-memory-fold__actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                data-testid="lm-contract-finalize-submit"
                disabled={finalizeBusy}
                onClick={() => void finalizePack()}
              >
                {finalizeBusy ? "写入中…" : "写入样本"}
              </button>
            </div>
          </div>
        </div>
      </details>

      {statusHint ? (
        <p className="lm-settings-caption" role="status">
          {statusHint}
        </p>
      ) : null}
    </section>
  );
}
