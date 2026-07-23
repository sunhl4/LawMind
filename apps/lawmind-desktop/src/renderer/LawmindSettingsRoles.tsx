/**
 * LawmindSettingsRoles — 内置岗位（只读）+ 默认分工 / 进化指标（折叠）。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { loadAgentFleet } from "./lawmind-agent-fleet-api";
import type { AgentFleetSummary } from "./lawmind-agent-fleet-api";
import {
  mapToRows,
  rowsToMap,
  type RoutingAssigneeRef,
  type RoutingMapRow,
} from "./lawmind-routing-defaults-form";

type Role = {
  roleId: string;
  displayName: string;
  mission: string;
  allowedToolNames?: string[];
  allowedDeliverableTypes: string[];
  memoryScope: string[];
  riskCeiling: "low" | "medium" | "high";
  defaultEscalateTo?: string;
  reviewChecklist: string[];
};

type Props = {
  apiBase: string;
};

type SpecRow = NonNullable<AgentFleetSummary["specialization"]>[string];
type GrowthRow = NonNullable<AgentFleetSummary["growth"]>["assistants"][number];

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

const RISK_LABEL: Record<Role["riskCeiling"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

export function LawmindSettingsRoles({ apiBase }: Props): ReactNode {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [specialization, setSpecialization] = useState<Record<string, SpecRow>>({});
  const [growthRows, setGrowthRows] = useState<GrowthRow[]>([]);
  const [windowDays, setWindowDays] = useState(30);
  const [forcePeerReview, setForcePeerReview] = useState<boolean | null>(null);
  const [byKindRows, setByKindRows] = useState<RoutingMapRow[]>([]);
  const [byDeliverableRows, setByDeliverableRows] = useState<RoutingMapRow[]>([]);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingMsg, setRoutingMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!apiBase?.trim()) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [j, fleet, routing] = await Promise.all([
        apiGetJson<{ ok?: boolean; roles?: Role[] }>(apiBase, "/api/roles"),
        loadAgentFleet(apiBase, null, { windowDays: 30 }).catch(() => null),
        apiGetJson<{
          ok?: boolean;
          defaults?: {
            forcePeerReview?: boolean | null;
            byKind?: Record<string, RoutingAssigneeRef>;
            byDeliverableType?: Record<string, RoutingAssigneeRef>;
          };
        }>(apiBase, "/api/routing/defaults").catch(() => null),
      ]);
      if (j.ok && Array.isArray(j.roles)) {
        setRoles(j.roles);
        if (j.roles.length > 0 && !selectedRoleId) {
          setSelectedRoleId(j.roles[0].roleId);
        }
      } else {
        setLoadError("无法加载岗位列表");
      }
      setSpecialization(fleet?.specialization ?? {});
      setGrowthRows(fleet?.growth?.assistants ?? []);
      setWindowDays(fleet?.growth?.windowDays ?? 30);
      if (routing?.ok) {
        const v = routing.defaults?.forcePeerReview;
        setForcePeerReview(v === true || v === false ? v : null);
        setByKindRows(mapToRows(routing.defaults?.byKind));
        setByDeliverableRows(mapToRows(routing.defaults?.byDeliverableType));
      }
    } catch (err) {
      setLoadError(errorMessage(err, "无法加载岗位列表"));
    } finally {
      setLoading(false);
    }
  }, [apiBase, selectedRoleId]);

  const saveRoutingDefaults = async () => {
    if (!apiBase?.trim()) {
      return;
    }
    setRoutingBusy(true);
    setRoutingMsg(null);
    try {
      await apiSendJson(apiBase, "/api/routing/defaults", "PUT", {
        forcePeerReview,
        byKind: rowsToMap(byKindRows),
        byDeliverableType: rowsToMap(byDeliverableRows),
      });
      setRoutingMsg("已保存。");
    } catch (err) {
      setLoadError(errorMessage(err, "无法保存默认分工"));
    } finally {
      setRoutingBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.roleId === selectedRoleId),
    [roles, selectedRoleId],
  );

  const specializationRows = useMemo(() => {
    const rows = Object.values(specialization).filter((s) => s.tasksReviewed > 0);
    rows.sort((a, b) => b.tasksReviewed - a.tasksReviewed);
    return rows;
  }, [specialization]);

  const roleLinkedSpecs = useMemo(() => {
    if (!selectedRoleId) {
      return [];
    }
    return specializationRows.filter((s) => s.roleId === selectedRoleId);
  }, [selectedRoleId, specializationRows]);

  return (
    <div className="lm-settings-section lm-settings-advanced-page lm-roles-page">
      <p className="lm-settings-lead">
        查看内置岗位做什么。新建/改助手请到「助手与岗位」。
      </p>

      {loadError ? (
        <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
          {loadError}
        </p>
      ) : null}
      {loading ? <p className="lm-settings-caption">加载中…</p> : null}

      <div className="lm-roles-grid">
        <ul className="lm-roles-list">
          {roles.map((r) => (
            <li key={r.roleId}>
              <button
                type="button"
                className={`lm-role-item${selectedRoleId === r.roleId ? " is-active" : ""}`}
                onClick={() => setSelectedRoleId(r.roleId)}
              >
                <span className="lm-role-item__name">{r.displayName}</span>
                <span className="lm-role-item__risk">风险 {RISK_LABEL[r.riskCeiling]}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="lm-role-detail">
          {!selectedRole ? (
            <p className="lm-settings-caption">选择左侧岗位查看说明。</p>
          ) : (
            <RoleDetail role={selectedRole} linkedSpecs={roleLinkedSpecs} />
          )}
        </div>
      </div>

      <details className="lm-settings-advanced" data-testid="lm-settings-routing-defaults">
        <summary>
          <span className="lm-settings-advanced__label">默认分工与互审</span>
          <span className="lm-settings-advanced__hint">管理员</span>
        </summary>
        <div className="lm-settings-advanced-body">
          <p className="lm-settings-caption">
            新建任务时按类型指定默认助手。强制互审：有互审对象时，落稿会自动建互审委派。
          </p>
          <label className="lm-roles-field">
            <span>强制互审</span>
            <select
              className="lm-input"
              value={forcePeerReview === null ? "inherit" : forcePeerReview ? "on" : "off"}
              disabled={routingBusy || loading}
              onChange={(e) => {
                const v = e.target.value;
                setForcePeerReview(v === "inherit" ? null : v === "on");
              }}
              data-testid="lm-settings-force-peer-review"
            >
              <option value="inherit">跟随版本（Solo 关 / Firm 开）</option>
              <option value="on">始终开启</option>
              <option value="off">始终关闭</option>
            </select>
          </label>

          <RoutingMapEditor
            title="按任务类型"
            keyPlaceholder="如 draft.word"
            rows={byKindRows}
            disabled={routingBusy || loading}
            onChange={setByKindRows}
            testId="lm-settings-routing-by-kind"
          />
          <RoutingMapEditor
            title="按交付物类型"
            keyPlaceholder="如 contract.review"
            rows={byDeliverableRows}
            disabled={routingBusy || loading}
            onChange={setByDeliverableRows}
            testId="lm-settings-routing-by-deliverable"
          />

          <div className="lm-memory-fold__actions">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={routingBusy || loading}
              onClick={() => void saveRoutingDefaults()}
              data-testid="lm-settings-routing-save"
            >
              {routingBusy ? "保存中…" : "保存"}
            </button>
            {routingMsg ? <span className="lm-meta">{routingMsg}</span> : null}
          </div>
        </div>
      </details>

      <details className="lm-settings-advanced">
        <summary>
          <span className="lm-settings-advanced__label">助手表现</span>
          <span className="lm-settings-advanced__hint">近 {windowDays} 日</span>
        </summary>
        <div className="lm-settings-advanced-body">
          <p className="lm-settings-caption">
            一次过签批越高、改写越少，该助手越稳。「待教」来自记忆库待确认数。
          </p>
          {specializationRows.length === 0 && growthRows.every((g) => g.lifetime.tasksReviewed === 0) ? (
            <p className="lm-settings-caption">暂无签批反馈。</p>
          ) : (
            <div className="lm-roles-table-wrap">
              <table className="lm-roles-table">
                <thead>
                  <tr>
                    <th>助手</th>
                    <th>岗位</th>
                    <th className="is-num">累计审过</th>
                    <th className="is-num">累计一次过</th>
                    <th className="is-num">近窗一次过</th>
                    <th className="is-num">待教</th>
                  </tr>
                </thead>
                <tbody>
                  {(growthRows.length > 0
                    ? growthRows
                    : specializationRows.map((s) => ({
                        assistantId: s.assistantId,
                        roleId: s.roleId,
                        lifetime: {
                          tasksReviewed: s.tasksReviewed,
                          firstPassApprovals: s.firstPassApprovals,
                          materialRewrites: s.materialRewrites,
                          firstPassRate: s.firstPassRate,
                          rewriteRate: s.tasksReviewed > 0 ? s.materialRewrites / s.tasksReviewed : 0,
                        },
                        window: {
                          tasksReviewed: 0,
                          firstPassApprovals: 0,
                          materialRewrites: 0,
                          firstPassRate: 0,
                          rewriteRate: 0,
                        },
                        pendingAdoptions: 0,
                        rewriteAmplitude: undefined as GrowthRow["rewriteAmplitude"],
                      }))
                  ).map((g) => (
                    <tr key={g.assistantId}>
                      <td>{g.assistantId}</td>
                      <td>{g.roleId ?? "—"}</td>
                      <td className="is-num">{g.lifetime.tasksReviewed}</td>
                      <td className="is-num">{pct(g.lifetime.firstPassRate)}</td>
                      <td className="is-num">
                        {g.window.tasksReviewed > 0 ? pct(g.window.firstPassRate) : "—"}
                      </td>
                      <td className="is-num">{g.pendingAdoptions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function RoutingMapEditor(props: {
  title: string;
  keyPlaceholder: string;
  rows: RoutingMapRow[];
  disabled: boolean;
  onChange: (rows: RoutingMapRow[]) => void;
  testId: string;
}): ReactNode {
  const { title, keyPlaceholder, rows, disabled, onChange, testId } = props;
  return (
    <div className="lm-roles-map" data-testid={testId}>
      <h4 className="lm-roles-map__title">{title}</h4>
      <div className="lm-roles-table-wrap">
        <table className="lm-roles-table">
          <thead>
            <tr>
              <th>键</th>
              <th>岗位</th>
              <th>助手（可选）</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${testId}-${idx}`}>
                <td>
                  <input
                    className="lm-input"
                    value={row.key}
                    disabled={disabled}
                    placeholder={keyPlaceholder}
                    aria-label={`${title} 键 ${idx + 1}`}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...row, key: e.target.value };
                      onChange(next);
                    }}
                  />
                </td>
                <td>
                  <input
                    className="lm-input"
                    value={row.roleId}
                    disabled={disabled}
                    placeholder="岗位 ID"
                    aria-label={`${title} 岗位 ${idx + 1}`}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...row, roleId: e.target.value };
                      onChange(next);
                    }}
                  />
                </td>
                <td>
                  <input
                    className="lm-input"
                    value={row.assistantId}
                    disabled={disabled}
                    placeholder="可选"
                    aria-label={`${title} 助手 ${idx + 1}`}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...row, assistantId: e.target.value };
                      onChange(next);
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={disabled}
                    aria-label={`删除 ${title} 行 ${idx + 1}`}
                    onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="lm-btn lm-btn-ghost lm-btn-sm"
        disabled={disabled}
        onClick={() => onChange([...rows, { key: "", roleId: "", assistantId: "" }])}
      >
        添加一行
      </button>
    </div>
  );
}

function RoleDetail({
  role,
  linkedSpecs,
}: {
  role: Role;
  linkedSpecs: SpecRow[];
}): ReactNode {
  return (
    <div className="lm-role-detail__card">
      <h3 className="lm-role-detail__title">{role.displayName}</h3>
      <p className="lm-role-detail__mission">{role.mission}</p>

      <dl className="lm-role-detail__meta">
        <div>
          <dt>风险上限</dt>
          <dd>{RISK_LABEL[role.riskCeiling]}</dd>
        </div>
        <div>
          <dt>交付物</dt>
          <dd>{role.allowedDeliverableTypes.join("、") || "不限"}</dd>
        </div>
        <div>
          <dt>习惯范围</dt>
          <dd>{role.memoryScope.join("、") || "不限"}</dd>
        </div>
        {role.defaultEscalateTo ? (
          <div>
            <dt>默认上报</dt>
            <dd>{role.defaultEscalateTo}</dd>
          </div>
        ) : null}
      </dl>

      <h4 className="lm-role-detail__sub">交付前自检</h4>
      {role.reviewChecklist.length === 0 ? (
        <p className="lm-settings-caption">暂无自检项。</p>
      ) : (
        <ol className="lm-role-detail__checklist">
          {role.reviewChecklist.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ol>
      )}

      {linkedSpecs.length > 0 ? (
        <>
          <h4 className="lm-role-detail__sub">相关助手</h4>
          <ul className="lm-role-detail__specs">
            {linkedSpecs.map((s) => (
              <li key={s.assistantId}>
                {s.assistantId}：审过 {s.tasksReviewed} · 一次过约 {Math.round(s.firstPassRate * 100)}%
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export default LawmindSettingsRoles;
