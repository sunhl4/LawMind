/**
 * 案件工作台 — 列表、摘要、CASE 档案、任务/草稿/审计时间线、案件内搜索。
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { ArtifactDraft, MatterOverview, MatterSummary, TaskRecord } from "../../../../src/lawmind/types.ts";

type MatterSearchHit = {
  section: string;
  text: string;
  taskId?: string;
};

type AuditEventRow = { kind?: string; detail?: string; timestamp?: string; taskId?: string };

type Props = {
  apiBase: string;
  /** 在对话中带上案件 ID（matter 参数） */
  onUseInChat?: (matterId: string) => void;
};

function DraftCitationBadge(props: { cit: DraftCitationIntegrityView | undefined }): ReactNode {
  const { cit } = props;
  if (!cit) {
    return null;
  }
  if (!cit.checked) {
    return (
      <span className="lm-matter-cit lm-matter-cit-skip" title="无检索快照，无法对照 bundle">
        无快照
      </span>
    );
  }
  if (cit.ok) {
    return (
      <span className="lm-matter-cit lm-matter-cit-ok" title="章节引用 ID 均在本次检索 bundle 内">
        引用OK
      </span>
    );
  }
  return (
    <span
      className="lm-matter-cit lm-matter-cit-warn"
      title={`以下 ID 不在检索 bundle：${cit.missingSourceIds.join(", ")}`}
    >
      引用待核
    </span>
  );
}

