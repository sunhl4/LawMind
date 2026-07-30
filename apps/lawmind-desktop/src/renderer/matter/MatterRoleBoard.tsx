/**
 * <MatterRoleBoard /> — W11 视图组件 6/6（W7/W8 Role 分配可视化）。
 */

import type { ReactNode } from "react";

export type RoleAssignmentRow = {
  assistantId: string;
  displayName: string;
  roleId?: string;
  roleDisplayName?: string;
  riskCeiling?: "low" | "medium" | "high";
  pendingApprovalCount?: number;
};

type Props = {
  matterId: string;
  rows: RoleAssignmentRow[];
};

export function MatterRoleBoard({ matterId, rows }: Props): ReactNode {
  return (
    <section
      className="lm-matter-role-board"
      data-testid="lm-matter-role-board"
      data-matter-id={matterId}
    >
      <h3>岗位分配</h3>
      {rows.length === 0 ? (
        <div className="lm-callout lm-callout-muted">案件目前未指派助手。</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 0" }}>助手</th>
              <th style={{ textAlign: "left", padding: "6px 0" }}>岗位</th>
              <th style={{ textAlign: "left", padding: "6px 0" }}>风险上限</th>
              <th style={{ textAlign: "left", padding: "6px 0" }}>待审批</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.assistantId}>
                <td style={{ padding: "6px 0" }}>{r.displayName}</td>
                <td style={{ padding: "6px 0" }}>
                  {r.roleDisplayName ?? r.roleId ?? "（未分配）"}
                </td>
                <td style={{ padding: "6px 0" }}>{r.riskCeiling ?? "—"}</td>
                <td style={{ padding: "6px 0" }}>{r.pendingApprovalCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default MatterRoleBoard;
