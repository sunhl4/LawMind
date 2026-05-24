import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client.js";

type Annotation = {
  id: string;
  sourceId: string;
  kind: string;
  comment: string;
  createdBy: string;
  createdAt: string;
};

type Props = {
  apiBase: string;
  sourceId: string;
  taskId?: string;
  matterId?: string;
};

export function LawmindSourceAnnotations({ apiBase, sourceId, taskId, matterId }: Props): ReactNode {
  const [items, setItems] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (taskId) {
        params.set("taskId", taskId);
      }
      if (matterId) {
        params.set("matterId", matterId);
      }
      const j = await apiGetJson<{ ok?: boolean; items?: Annotation[] }>(
        apiBase,
        `/api/sources/${encodeURIComponent(sourceId)}/annotations?${params.toString()}`,
      );
      if (!j.ok || !Array.isArray(j.items)) {
        throw new Error("加载标注失败");
      }
      setItems(j.items);
    } catch (e) {
      setErr(errorMessage(e, "加载标注失败"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, sourceId, taskId, matterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onSubmit = useCallback(async () => {
    const text = comment.trim();
    if (!text) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string },
        { comment: string; taskId?: string; matterId?: string; createLearning: boolean }
      >(
        apiBase,
        `/api/sources/${encodeURIComponent(sourceId)}/annotations`,
        "POST",
        {
          comment: text,
          taskId,
          matterId,
          createLearning: true,
        },
      );
      if (!j.ok) {
        throw new Error(j.error ?? "保存标注失败");
      }
      setComment("");
      await reload();
    } catch (e) {
      setErr(errorMessage(e, "保存标注失败"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, comment, matterId, reload, sourceId, taskId]);

  return (
    <div className="lm-source-annotations">
      <div className="lm-source-popover-section-title">来源标注</div>
      {loading ? <p className="lm-meta">加载标注…</p> : null}
      {err ? <p className="lm-error-text">{err}</p> : null}
      {items.length > 0 ? (
        <ul className="lm-source-annotations__list">
          {items.map((a) => (
            <li key={a.id}>
              <span className="lm-badge">{a.kind}</span> {a.comment}
              <span className="lm-meta"> · {a.createdBy}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lm-meta">暂无标注。</p>
      )}
      <label className="lm-source-annotations__form">
        <span className="lm-meta">添加审查意见（将同步为待采纳记忆建议）</span>
        <textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="例如：该法条引用需核对时效性…"
        />
        <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" disabled={busy} onClick={() => void onSubmit()}>
          保存标注
        </button>
      </label>
    </div>
  );
}
