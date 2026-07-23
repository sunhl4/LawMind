import { useEffect, useState, type ReactNode } from "react";
import { loadHealthPayload } from "./lawmind-app-data.js";

type UsageSummary = {
  entries?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  since?: string;
  until?: string;
  byModel?: Array<{ model: string; entries: number; totalTokens: number }>;
  byTier?: Array<{ tier: string; label: string; entries: number; totalTokens: number }>;
};

type Props = {
  apiBase: string;
};

function fmt(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) {
    return "—";
  }
  return n.toLocaleString("zh-CN");
}

export function LawmindSettingsUsageStats({ apiBase }: Props): ReactNode {
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadHealthPayload(apiBase)
      .then((h) => {
        if (!cancelled) {
          setUsageSummary(h.usageSummary ?? h.doctor?.usageSummary ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsageSummary(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const s = usageSummary;
  if (!s || (s.entries ?? 0) === 0) {
    return (
      <section className="lm-settings-section" id="lawmind-settings-usage">
        <h3>本地使用统计</h3>
        <p className="lm-settings-caption">近 30 天暂无用量</p>
      </section>
    );
  }

  return (
    <section className="lm-settings-section" id="lawmind-settings-usage">
      <h3>本地使用统计</h3>
      <p className="lm-settings-caption">近 30 天本机用量（不计费）</p>
      <dl className="lm-usage-stats-grid">
        <div>
          <dt>记录条数</dt>
          <dd>{fmt(s.entries)}</dd>
        </div>
        <div>
          <dt>Prompt tokens</dt>
          <dd>{fmt(s.promptTokens)}</dd>
        </div>
        <div>
          <dt>Completion tokens</dt>
          <dd>{fmt(s.completionTokens)}</dd>
        </div>
        <div>
          <dt>合计 tokens</dt>
          <dd>{fmt(s.totalTokens)}</dd>
        </div>
      </dl>
      {s.since ? (
        <p className="lm-meta">
          区间：{s.since.slice(0, 10)} — {s.until?.slice(0, 10) ?? "今"}
        </p>
      ) : null}
      {(s.byTier?.length ?? 0) > 0 ? (
        <table className="lm-role-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 12px 6px 0" }}>工作分层</th>
              <th style={{ textAlign: "right", padding: "6px 12px 6px 0" }}>记录条数</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>合计 tokens</th>
            </tr>
          </thead>
          <tbody>
            {s.byTier?.map((row) => (
              <tr key={row.tier}>
                <td style={{ padding: "6px 12px 6px 0" }}>{row.label}</td>
                <td style={{ padding: "6px 12px 6px 0", textAlign: "right" }}>{fmt(row.entries)}</td>
                <td style={{ padding: "6px 0", textAlign: "right" }}>{fmt(row.totalTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {(s.byModel?.length ?? 0) > 0 ? (
        <table className="lm-role-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 12px 6px 0" }}>模型</th>
              <th style={{ textAlign: "right", padding: "6px 12px 6px 0" }}>记录条数</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>合计 tokens</th>
            </tr>
          </thead>
          <tbody>
            {s.byModel?.map((row) => (
              <tr key={row.model}>
                <td style={{ padding: "6px 12px 6px 0" }}>
                  <code>{row.model}</code>
                </td>
                <td style={{ padding: "6px 12px 6px 0", textAlign: "right" }}>{fmt(row.entries)}</td>
                <td style={{ padding: "6px 0", textAlign: "right" }}>{fmt(row.totalTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
