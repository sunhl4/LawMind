import { useMemo, type ReactNode } from "react";
import { parseChartSpec } from "../../../../src/lawmind/agent/tools/legal/chart-spec.ts";
import { renderChartSvg } from "../../../../src/lawmind/agent/tools/legal/chart-svg.ts";

export function LawmindAnalysisChart(props: { specText: string }): ReactNode {
  const parsed = useMemo(() => {
    try {
      return parseChartSpec(JSON.parse(props.specText) as unknown);
    } catch {
      return { ok: false as const, error: "图表规格不是合法 JSON。" };
    }
  }, [props.specText]);

  if (!parsed.ok) {
    return (
      <div className="lm-analysis-chart lm-analysis-chart--error" data-testid="lm-analysis-chart">
        <p className="lm-meta">{parsed.error}</p>
      </div>
    );
  }

  return (
    <figure className="lm-analysis-chart" data-testid="lm-analysis-chart">
      <figcaption className="lm-analysis-chart-title">{parsed.spec.title}</figcaption>
      <div
        className="lm-analysis-chart-svg"
        dangerouslySetInnerHTML={{ __html: renderChartSvg(parsed.spec) }}
      />
      {parsed.spec.notes ? <p className="lm-analysis-chart-notes">{parsed.spec.notes}</p> : null}
      {parsed.spec.source?.path ? (
        <p className="lm-analysis-chart-notes">
          来源 {parsed.spec.source.path}
          {parsed.spec.source.sheet ? ` · ${parsed.spec.source.sheet}` : ""}
        </p>
      ) : null}
    </figure>
  );
}
