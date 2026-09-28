import { useMemo, type ReactNode } from "react";
import { parseChartSpec, type ChartSpec } from "../../../../src/lawmind/agent/tools/legal/chart-spec.ts";
import { CanvasThemeRoot } from "./canvas/CanvasHost";
import { BarChart, LineChart, PieChart } from "./canvas/charts";
import { Text } from "./canvas/primitives";

function ChartBody(props: { spec: ChartSpec }) {
  const { spec } = props;
  const series = spec.series.map((item) => ({ name: item.name, data: item.values }));
  const suffix = spec.unit ? ` ${spec.unit}` : undefined;
  const chart =
    spec.type === "line" ? (
      <LineChart categories={spec.categories} series={series} valueSuffix={suffix} fill />
    ) : spec.type === "pie" ? (
      <PieChart
        data={spec.categories.map((label, index) => ({
          label,
          value: spec.series[0]?.values[index] ?? 0,
        }))}
        donut
      />
    ) : (
      <BarChart
        categories={spec.categories}
        series={series}
        stacked={spec.type === "stacked_bar"}
        valueSuffix={suffix}
      />
    );
  return (
    <figure className="lm-analysis-chart" data-testid="lm-analysis-chart" style={{ margin: 0 }}>
      <figcaption style={{ marginBottom: 8 }}>
        <Text weight="semibold">{spec.title}</Text>
      </figcaption>
      {chart}
      {spec.notes ? (
        <Text size="small" tone="tertiary" style={{ marginTop: 8 }}>
          {spec.notes}
        </Text>
      ) : null}
      {spec.source?.path ? (
        <Text size="small" tone="tertiary" style={{ marginTop: 4 }}>
          来源 {spec.source.path}
          {spec.source.sheet ? ` · ${spec.source.sheet}` : ""}
        </Text>
      ) : null}
    </figure>
  );
}

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
    <CanvasThemeRoot>
      <ChartBody spec={parsed.spec} />
    </CanvasThemeRoot>
  );
}
