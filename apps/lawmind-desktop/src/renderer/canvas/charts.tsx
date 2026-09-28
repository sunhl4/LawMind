import { useState, type CSSProperties, type ReactNode } from "react";
import { canvasRadius, canvasTypography, type CanvasTokens } from "./tokens";
import { useCanvasTheme } from "./theme";

export type ChartTone = "success" | "danger" | "warning" | "info" | "neutral";

export type ChartSeries = {
  name: string;
  data: number[];
  tone?: ChartTone;
};

export type ChartReferenceLine = {
  value: number;
  label?: string;
  tone?: ChartTone;
};

const SERIES_COLORS = ["#599CE7", "#1F8A65", "#C9A227", "#7B64B8", "#C06028", "#2A9A8A", "#5A6CC0", "#C04848"];

function toneColor(tone: ChartTone | undefined, theme: CanvasTokens, index: number): string {
  if (tone && tone !== "neutral") {
    return theme.stat[tone];
  }
  if (tone === "neutral") {
    return theme.text.tertiary;
  }
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

function formatValue(value: number, prefix?: string, suffix?: string): string {
  const rounded = Math.abs(value) >= 100 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
  return `${prefix ?? ""}${rounded}${suffix ?? ""}`;
}

function domainOf(values: number[], beginAtZero: boolean, yMin?: number, yMax?: number): { min: number; max: number } {
  const finite = values.filter((value) => Number.isFinite(value));
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 1;
  if (beginAtZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (yMin !== undefined) {
    min = yMin;
  }
  if (yMax !== undefined) {
    max = yMax;
  }
  if (min === max) {
    max = min + 1;
  }
  return { min, max };
}

function ChartFrame(props: {
  height: number;
  style?: CSSProperties;
  children: ReactNode;
  legend?: Array<{ name: string; color: string }>;
  tooltip?: { title: string; rows: Array<{ name: string; color: string; value: string }> } | null;
}) {
  const theme = useCanvasTheme();
  return (
    <div style={{ ...props.style, minWidth: 0, position: "relative" }}>
      {props.tooltip ? (
        <div
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            zIndex: 2,
            pointerEvents: "none",
            background: theme.bg.chrome,
            border: `1px solid ${theme.stroke.secondary}`,
            borderRadius: canvasRadius.md,
            padding: "6px 8px",
            minWidth: 120,
          }}
        >
          <div style={{ color: theme.text.secondary, ...canvasTypography.small, marginBottom: 4 }}>{props.tooltip.title}</div>
          {props.tooltip.rows.map((row) => (
            <div key={row.name} style={{ display: "flex", gap: 8, alignItems: "center", ...canvasTypography.small }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: row.color, flexShrink: 0 }} />
              <span style={{ color: theme.text.tertiary }}>{row.name}</span>
              <span style={{ marginLeft: "auto", color: theme.text.primary, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      <svg
        className="lm-chart-svg"
        viewBox={`0 0 640 ${props.height}`}
        role="img"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {props.children}
      </svg>
      {props.legend && props.legend.length > 1 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
          {props.legend.map((item) => (
            <span
              key={item.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: theme.text.secondary,
                ...canvasTypography.small,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color }} />
              {item.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BarChart(props: {
  categories: string[];
  series: ChartSeries[];
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
  normalized?: boolean;
  valueSuffix?: string;
  valuePrefix?: string;
  showValues?: boolean;
  beginAtZero?: boolean;
  yMin?: number;
  yMax?: number;
  referenceLines?: ChartReferenceLine[];
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const [hover, setHover] = useState<number | null>(null);
  const height = props.height ?? 220;
  const stacked = Boolean(props.stacked || props.normalized);
  const normalized = Boolean(props.normalized);
  const categories = props.categories;
  const series = props.series;
  const colors = series.map((item, index) => toneColor(item.tone, theme, index));
  const showValues = props.showValues ?? (!stacked && series.length === 1 && categories.length <= 8 && !props.horizontal);
  const stackedTotals = categories.map((_, index) =>
    series.reduce((sum, item) => sum + Math.max(0, item.data[index] ?? 0), 0),
  );
  const plotted = categories.flatMap((_, categoryIndex) =>
    stacked
      ? [normalized ? 100 : (stackedTotals[categoryIndex] ?? 0)]
      : series.map((item) => item.data[categoryIndex] ?? 0),
  );
  const { min, max } = domainOf(
    [...plotted, ...(props.referenceLines ?? []).map((line) => line.value)],
    stacked ? true : props.beginAtZero !== false && props.yMin === undefined,
    stacked ? 0 : props.yMin,
    props.yMax,
  );
  const padL = props.horizontal ? 72 : 44;
  const padR = 12;
  const padT = 12;
  const padB = props.horizontal ? 28 : 36;
  const plotW = 640 - padL - padR;
  const plotH = height - padT - padB;
  const scale = (value: number) => {
    const t = (value - min) / (max - min);
    return props.horizontal ? padL + t * plotW : padT + plotH - t * plotH;
  };
  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);

  return (
    <ChartFrame
      height={height}
      style={props.style}
      legend={series.map((item, index) => ({ name: item.name, color: colors[index] ?? SERIES_COLORS[0] }))}
      tooltip={
        hover === null
          ? null
          : {
              title: categories[hover] ?? "",
              rows: series.map((item, index) => ({
                name: item.name,
                color: colors[index] ?? SERIES_COLORS[0],
                value: formatValue(
                  normalized
                    ? (Math.max(0, item.data[hover] ?? 0) / (stackedTotals[hover] || 1)) * 100
                    : (item.data[hover] ?? 0),
                  normalized ? "" : props.valuePrefix,
                  normalized ? "%" : props.valueSuffix,
                ),
              })),
            }
      }
    >
      {ticks.map((tick) => {
        const pos = scale(tick);
        const label = formatValue(tick, normalized ? "" : props.valuePrefix, normalized ? "%" : props.valueSuffix);
        return props.horizontal ? (
          <g key={tick}>
            <line x1={pos} x2={pos} y1={padT} y2={padT + plotH} stroke={theme.stroke.tertiary} />
            <text x={pos} y={height - 8} textAnchor="middle" fill={theme.text.tertiary} fontSize="11">
              {label}
            </text>
          </g>
        ) : (
          <g key={tick}>
            <line x1={padL} x2={padL + plotW} y1={pos} y2={pos} stroke={theme.stroke.tertiary} />
            <text x={padL - 6} y={pos + 4} textAnchor="end" fill={theme.text.tertiary} fontSize="11">
              {label}
            </text>
          </g>
        );
      })}
      {categories.map((category, categoryIndex) => {
        const slot = (props.horizontal ? plotH : plotW) / Math.max(categories.length, 1);
        const origin = (props.horizontal ? padT : padL) + categoryIndex * slot;
        if (!stacked) {
          const inner = slot * 0.72;
          const barSize = inner / Math.max(series.length, 1);
          return series.map((item, seriesIndex) => {
            const value = item.data[categoryIndex] ?? 0;
            const start = scale(Math.min(value, 0));
            const end = scale(Math.max(value, 0));
            const offset = (slot - inner) / 2 + seriesIndex * barSize;
            const label = formatValue(value, props.valuePrefix, props.valueSuffix);
            return props.horizontal ? (
              <rect
                key={`${category}-${item.name}`}
                x={Math.min(start, end)}
                y={origin + offset}
                width={Math.max(1, Math.abs(end - start))}
                height={Math.max(1, barSize * 0.8)}
                fill={colors[seriesIndex]}
              >
                <title>{`${item.name} ${label}`}</title>
              </rect>
            ) : (
              <rect
                key={`${category}-${item.name}`}
                x={origin + offset}
                y={Math.min(start, end)}
                width={Math.max(1, barSize * 0.8)}
                height={Math.max(1, Math.abs(end - start))}
                fill={colors[seriesIndex]}
              >
                <title>{`${item.name} ${label}`}</title>
              </rect>
            );
          });
        }
        let cursor = 0;
        const total = stackedTotals[categoryIndex] || 1;
        const thickness = slot * 0.62;
        const offset = (slot - thickness) / 2;
        return series.map((item, seriesIndex) => {
          const raw = Math.max(0, item.data[categoryIndex] ?? 0);
          const value = normalized ? (raw / total) * 100 : raw;
          const start = scale(cursor);
          cursor += value;
          const end = scale(cursor);
          const label = formatValue(normalized ? value : raw, normalized ? "" : props.valuePrefix, normalized ? "%" : props.valueSuffix);
          return props.horizontal ? (
            <rect
              key={`${category}-${item.name}`}
              x={Math.min(start, end)}
              y={origin + offset}
              width={Math.max(1, Math.abs(end - start))}
              height={thickness}
              fill={colors[seriesIndex]}
            >
              <title>{`${item.name} ${label}`}</title>
            </rect>
          ) : (
            <rect
              key={`${category}-${item.name}`}
              x={origin + offset}
              y={Math.min(start, end)}
              width={thickness}
              height={Math.max(1, Math.abs(end - start))}
              fill={colors[seriesIndex]}
            >
              <title>{`${item.name} ${label}`}</title>
            </rect>
          );
        });
      })}
      {(props.referenceLines ?? []).map((line) => {
        const pos = scale(line.value);
        const color = toneColor(line.tone ?? "neutral", theme, 0);
        return (
          <g key={`ref-${line.value}-${line.label ?? ""}`}>
            <line
              x1={props.horizontal ? pos : padL}
              x2={props.horizontal ? pos : padL + plotW}
              y1={props.horizontal ? padT : pos}
              y2={props.horizontal ? padT + plotH : pos}
              stroke={color}
              strokeDasharray="4 3"
            />
            {line.label ? (
              <text x={padL + plotW} y={props.horizontal ? padT + 12 : pos - 4} textAnchor="end" fill={color} fontSize="11">
                {line.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {categories.map((category, index) => {
        const slot = (props.horizontal ? plotH : plotW) / Math.max(categories.length, 1);
        const at = (props.horizontal ? padT : padL) + index * slot + slot / 2;
        return props.horizontal ? (
          <text key={category} x={padL - 6} y={at + 4} textAnchor="end" fill={theme.text.tertiary} fontSize="11">
            {category}
          </text>
        ) : (
          <text key={category} x={at} y={height - 10} textAnchor="middle" fill={theme.text.tertiary} fontSize="11">
            {category}
          </text>
        );
      })}
      {categories.map((category, index) => {
        const slot = (props.horizontal ? plotH : plotW) / Math.max(categories.length, 1);
        const x = props.horizontal ? padL : padL + index * slot;
        const y = props.horizontal ? padT + index * slot : padT;
        const w = props.horizontal ? plotW : slot;
        const h = props.horizontal ? slot : plotH;
        return (
          <rect
            key={`hit-${category}`}
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        );
      })}
      {showValues
        ? categories.map((category, categoryIndex) => {
            const value = series[0]?.data[categoryIndex] ?? 0;
            const slot = plotW / Math.max(categories.length, 1);
            return (
              <text
                key={`v-${category}`}
                x={padL + categoryIndex * slot + slot / 2}
                y={scale(value) - 4}
                textAnchor="middle"
                fill={theme.text.secondary}
                fontSize="11"
              >
                {formatValue(value, props.valuePrefix, props.valueSuffix)}
              </text>
            );
          })
        : null}
    </ChartFrame>
  );
}

export function LineChart(props: {
  categories: string[];
  series: ChartSeries[];
  height?: number;
  fill?: boolean;
  valueSuffix?: string;
  valuePrefix?: string;
  showValues?: boolean;
  showHoverGuide?: boolean;
  beginAtZero?: boolean;
  yMin?: number;
  yMax?: number;
  referenceLines?: ChartReferenceLine[];
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const height = props.height ?? 220;
  const [hover, setHover] = useState<number | null>(null);
  const categories = props.categories;
  const series = props.series;
  const colors = series.map((item, index) => toneColor(item.tone, theme, index));
  const { min, max } = domainOf(
    [...series.flatMap((item) => item.data), ...(props.referenceLines ?? []).map((line) => line.value)],
    props.beginAtZero !== false && props.yMin === undefined,
    props.yMin,
    props.yMax,
  );
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 32;
  const plotW = 640 - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (index: number) =>
    categories.length <= 1 ? padL + plotW / 2 : padL + (index / Math.max(categories.length - 1, 1)) * plotW;
  const yAt = (value: number) => padT + plotH - ((value - min) / (max - min)) * plotH;

  return (
    <ChartFrame
      height={height}
      style={props.style}
      legend={series.map((item, index) => ({ name: item.name, color: colors[index] ?? SERIES_COLORS[0] }))}
      tooltip={
        hover === null
          ? null
          : {
              title: categories[hover] ?? "",
              rows: series.map((item, index) => ({
                name: item.name,
                color: colors[index] ?? SERIES_COLORS[0],
                value: formatValue(item.data[hover] ?? 0, props.valuePrefix, props.valueSuffix),
              })),
            }
      }
    >
      {[0, 0.5, 1].map((t) => {
        const value = min + (max - min) * t;
        const y = yAt(value);
        return (
          <g key={t}>
            <line x1={padL} x2={padL + plotW} y1={y} y2={y} stroke={theme.stroke.tertiary} />
            <text x={padL - 6} y={y + 4} textAnchor="end" fill={theme.text.tertiary} fontSize="11">
              {formatValue(value, props.valuePrefix, props.valueSuffix)}
            </text>
          </g>
        );
      })}
      {series.map((item, seriesIndex) => {
        const color = colors[seriesIndex] ?? SERIES_COLORS[0];
        const points = item.data.map((value, index) => `${xAt(index)},${yAt(value)}`).join(" ");
        const area =
          props.fill && item.data.length > 0
            ? `M ${xAt(0)} ${padT + plotH} ` +
              item.data.map((value, index) => `L ${xAt(index)} ${yAt(value)}`).join(" ") +
              ` L ${xAt(item.data.length - 1)} ${padT + plotH} Z`
            : null;
        return (
          <g key={item.name}>
            {area ? <path d={area} fill={color} opacity={0.16} /> : null}
            <polyline points={points} fill="none" stroke={color} strokeWidth={1.6} />
            {item.data.map((value, index) => (
              <circle key={index} cx={xAt(index)} cy={yAt(value)} r={3} fill={color}>
                <title>{`${item.name} ${formatValue(value, props.valuePrefix, props.valueSuffix)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {(props.referenceLines ?? []).map((line) => {
        const y = yAt(line.value);
        const color = toneColor(line.tone ?? "neutral", theme, 0);
        return (
          <g key={`${line.value}-${line.label ?? ""}`}>
            <line x1={padL} x2={padL + plotW} y1={y} y2={y} stroke={color} strokeDasharray="4 3" />
            {line.label ? (
              <text x={padL + plotW} y={y - 4} textAnchor="end" fill={color} fontSize="11">
                {line.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {categories.map((category, index) => (
        <text key={category} x={xAt(index)} y={height - 8} textAnchor="middle" fill={theme.text.tertiary} fontSize="11">
          {category}
        </text>
      ))}
      {hover !== null && props.showHoverGuide !== false ? (
        <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + plotH} stroke={theme.stroke.primary} />
      ) : null}
      {props.showHoverGuide !== false
        ? categories.map((category, index) => (
            <rect
              key={`hit-${category}`}
              x={xAt(index) - plotW / Math.max(categories.length * 2, 1)}
              y={padT}
              width={plotW / Math.max(categories.length, 1)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            />
          ))
        : null}
    </ChartFrame>
  );
}

function pieSlice(cx: number, cy: number, r: number, inner: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const sx = cx + r * Math.cos(start);
  const sy = cy + r * Math.sin(start);
  const ex = cx + r * Math.cos(end);
  const ey = cy + r * Math.sin(end);
  if (inner <= 0) {
    return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} Z`;
  }
  const isx = cx + inner * Math.cos(end);
  const isy = cy + inner * Math.sin(end);
  const iex = cx + inner * Math.cos(start);
  const iey = cy + inner * Math.sin(start);
  return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} L ${isx} ${isy} A ${inner} ${inner} 0 ${large} 0 ${iex} ${iey} Z`;
}

export function PieChart(props: {
  data: Array<{ label: string; value: number; tone?: ChartTone }>;
  size?: number;
  donut?: boolean;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const size = props.size ?? 200;
  const total = props.data.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
  let angle = -Math.PI / 2;
  const cx = 320;
  const cy = size / 2;
  const radius = size / 2 - 4;
  const inner = props.donut ? radius * 0.58 : 0;
  return (
    <ChartFrame
      height={size}
      style={props.style}
      legend={props.data.map((item, index) => ({ name: item.label, color: toneColor(item.tone, theme, index) }))}
    >
      {props.data.map((item, index) => {
        const sweep = (Math.max(0, item.value) / total) * Math.PI * 2;
        const start = angle;
        angle += sweep;
        if (sweep <= 0) {
          return null;
        }
        return (
          <path key={item.label} d={pieSlice(cx, cy, radius, inner, start, angle)} fill={toneColor(item.tone, theme, index)}>
            <title>{`${item.label} ${item.value}`}</title>
          </path>
        );
      })}
      {props.donut ? (
        <text x={cx} y={cy + 4} textAnchor="middle" fill={theme.text.primary} fontSize="16" fontWeight={590}>
          {Math.round(props.data.reduce((sum, item) => sum + Math.max(0, item.value), 0))}
        </text>
      ) : null}
    </ChartFrame>
  );
}
