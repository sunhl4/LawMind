import { useEffect, useState } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import type { LawyerDeskDashboard } from "../../../../src/lawmind/metrics/lawyer-dashboard.ts";

export type UseLawyerDeskDashboardResult = {
  dashboard: LawyerDeskDashboard | null;
  loading: boolean;
  error: string | null;
};

/**
 * 拉取全工作区仪表盘汇总（/api/metrics/lawyer-dashboard）。
 */
export function useLawyerDeskDashboard(apiBase: string | undefined): UseLawyerDeskDashboardResult {
  const [dashboard, setDashboard] = useState<LawyerDeskDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      setDashboard(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void apiGetJson<{ ok?: boolean; dashboard?: LawyerDeskDashboard }>(
      apiBase,
      "/api/metrics/lawyer-dashboard",
    )
      .then((j) => {
        if (cancelled) {
          return;
        }
        if (j.ok && j.dashboard) {
          setDashboard(j.dashboard);
        } else {
          setError("仪表盘数据不可用");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e, "加载仪表盘失败"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  return { dashboard, loading, error };
}
