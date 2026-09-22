/** Helpers for Settings → Roles routing defaults editor. */

export type RoutingAssigneeRef = { roleId?: string; assistantId?: string };
export type RoutingMapRow = { key: string; roleId: string; assistantId: string };

export function mapToRows(map: Record<string, RoutingAssigneeRef> | undefined): RoutingMapRow[] {
  return Object.entries(map ?? {}).map(([key, ref]) => ({
    key,
    roleId: ref.roleId?.trim() ?? "",
    assistantId: ref.assistantId?.trim() ?? "",
  }));
}

export function rowsToMap(rows: RoutingMapRow[]): Record<string, RoutingAssigneeRef> {
  const out: Record<string, RoutingAssigneeRef> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      continue;
    }
    const roleId = row.roleId.trim() || undefined;
    const assistantId = row.assistantId.trim() || undefined;
    if (!roleId && !assistantId) {
      continue;
    }
    out[key] = { roleId, assistantId };
  }
  return out;
}
