import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "../api-client";
import type { MatterOpsSummary } from "../../../../../src/lawmind/matter-ops/types.ts";

type Props = {
  apiBase: string;
  matterId: string;
};

/**
 * Skills E5 — Matter Ops desk (epic-matter-after: KPI + RAID + plan + baseline).
 */
export function MatterOpsBrief(props: Props): ReactNode {
  const { apiBase, matterId } = props;
  const [ops, setOps] = useState<MatterOpsSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [raidText, setRaidText] = useState("");
  const [raidKind, setRaidKind] = useState<"risk" | "assumption" | "issue" | "decision">("risk");
  const [phaseTitle, setPhaseTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const j = await apiGetJson<{ ok?: boolean; ops?: MatterOpsSummary }>(
        apiBase,
        `/api/matters/${encodeURIComponent(matterId)}/ops`,
      );
      if (j.ops) {
        setOps(j.ops);
        setBaseline(j.ops.scope?.baseline ?? "");
      }
    } catch (err) {
      setOps(null);
      setError(errorMessage(err, "加载案件简报失败"));
    }
  };

  useEffect(() => {
    void reload();
  }, [apiBase, matterId]);

  const patchOps = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; ops?: MatterOpsSummary }, Record<string, unknown>>(
        apiBase,
        `/api/matters/${encodeURIComponent(matterId)}/ops`,
        "PATCH",
        body,
      );
      if (j.ops) {
        setOps(j.ops);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveBaseline = async () => {
    await patchOps({ baseline });
  };

  const addRaid = async () => {
    const text = raidText.trim();
    if (!text) {
      return;
    }
    await patchOps({ raid: { kind: raidKind, text } });
    setRaidText("");
  };

  const addPhase = async () => {
    const title = phaseTitle.trim();
    if (!title) {
      return;
    }
    const existing = ops?.plan?.phases ?? [];
    const phases = [...existing, { id: `ph_${Date.now()}`, title }];
    await patchOps({
      plan: { phases, milestones: ops?.plan?.milestones ?? [] },
    });
    setPhaseTitle("");
  };

  const phaseCount = ops?.plan?.phases?.length ?? 0;
  const openRisks = ops?.openRiskCount ?? 0;

  return (
    <section className="lm-matter-ops-brief" data-testid="lm-matter-ops-brief" aria-label="案件简报">
      <header className="lm-matter-ops-brief-head">
        <div>
          <span className="lm-assignment-kicker">案件运营</span>
          <strong>案件简报</strong>
        </div>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          onClick={() => setExpanded((v) => !v)}
          data-testid="lm-matter-ops-expand"
        >
          {expanded ? "收起" : "展开简报"}
        </button>
      </header>

      <div className="lm-matter-ops-kpis" aria-label="案件关键指标">
        <div className="lm-matter-ops-kpi">
          <span className="lm-meta">开放风险</span>
          <strong data-testid="lm-ops-risk-count">{openRisks}</strong>
        </div>
        <div className="lm-matter-ops-kpi">
          <span className="lm-meta">计划阶段</span>
          <strong>{phaseCount}</strong>
        </div>
        <div className="lm-matter-ops-kpi">
          <span className="lm-meta">下一里程碑</span>
          <strong>{ops?.nextMilestone?.title?.trim() || "—"}</strong>
        </div>
        <div className="lm-matter-ops-kpi">
          <span className="lm-meta">范围基线</span>
          <strong>{ops?.scope?.baseline?.trim() ? "已设定" : "未设定"}</strong>
        </div>
      </div>
      {error && !ops ? (
        <p className="lm-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="lm-meta lm-matter-ops-baseline" data-testid="lm-ops-baseline">
        范围：{ops?.scope?.baseline?.trim() || "尚未设定基线"}
      </p>

      {expanded ? (
        <div className="lm-matter-ops-expanded">
          <div className="lm-matter-ops-panels" data-testid="lm-matter-ops-grid">
            <div className="lm-matter-ops-panel">
              <h4>范围基线</h4>
              <label className="lm-job-intake-field">
                <span className="lm-meta">变更受控的工作范围</span>
                <textarea
                  className="lm-input"
                  rows={3}
                  value={baseline}
                  onChange={(e) => setBaseline(e.target.value)}
                  placeholder="本案交付范围、排除事项…"
                />
              </label>
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy}
                onClick={() => void saveBaseline()}
              >
                保存基线
              </button>
            </div>

            <div className="lm-matter-ops-panel">
              <h4>案件计划</h4>
              <label className="lm-job-intake-field">
                <span className="lm-meta">新增阶段</span>
                <input
                  className="lm-input"
                  value={phaseTitle}
                  onChange={(e) => setPhaseTitle(e.target.value)}
                  placeholder="如：初审 / 谈判"
                  data-testid="lm-ops-phase-input"
                />
              </label>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                disabled={busy}
                onClick={() => void addPhase()}
                data-testid="lm-ops-phase-add"
              >
                添加阶段
              </button>
              {ops?.plan?.phases?.length ? (
                <ol className="lm-matter-ops-phases">
                  {ops.plan.phases.map((p, idx) => (
                    <li key={p.id}>
                      <span className="lm-matter-ops-phase-idx">{idx + 1}</span>
                      {p.title}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="lm-meta">尚无计划阶段。</p>
              )}
            </div>

            <div className="lm-matter-ops-panel">
              <h4>风险·假设·问题·决策</h4>
              <label className="lm-job-intake-field">
                <span className="lm-meta">新增条目</span>
                <select
                  className="lm-input"
                  value={raidKind}
                  onChange={(e) => setRaidKind(e.target.value as typeof raidKind)}
                  data-testid="lm-ops-raid-kind"
                >
                  <option value="risk">风险</option>
                  <option value="assumption">假设</option>
                  <option value="issue">问题</option>
                  <option value="decision">决策</option>
                </select>
                <input
                  className="lm-input"
                  value={raidText}
                  onChange={(e) => setRaidText(e.target.value)}
                  placeholder="简要描述…"
                  data-testid="lm-ops-raid-input"
                />
              </label>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                disabled={busy}
                onClick={() => void addRaid()}
                data-testid="lm-ops-raid-add"
              >
                追加记录
              </button>
              {ops?.raidRecent?.length ? (
                <ul className="lm-matter-ops-raid" data-testid="lm-ops-raid">
                  {ops.raidRecent.slice(0, 8).map((r) => (
                    <li key={r.id}>
                      <span className={`lm-matter-ops-raid-kind lm-matter-ops-raid-kind--${r.kind}`}>
                        {r.kind === "risk"
                          ? "风险"
                          : r.kind === "assumption"
                            ? "假设"
                            : r.kind === "issue"
                              ? "问题"
                              : r.kind === "decision"
                                ? "决策"
                                : r.kind}
                      </span>
                      {r.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lm-meta">尚无记录</p>
              )}
            </div>
          </div>
          {error ? <p className="lm-error">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
