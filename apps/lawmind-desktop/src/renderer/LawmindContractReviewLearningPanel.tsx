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
};

function formatPathLabel(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "（未指定路径）";
  }
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? trimmed;
}

export function LawmindContractReviewLearningPanel({ apiBase }: Props): ReactNode {
  const [items, setItems] = useState<ContractReviewDraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);

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
      setLoadError(errorMessage(err, "无法加载合同审查学习草稿"));
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
      `确认将「${label}」验收通过并写入合同修订积累库？\n\n此操作会把律师批注与要点转入 learning/contract-revisions/。`,
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
        setStatusHint(
          j.revisionId
            ? `已写入积累包（${j.revisionId}）。`
            : "验收通过，已写入合同修订积累库。",
        );
        await refresh();
      } else {
        setStatusHint(j.message ?? "验收失败，请稍后重试。");
      }
    } catch (err) {
      setStatusHint(errorMessage(err, "验收失败"));
    } finally {
      setAcceptBusyId(null);
    }
  }

  return (
    <section className="lm-settings-group lm-settings-surface" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>合同审查学习</h3>
      <p className="lm-meta">
        审核通过且草稿配置了 <code>contractRevisionCapture</code> 时，系统会自动积累合同修订样本。
        此处列出待验收草稿，律师确认后可写入私有学习库。
      </p>

      {loadError ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{loadError}</p>
        </div>
      ) : null}
      {loading ? <p className="lm-meta">加载中…</p> : null}

      {!loading && !loadError && items.length === 0 ? (
        <div className="lm-callout lm-callout-muted" role="note">
          <p className="lm-callout-body">
            暂无待验收草稿。在文书台审核通过合同类交付物，且任务草稿带有合同修订捕获配置时，会自动在此出现。
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="lm-contract-review-draft-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((draft) => (
            <li
              key={draft.draftId}
              className="lm-contract-review-draft-row"
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--lm-border, #e5e7eb)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {formatPathLabel(draft.revisedPath)} → 积累
                  </div>
                  <p className="lm-meta" style={{ margin: "4px 0 0" }}>
                    初稿：{draft.initialPath}
                    {draft.matterId ? ` · 案件 ${draft.matterId}` : ""}
                    {draft.updatedAt ? ` · 更新 ${draft.updatedAt.slice(0, 10)}` : ""}
                  </p>
                  {draft.lawyerAnnotations?.trim() ? (
                    <p className="lm-meta" style={{ margin: "4px 0 0" }}>
                      批注：{draft.lawyerAnnotations.trim().slice(0, 160)}
                      {draft.lawyerAnnotations.trim().length > 160 ? "…" : ""}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  disabled={acceptBusyId === draft.draftId}
                  onClick={() => void acceptDraft(draft)}
                >
                  {acceptBusyId === draft.draftId ? "写入中…" : "验收通过"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {statusHint ? (
        <p className="lm-meta" role="status" style={{ marginTop: 8 }}>
          {statusHint}
        </p>
      ) : null}
    </section>
  );
}
