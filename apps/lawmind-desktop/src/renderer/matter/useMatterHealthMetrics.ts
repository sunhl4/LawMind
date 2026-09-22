import { useEffect, useState } from "react";
import { apiGetJson, errorMessage } from "../api-client";
import type { MatterHealthMetrics } from "../../../../../src/lawmind/metrics/lawyer-dashboard.ts";

export type UseMatterHealthMetricsResult = {
  metrics: MatterHealthMetrics | null;
  loading: boolean;
  error: string | null;
};

/**
 * 拉取案件级可观测性指标（/api/metrics/lawyer-dashboard?matterId=...）。
 */
export function useMatterHealthMetrics(
  apiBase: string | undefined,
  matterId: string | undefined | null,
  taskId?: string   | null,
): UseMatterHealthMetricsResult {
  const [metrics, setMetrics] = useState<MatterHealthMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase || !matterId?.trim()) {
      setMetrics(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const query = new URLSearchParams();
    query.set("matterId", matterId.trim());
    if (taskId?.trim()) {
      query.set("taskId", taskId.trim());
    }

    void apiGetJson<{ ok?: boolean; metrics?: MatterHealthMetrics }>(
      apiBase,
      `/api/metrics/lawyer-dashboard?${query.toString()}`,
    )
      .then((j) => {
        if (cancelled) {
          return;
        }
        if (j.ok && j.metrics) {
          setMetrics(j.metrics);
        } else {
          setError("指标数据不可用");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e, "加载指标失败"));
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
  }, [apiBase, matterId, taskId]);

  return { metrics, loading, error };
}