export function MatterWorkbench(props: Props) {
  const { apiBase, onUseInChat } = props;
  const [overviews, setOverviews] = useState<MatterOverview[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MatterSummary | null>(null);
  const [overview, setOverview] = useState<MatterOverview | null>(null);
  const [caseMemory, setCaseMemory] = useState("");
  const [caseTruncated, setCaseTruncated] = useState(false);
  const [coreIssues, setCoreIssues] = useState<string[]>([]);
  const [riskNotes, setRiskNotes] = useState<string[]>([]);
  const [progressEntries, setProgressEntries] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [drafts, setDrafts] = useState<ArtifactDraft[]>([]);
  const [draftCitationByTask, setDraftCitationByTask] = useState<
    Record<string, DraftCitationIntegrityView>
  >({});
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);

  const [panelTab, setPanelTab] = useState<"overview" | "case" | "tasks" | "timeline">("overview");
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<MatterSearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newMatterId, setNewMatterId] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const r = await fetch(`${apiBase}/api/matters/overviews`);
      const j = (await r.json()) as { ok?: boolean; overviews?: MatterOverview[] };
      if (!j.ok || !Array.isArray(j.overviews)) {
        throw new Error("加载案件列表失败");
      }
      setOverviews(j.overviews);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (matterId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setSearchHits([]);
      setSearchQ("");
      try {
        const r = await fetch(
          `${apiBase}/api/matters/detail?matterId=${encodeURIComponent(matterId)}`,
        );
        const j = (await r.json()) as {
          ok?: boolean;
          error?: string;
          summary?: MatterSummary;
          overview?: MatterOverview;
          caseMemory?: string;
          caseMemoryTruncated?: boolean;
          coreIssues?: string[];
          riskNotes?: string[];
          progressEntries?: string[];
          artifacts?: string[];
          tasks?: TaskRecord[];
          drafts?: ArtifactDraft[];
          draftCitationIntegrity?: Record<string, DraftCitationIntegrityView>;
          auditEvents?: AuditEventRow[];
        };
        if (!r.ok || !j.ok) {
          throw new Error(j.error ?? "加载案件详情失败");
        }
        setSummary(j.summary ?? null);
        setOverview(j.overview ?? null);
        setCaseMemory(j.caseMemory ?? "");
        setCaseTruncated(Boolean(j.caseMemoryTruncated));
        setCoreIssues(j.coreIssues ?? []);
        setRiskNotes(j.riskNotes ?? []);
        setProgressEntries(j.progressEntries ?? []);
        setArtifacts(j.artifacts ?? []);
        setTasks(j.tasks ?? []);
        setDrafts(j.drafts ?? []);
        setDraftCitationByTask(
          j.draftCitationIntegrity && typeof j.draftCitationIntegrity === "object"
            ? j.draftCitationIntegrity
            : {},
        );
        setAuditEvents(j.auditEvents ?? []);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [selectedId, loadDetail]);

  const runSearch = useCallback(async () => {
    if (!selectedId || !searchQ.trim()) {
      return;
    }
    setSearchBusy(true);
    try {
      const r = await fetch(
        `${apiBase}/api/matters/search?matterId=${encodeURIComponent(selectedId)}&q=${encodeURIComponent(searchQ.trim())}`,
      );
      const j = (await r.json()) as { ok?: boolean; hits?: MatterSearchHit[] };
      if (j.ok && Array.isArray(j.hits)) {
        setSearchHits(j.hits);
      }
    } finally {
      setSearchBusy(false);
    }
  }, [apiBase, selectedId, searchQ]);

  const submitCreate = async () => {
    setCreateBusy(true);
    setCreateErr(null);
    try {
      const r = await fetch(`${apiBase}/api/matters/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matterId: newMatterId.trim() }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; matterId?: string };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "创建失败");
      }
      setShowCreate(false);
      setNewMatterId("");
      await loadList();
      if (j.matterId) {
        setSelectedId(j.matterId);
        setPanelTab("overview");
      }
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <>
      {showCreate && (
        <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="新建案件">
          <div className="lm-wizard lm-modal-matter-create">
            <h2>新建案件</h2>
            <p className="lm-meta">
              案件 ID 须为字母或数字开头，2–128 字符，仅含字母、数字、英文点、下划线、连字符（与引擎{" "}
              <code>matter_id</code> 一致）。
            </p>
            <label className="lm-field">
              <span>matterId</span>
              <input
                type="text"
                value={newMatterId}
                onChange={(e) => setNewMatterId(e.target.value)}
                placeholder="例如 matter-2026-001"
                autoComplete="off"
              />
            </label>
            {createErr && <div className="lm-error">{createErr}</div>}
            <div className="lm-wizard-actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary"
                disabled={createBusy}
                onClick={() => setShowCreate(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="lm-btn"
                disabled={createBusy || !newMatterId.trim()}
                onClick={() => void submitCreate()}
              >
                {createBusy ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="lm-workbench lm-matter-workbench">
      <div className="lm-workbench-list">
        <div className="lm-workbench-list-header">
          <h2>案件</h2>
          <div className="lm-workbench-list-actions">
            <button
              type="button"
              className="lm-btn lm-btn-small"
              onClick={() => {
                setCreateErr(null);
                setNewMatterId("");
                setShowCreate(true);
              }}
            >
              新建案件
            </button>
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => void loadList()}>
              刷新
            </button>
          </div>
        </div>
        {loadingList && <div className="lm-meta">加载中…</div>}
        {listError && <div className="lm-error">{listError}</div>}
        {!loadingList && overviews.length === 0 && (
          <div className="lm-meta lm-workbench-empty">
            暂无案件。在对话中完成带 matterId 的任务后，将在此聚合显示。
          </div>
        )}
        <ul className="lm-workbench-matter-list">
          {overviews.map((o) => (
            <li key={o.matterId}>
              <button
                type="button"
                className={`lm-matter-row ${selectedId === o.matterId ? "active" : ""}`}
                onClick={() => {
                  setSelectedId(o.matterId);
                  setPanelTab("overview");
                }}
              >
                <span className="lm-matter-id">{o.matterId}</span>
                <span className="lm-matter-meta">
                  待办 {o.openTaskCount} · 已交付 {o.renderedTaskCount}
                  {o.topRisk ? ` · ${o.topRisk.slice(0, 42)}…` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lm-workbench-main">
        {!selectedId && <div className="lm-meta lm-workbench-placeholder">选择左侧案件查看档案与进度</div>}
        {selectedId && detailLoading && <div className="lm-meta">加载案件详情…</div>}
        {selectedId && detailError && <div className="lm-error">{detailError}</div>}
        {selectedId && !detailLoading && !detailError && summary && (
          <>
            <div className="lm-workbench-toolbar">
              <div className="lm-workbench-title-block">
                <h2>{selectedId}</h2>
                <p className="lm-matter-headline">{summary.headline}</p>
                <p className="lm-meta">{summary.statusLine}</p>
              </div>
              {onUseInChat && (
                <button type="button" className="lm-btn lm-btn-secondary" onClick={() => onUseInChat(selectedId)}>
                  在对话中关联本案
                </button>
              )}
            </div>

            <div className="lm-tabs lm-workbench-tabs">
              <button
                type="button"
                className={`lm-tab ${panelTab === "overview" ? "active" : ""}`}
                onClick={() => setPanelTab("overview")}
              >
                概览
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "case" ? "active" : ""}`}
                onClick={() => setPanelTab("case")}
              >
                CASE 档案
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "tasks" ? "active" : ""}`}
                onClick={() => setPanelTab("tasks")}
              >
                任务与草稿
              </button>
              <button
                type="button"
                className={`lm-tab ${panelTab === "timeline" ? "active" : ""}`}
                onClick={() => setPanelTab("timeline")}
              >
                审计
              </button>
            </div>

            {panelTab === "overview" && (
              <div className="lm-workbench-panel">
                <section>
                  <h3>关键风险</h3>
                  {summary.keyRisks.length === 0 ? (
                    <p className="lm-meta">暂无</p>
                  ) : (
                    <ul className="lm-bullet-list">
                      {summary.keyRisks.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3>下一步</h3>
                  <ul className="lm-bullet-list">
                    {summary.nextActions.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>近期进展</h3>
                  <ul className="lm-bullet-list">
                    {summary.recentActivity.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </section>
                {overview && (
                  <section className="lm-meta">
                    争点示例：{overview.topIssue ?? "—"} · 风险条数 {overview.riskCount} · 产物{" "}
                    {overview.artifactCount}
                  </section>
                )}
              </div>
            )}

            {panelTab === "case" && (
              <div className="lm-workbench-panel">
                <div className="lm-case-search">
                  <input
                    type="search"
                    placeholder="在本案内搜索（争点、任务、草稿、审计）"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void runSearch();
                      }
                    }}
                  />
                  <button type="button" className="lm-btn lm-btn-secondary" disabled={searchBusy} onClick={() => void runSearch()}>
                    {searchBusy ? "…" : "搜索"}
                  </button>
                </div>
                {searchHits.length > 0 && (
                  <ul className="lm-search-hits">
                    {searchHits.map((h, i) => (
                      <li key={i}>
                        <span className="lm-search-hit-section">{h.section}</span>
                        <div>{h.text}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>核心争点</h3>
                <ul className="lm-bullet-list">
                  {coreIssues.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3>风险与待确认</h3>
                <ul className="lm-bullet-list">
                  {riskNotes.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3>生成产物</h3>
                <ul className="lm-bullet-list">
                  {artifacts.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3>CASE.md {caseTruncated ? "（已截断显示）" : ""}</h3>
                <pre className="lm-case-md">{caseMemory}</pre>
              </div>
            )}

            {panelTab === "tasks" && (
              <div className="lm-workbench-panel lm-two-col">
                <div>
                  <h3>任务</h3>
                  <ul className="lm-bullet-list">
                    {tasks.map((t) => (
                      <li key={t.taskId}>
                        <strong>{t.status}</strong> — {t.summary.slice(0, 200)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>草稿</h3>
                  <ul className="lm-bullet-list">
                    {drafts.map((d) => (
                      <li key={d.taskId}>
                        {d.title} — <em>{d.reviewStatus}</em>{" "}
                        <DraftCitationBadge cit={draftCitationByTask[d.taskId]} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {panelTab === "timeline" && (
              <div className="lm-workbench-panel">
                <h3>工作进展</h3>
                <ul className="lm-bullet-list">
                  {progressEntries.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h3>审计事件</h3>
                <ul className="lm-audit-list">
                  {auditEvents.map((e, i) => (
                    <li key={i}>
                      <span className="lm-audit-kind">{e.kind}</span>
                      <span className="lm-audit-time">{e.timestamp}</span>
                      <div className="lm-audit-detail">{e.detail}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
}
