/**
 * 草稿审核台 — 列表、全文审阅、通过 / 驳回 / 备注、批准后渲染交付物。
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import { LawmindCitationBanner } from "./LawmindCitationBanner";

type Props = {
  apiBase: string;
  /** 当前助手 ID（写入 PROFILE 时使用） */
  assistantId?: string;
  /** 打开工作区产物目录（Electron） */
  onShowArtifact?: (outputPath: string) => void;
  /** 审核或渲染成功后刷新侧栏任务列表 */
  onRecordsChanged?: () => void;
};

function renderInlineSections(draft: ArtifactDraft): ReactNode {
  return draft.sections.map((s, i) => (
    <section key={i} className="lm-draft-section">
      <h4>{s.heading}</h4>
      <div className="lm-draft-body">{s.body}</div>
    </section>
  ));
}

export function ReviewWorkbench(props: Props) {
  const { apiBase, assistantId = "default", onShowArtifact, onRecordsChanged } = props;
  const [drafts, setDrafts] = useState<ArtifactDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtifactDraft | null>(null);
  const [citationIntegrity, setCitationIntegrity] = useState<DraftCitationIntegrityView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [appendToProfile, setAppendToProfile] = useState(false);
  const [appendToLawyerProfile, setAppendToLawyerProfile] = useState(false);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/drafts`);
      const j = (await r.json()) as { ok?: boolean; drafts?: ArtifactDraft[] };
      if (!j.ok || !Array.isArray(j.drafts)) {
        throw new Error("加载草稿列表失败");
      }
      setDrafts(j.drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const loadDetail = useCallback(
    async (taskId: string) => {
      setDetailLoading(true);
      setDetail(null);
      setCitationIntegrity(null);
      setActionMsg(null);
      try {
        const r = await fetch(`${apiBase}/api/drafts/${encodeURIComponent(taskId)}`);
        const j = (await r.json()) as {
          ok?: boolean;
          draft?: ArtifactDraft;
          citationIntegrity?: DraftCitationIntegrityView;
        };
        if (!r.ok || !j.ok || !j.draft) {
          throw new Error("加载草稿失败");
        }
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
      } catch (e) {
        setActionMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (selectedTaskId) {
      void loadDetail(selectedTaskId);
    } else {
      setDetail(null);
      setCitationIntegrity(null);
    }
  }, [selectedTaskId, loadDetail]);

  const filtered = filter === "pending" ? drafts.filter((d) => d.reviewStatus === "pending") : drafts;

  const submitReview = async (status: "approved" | "rejected" | "modified") => {
    if (!selectedTaskId) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const r = await fetch(`${apiBase}/api/drafts/${encodeURIComponent(selectedTaskId)}/review`, {
        method: "POST",
        body: JSON.stringify({
          status,
          note: note.trim() || undefined,
          appendToProfile,
          appendToLawyerProfile,
          profileAssistantId: assistantId,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        draft?: ArtifactDraft;
        citationIntegrity?: DraftCitationIntegrityView;
      };
      if (!r.ok || !j.ok) {
        const extra =
          (j as { profileAppendFailed?: boolean; lawyerProfileAppendFailed?: boolean })
            .lawyerProfileAppendFailed
            ? "（律师档案未写入，草稿状态已保存）"
            : (j as { profileAppendFailed?: boolean }).profileAppendFailed
              ? "（助手档案未写入，草稿状态已保存）"
              : "";
        throw new Error((j.error ?? "审核失败") + extra);
      }
      setNote("");
      setActionMsg(status === "approved" ? "已通过审核。可点击「渲染交付物」生成文件。" : "已记录审核结果。");
      await loadDrafts();
      if (j.draft) {
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
      }
      onRecordsChanged?.();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const submitRender = async () => {
    if (!selectedTaskId) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const r = await fetch(`${apiBase}/api/drafts/${encodeURIComponent(selectedTaskId)}/render`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        outputPath?: string;
      };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "渲染失败");
      }
      setActionMsg(`已生成：${j.outputPath ?? ""}`);
      await loadDrafts();
      if (j.outputPath && onShowArtifact) {
        onShowArtifact(j.outputPath);
      }
      onRecordsChanged?.();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="lm-workbench lm-review-workbench">
      <div className="lm-workbench-list">
        <div className="lm-workbench-list-header">
          <h2>草稿审核</h2>
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => void loadDrafts()}>
            刷新
          </button>
        </div>
        <div className="lm-review-filters">
          <button
            type="button"
            className={`lm-tab ${filter === "pending" ? "active" : ""}`}
            onClick={() => setFilter("pending")}
          >
            待审核
          </button>
          <button
            type="button"
            className={`lm-tab ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            全部
          </button>
        </div>
        {loading && <div className="lm-meta">加载中…</div>}
        {error && <div className="lm-error">{error}</div>}
        {!loading && filtered.length === 0 && (
          <div className="lm-meta lm-workbench-empty">
            {filter === "pending" ? "暂无待审核草稿。" : "暂无草稿记录。"}
          </div>
        )}
        <ul className="lm-workbench-draft-list">
          {filtered.map((d) => (
            <li key={d.taskId}>
              <button
                type="button"
                className={`lm-draft-row ${selectedTaskId === d.taskId ? "active" : ""}`}
                onClick={() => setSelectedTaskId(d.taskId)}
              >
                <span className="lm-draft-title">{d.title}</span>
                <span className={`lm-badge lm-draft-status-${d.reviewStatus}`}>{d.reviewStatus}</span>
                {d.matterId && <span className="lm-matter-badge">{d.matterId}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lm-workbench-main">
        {!selectedTaskId && (
          <div className="lm-meta lm-workbench-placeholder">选择左侧草稿进行审阅与签批</div>
        )}
        {selectedTaskId && detailLoading && <div className="lm-meta">加载草稿…</div>}
        {selectedTaskId && !detailLoading && detail && (
          <>
            <LawmindCitationBanner view={citationIntegrity} />
            <div className="lm-workbench-toolbar">
              <div>
                <h2>{detail.title}</h2>
                <p className="lm-meta">
                  任务 {detail.taskId} · 输出 {detail.output} · 模板 {detail.templateId}
                  {detail.matterId ? ` · 案件 ${detail.matterId}` : ""}
                </p>
              </div>
              <div className="lm-review-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={actionBusy || detail.reviewStatus !== "pending"}
                  onClick={() => void submitReview("rejected")}
                >
                  驳回
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={actionBusy || detail.reviewStatus !== "pending"}
                  onClick={() => void submitReview("modified")}
                >
                  需修改
                </button>
                <button
                  type="button"
                  className="lm-btn"
                  disabled={actionBusy || detail.reviewStatus !== "pending"}
                  onClick={() => void submitReview("approved")}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-accent"
                  disabled={actionBusy || detail.reviewStatus !== "approved"}
                  onClick={() => void submitRender()}
                >
                  渲染交付物
                </button>
              </div>
            </div>

            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={appendToProfile}
                onChange={(e) => setAppendToProfile(e.target.checked)}
              />
              <span>
                将本条审核摘要记入本助手档案（
                <code>{`assistants/${assistantId}/PROFILE.md`}</code>）
              </span>
            </label>
            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={appendToLawyerProfile}
                onChange={(e) => setAppendToLawyerProfile(e.target.checked)}
              />
              <span>
                将本条审核摘要记入工作区律师档案「八、个人积累」（<code>LAWYER_PROFILE.md</code>）
              </span>
            </label>
            <label className="lm-field lm-review-note">
              <span>审核备注（可选）</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="驳回或修改时请说明理由，将写入审计与案件档案。"
                rows={3}
              />
            </label>
            {actionMsg && <div className="lm-meta lm-review-msg">{actionMsg}</div>}
            {detail.outputPath && (
              <div className="lm-meta">
                已有交付路径：{detail.outputPath}{" "}
                {onShowArtifact && (
                  <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onShowArtifact(detail.outputPath!)}>
                    在文件夹中显示
                  </button>
                )}
              </div>
            )}

            <div className="lm-draft-preview">{renderInlineSections(detail)}</div>
          </>
        )}
      </div>
    </div>
  );
}
