/**
 * LawmindSettingsRoles — W7。
 *
 * 浏览内置 Role（mission / allowedToolNames / riskCeiling / allowedDeliverableTypes /
 * memoryScope / reviewChecklist），并展示助手特化（一次过签批率）进化指标。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import { loadAgentFleet } from "./lawmind-agent-fleet-api";
import type { AgentFleetSummary } from "./lawmind-agent-fleet-api";

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

export function LawmindSettingsRoles({ apiBase }: Props): ReactNode {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [specialization, setSpecialization] = useState<Record<string, SpecRow>>({});

  const refresh = useCallback(async () => {
    if (!apiBase?.trim()) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [j, fleet] = await Promise.all([
        apiGetJson<{ ok?: boolean; roles?: Role[] }>(apiBase, "/api/roles"),
        loadAgentFleet(apiBase).catch(() => null),
      ]);
      if (j.ok && Array.isArray(j.roles)) {
        setRoles(j.roles);
        if (j.roles.length > 0 && !selectedRoleId) {
          setSelectedRoleId(j.roles[0].roleId);
        }
      } else {
        setLoadError("无法加载 Role 列表");
      }
      setSpecialization(fleet?.specialization ?? {});
    } catch (err) {
      setLoadError(errorMessage(err, "无法加载 Role 列表"));
    } finally {
      setLoading(false);
    }
  }, [apiBase, selectedRoleId]);

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
    <div className="lm-settings-section">
      <div className="lm-callout lm-callout-info" role="note">
        <p className="lm-callout-body">
          Role 为内置岗位模板，此处只读浏览治理边界。自定义助手人设与补充指令请前往「助手」设置，
          或在工作区 <code>lawmind/agents/*.md</code> 中维护。
        </p>
      </div>
      <h2>岗位（Role）</h2>
      <p className="lm-settings-help">
        Role 是助手承担的「岗位」。每个 Role 定义自己的使命、可用工具、风险上限、可产出的交付物类型，
        以及交付前自检清单。下方「进化指标」来自签批反馈的一次过签批率（与在办事项面板同源）。
      </p>

      {loadError ? <div className="lm-callout lm-callout-danger">{loadError}</div> : null}
      {loading ? <div className="lm-callout lm-callout-muted">加载中…</div> : null}

      <div className="lm-roles-grid" style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16 }}>
        <ul className="lm-roles-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {roles.map((r) => (
            <li key={r.roleId} style={{ marginBottom: 4 }}>
              <button
                type="button"
                className={`lm-role-item ${selectedRoleId === r.roleId ? "lm-role-item-active" : ""}`}
                onClick={() => setSelectedRoleId(r.roleId)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--lm-border, #e5e7eb)",
                  background:
                    selectedRoleId === r.roleId ? "var(--lm-accent-bg, #eef2ff)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600 }}>{r.displayName}</div>
                <div style={{ fontSize: 12, color: "var(--lm-muted, #6b7280)" }}>{r.roleId}</div>
              </button>
            </li>
          ))}
        </ul>

        <div className="lm-role-detail">
          {!selectedRole ? (
            <div className="lm-callout lm-callout-muted">请选择一个岗位查看详情。</div>
          ) : (
            <RoleDetail role={selectedRole} linkedSpecs={roleLinkedSpecs} />
          )}
        </div>
      </div>

      <div className="lm-settings-group lm-settings-surface" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>助手进化指标</h3>
        <p className="lm-meta">
          基于文书签批结果累计：一次过签批率越高，该助手在对应岗位上越「稳」。数据与「在办事项」面板一致。
        </p>
        {specializationRows.length === 0 ? (
          <p className="lm-meta">暂无签批反馈；完成若干文书签批后会出现指标。</p>
        ) : (
          <table className="lm-role-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 12px 6px 0" }}>助手</th>
                <th style={{ textAlign: "left", padding: "6px 12px 6px 0" }}>岗位</th>
                <th style={{ textAlign: "right", padding: "6px 0" }}>审过</th>
                <th style={{ textAlign: "right", padding: "6px 0" }}>一次过</th>
                <th style={{ textAlign: "right", padding: "6px 0" }}>较大改写</th>
              </tr>
            </thead>
            <tbody>
              {specializationRows.map((s) => (
                <tr key={s.assistantId}>
                  <td style={{ padding: "6px 12px 6px 0" }}>{s.assistantId}</td>
                  <td style={{ padding: "6px 12px 6px 0" }}>{s.roleId ?? "—"}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{s.tasksReviewed}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>
                    {Math.round(s.firstPassRate * 100)}%
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{s.materialRewrites}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
    <div>
      <h3 style={{ marginTop: 0 }}>{role.displayName}</h3>
      <p style={{ color: "var(--lm-muted, #6b7280)" }}>{role.mission}</p>

      <table className="lm-role-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <Row label="风险上限" value={role.riskCeiling} />
          <Row label="允许的交付物类型" value={role.allowedDeliverableTypes.join(", ") || "（不限）"} />
          <Row label="记忆 scope" value={role.memoryScope.join(", ") || "（不限）"} />
          <Row
            label="允许调用的工具"
            value={
              role.allowedToolNames && role.allowedToolNames.length > 0
                ? role.allowedToolNames.join(", ")
                : "（不限）"
            }
          />
          <Row label="默认越级对象" value={role.defaultEscalateTo ?? "（无）"} />
        </tbody>
      </table>

      <h4 style={{ marginTop: 16 }}>交付前自检清单</h4>
      {role.reviewChecklist.length === 0 ? (
        <div className="lm-callout lm-callout-muted">该岗位暂未配置自检项。</div>
      ) : (
        <ol style={{ paddingLeft: 20 }}>
          {role.reviewChecklist.map((item, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>
              {item}
            </li>
          ))}
        </ol>
      )}

      {linkedSpecs.length > 0 ? (
        <>
          <h4 style={{ marginTop: 16 }}>本岗位相关助手表现</h4>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {linkedSpecs.map((s) => (
              <li key={s.assistantId} style={{ marginBottom: 4 }}>
                {s.assistantId}：审过 {s.tasksReviewed} · 一次过约 {Math.round(s.firstPassRate * 100)}%
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <tr>
      <td
        style={{
          padding: "6px 12px 6px 0",
          color: "var(--lm-muted, #6b7280)",
          width: 160,
          verticalAlign: "top",
        }}
      >
        {label}
      </td>
      <td style={{ padding: "6px 0", whiteSpace: "pre-wrap" }}>{value}</td>
    </tr>
  );
}

export default LawmindSettingsRoles;
