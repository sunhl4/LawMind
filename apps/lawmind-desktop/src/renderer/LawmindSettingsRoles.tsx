/**
 * LawmindSettingsRoles — W7。
 *
 * 浏览内置 Role（mission / allowedToolNames / riskCeiling / allowedDeliverableTypes /
 * memoryScope / reviewChecklist），便于律师选择助手时理解岗位边界。
 *
 * 当前 Role 为只读内置项；后续若开放自定义 Role，可在此新增编辑入口。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";

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

export function LawmindSettingsRoles({ apiBase }: Props): ReactNode {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!apiBase?.trim()) {return;}
    setLoading(true);
    setLoadError(null);
    try {
      const j = await apiGetJson<{ ok?: boolean; roles?: Role[] }>(apiBase, "/api/roles");
      if (j.ok && Array.isArray(j.roles)) {
        setRoles(j.roles);
        if (j.roles.length > 0 && !selectedRoleId) {
          setSelectedRoleId(j.roles[0].roleId);
        }
      } else {
        setLoadError("无法加载 Role 列表");
      }
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

  return (
    <div className="lm-settings-section">
      <h2>岗位（Role）</h2>
      <p className="lm-settings-help">
        Role 是助手承担的"岗位"。每个 Role 定义自己的使命、可用工具、风险上限、可产出的交付物类型，
        以及交付前自检清单。当前为内置岗位（W7 起一等对象，可在 ToolPolicy 与起草环节强制约束），后续将开放自定义。
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
            <RoleDetail role={selectedRole} />
          )}
        </div>
      </div>
    </div>
  );
}

function RoleDetail({ role }: { role: Role }): ReactNode {
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
