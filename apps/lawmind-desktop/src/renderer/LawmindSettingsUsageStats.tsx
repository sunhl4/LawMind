import { useEffect, useState, type ReactNode } from "react";
import { loadHealthPayload } from "./lawmind-app-data.js";

type UsageSummary = {
  entries?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  since?: string;
  until?: string;
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
        <p className="lm-hint">
          近 30 天尚无 token 记录。完成对话且模型返回 usage 后，将在此汇总（仅保存在本工作区，不上传）。
        </p>
      </section>
    );
  }

  return (
    <section className="lm-settings-section" id="lawmind-settings-usage">
      <h3>本地使用统计</h3>
      <p className="lm-hint">近 30 天、本工作区累计（agentsview 式本地账本，非计费系统）。</p>
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
    </section>
  );
}
