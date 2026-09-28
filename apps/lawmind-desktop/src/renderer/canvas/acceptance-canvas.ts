/**
 * 把核对纸写成一份 `.canvas.tsx`。
 *
 * 数字和句子都嵌在源码里，画布沙箱不能访问网络，也不能读核对接口。
 * 采信状态以写文件那一刻为准；之后在核对纸上改的标记，要再打开一次画布才会进去。
 */

import { isAcceptanceTaskId, type AcceptanceSheet } from "../../../../../src/lawmind/acceptance-sheet/model.ts";
import { parseChartSpec, type ChartType } from "../../../../../src/lawmind/agent/tools/legal/chart-spec.ts";

export type AcceptanceCanvasChart = {
  title: string;
  kind: ChartType;
  categories: string[];
  series: Array<{ name: string; data: number[] }>;
  unit?: string;
  notes?: string;
  sourcePath: string;
};

export type AcceptanceCanvasPayload = {
  title: string;
  summary?: string;
  claimCount: number;
  gapCount: number;
  removedCount: number;
  hasDraft: boolean;
  claims: Array<{
    id: string;
    locator: string;
    text: string;
    mark: "accepted" | "too_strong" | null;
    confidenceLabel?: string;
    quote?: string;
    sources: Array<{ id: string; label: string; relPath?: string }>;
  }>;
  gaps: string[];
  table?: {
    title: string;
    headers: string[];
    rows: string[][];
    rowTone: Array<"danger" | null>;
  };
  charts: AcceptanceCanvasChart[];
};

/** `canvas/核对-<taskId>.canvas.tsx` under the workspace root. */
export function acceptanceCanvasPath(taskId: string): string | null {
  if (!isAcceptanceTaskId(taskId)) {
    return null;
  }
  return `canvas/核对-${taskId}.canvas.tsx`;
}

/** JSON text that still parses to the same value, but does not look like canvas code. */
export function embedCanvasJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("import ", "\\u0069mport ")
    .replaceAll("fetch(", "\\u0066etch(")
    .replaceAll("eval(", "\\u0065val(")
    .replaceAll("new Function", "new \\u0046unction")
    .replaceAll("XMLHttpRequest", "\\u0058MLHttpRequest")
    .replaceAll("WebSocket", "\\u0057ebSocket")
    .replaceAll("localStorage", "\\u006cocalStorage")
    .replaceAll("document.", "\\u0064ocument.")
    .replaceAll("window.", "\\u0077indow.")
    .replaceAll("process.", "\\u0070rocess.")
    .replaceAll("require(", "\\u0072equire(")
    .replaceAll("import(", "\\u0069mport(");
}

export function acceptanceCanvasPayload(sheet: AcceptanceSheet): AcceptanceCanvasPayload {
  const claims = sheet.claims
    .filter((claim) => claim.mark !== "removed")
    .map((claim) => ({
      id: claim.id,
      locator: claim.locator?.trim() || "结论",
      text: claim.text,
      mark: claim.mark === "accepted" || claim.mark === "too_strong" ? claim.mark : null,
      ...(claim.confidenceLabel ? { confidenceLabel: claim.confidenceLabel } : {}),
      ...(claim.quote ? { quote: claim.quote } : {}),
      sources: claim.sources.map((source) => ({
        id: source.id,
        label: source.citation || source.title,
        ...(source.relPath ? { relPath: source.relPath } : {}),
      })),
    }));
  const charts: AcceptanceCanvasChart[] = [];
  for (const chart of sheet.charts ?? []) {
    let parsed: ReturnType<typeof parseChartSpec>;
    try {
      parsed = parseChartSpec(JSON.parse(chart.specText) as unknown);
    } catch {
      continue;
    }
    if (!parsed.ok) {
      continue;
    }
    charts.push({
      title: chart.title || parsed.spec.title,
      kind: parsed.spec.type,
      categories: parsed.spec.categories,
      series: parsed.spec.series.map((item) => ({ name: item.name, data: item.values })),
      ...(parsed.spec.unit ? { unit: parsed.spec.unit } : {}),
      ...(parsed.spec.notes ? { notes: parsed.spec.notes } : {}),
      sourcePath: chart.sourcePath,
    });
  }
  const payload: AcceptanceCanvasPayload = {
    title: sheet.title,
    claimCount: claims.length,
    gapCount: sheet.gaps.length + sheet.risks.length,
    removedCount: sheet.removedCount,
    hasDraft: sheet.hasDraft,
    claims,
    gaps: [...sheet.gaps.map((gap) => gap.text), ...sheet.risks],
    charts,
  };
  if (sheet.summary?.trim()) {
    payload.summary = sheet.summary.trim();
  }
  if (sheet.table && sheet.table.rows.length > 0) {
    payload.table = {
      title: sheet.table.title,
      headers: [...sheet.table.columns.map((column) => column.label), "出处"],
      rows: sheet.table.rows.map((row) => [
        ...sheet.table!.columns.map((column) => row.cells[column.key] ?? ""),
        row.sourceLabel,
      ]),
      rowTone: sheet.table.rows.map((row) => (row.sourced ? null : "danger")),
    };
  }
  return payload;
}

export function renderAcceptanceCanvas(sheet: AcceptanceSheet): string {
  const data = embedCanvasJson(acceptanceCanvasPayload(sheet));
  return `import { BarChart, Button, Callout, Card, CardBody, CardHeader, H1, H2, LineChart, PieChart, Pill, Row, Stack, Stat, Table, Text, useCanvasAction } from "cursor/canvas";

const sheet = ${data};

function markPill(mark) {
  if (mark === "accepted") {
    return <Pill active size="sm">已采信</Pill>;
  }
  if (mark === "too_strong") {
    return <Pill size="sm">已退回改弱</Pill>;
  }
  return null;
}

function ChartBlock(props) {
  const chart = props.chart;
  const suffix = chart.unit ? " " + chart.unit : undefined;
  const series = chart.series;
  const body =
    chart.kind === "line" ? (
      <LineChart categories={chart.categories} series={series} valueSuffix={suffix} fill />
    ) : chart.kind === "pie" ? (
      <PieChart
        donut
        data={chart.categories.map((label, index) => ({
          label,
          value: series[0] ? series[0].data[index] ?? 0 : 0,
        }))}
      />
    ) : (
      <BarChart
        categories={chart.categories}
        series={series}
        stacked={chart.kind === "stacked_bar"}
        valueSuffix={suffix}
      />
    );
  return (
    <Stack gap={8}>
      <H2>{chart.title}</H2>
      {body}
      {chart.notes ? (
        <Text size="small" tone="tertiary">
          {chart.notes}
        </Text>
      ) : null}
      <Text size="small" tone="tertiary">
        来源 {chart.sourcePath}。只读。要改数字，改表格后再出图。
      </Text>
    </Stack>
  );
}

export default function AcceptanceCanvas() {
  const dispatch = useCanvasAction();
  return (
    <Stack gap={16}>
      <Text size="small" tone="tertiary">
        核对
      </Text>
      <H1>{sheet.title}</H1>
      <Row gap={20} wrap>
        <Stat value={sheet.claimCount} label="可核对" />
        {sheet.gapCount > 0 ? <Stat value={sheet.gapCount} label="还没站稳" tone="warning" /> : null}
        {sheet.removedCount > 0 ? <Stat value={sheet.removedCount} label="已拿掉" /> : null}
      </Row>
      {sheet.summary ? (
        <Callout tone="neutral" title="导语，还不能逐句采信。">
          {sheet.summary}
        </Callout>
      ) : null}
      {sheet.claims.map((claim) => (
        <Card key={claim.id}>
          <CardHeader trailing={markPill(claim.mark)}>{claim.locator}</CardHeader>
          <CardBody>
            <Text>{claim.text}</Text>
            {claim.confidenceLabel ? (
              <Text size="small" tone="tertiary">
                把握{claim.confidenceLabel}
              </Text>
            ) : null}
            {claim.quote ? (
              <Text size="small" tone="secondary">
                {claim.quote}
              </Text>
            ) : null}
            <Row gap={8} wrap>
              {claim.sources.map((source) =>
                source.relPath ? (
                  <Button
                    key={source.id}
                    variant="ghost"
                    onClick={() => dispatch({ type: "openFile", path: source.relPath })}
                  >
                    {source.label}
                  </Button>
                ) : (
                  <Text key={source.id} as="span" size="small" tone="tertiary">
                    {source.label}
                  </Text>
                ),
              )}
            </Row>
          </CardBody>
        </Card>
      ))}
      {sheet.gaps.length > 0 ? (
        <Stack gap={8}>
          <H2>还没站稳</H2>
          <Callout tone="warning">
            <Stack gap={4}>
              {sheet.gaps.map((gap) => (
                <Text key={gap} size="small" tone="secondary">
                  {gap}
                </Text>
              ))}
            </Stack>
          </Callout>
        </Stack>
      ) : null}
      {sheet.table ? (
        <Stack gap={8}>
          <H2>{sheet.table.title}</H2>
          <Table
            striped
            stickyHeader
            headers={sheet.table.headers}
            rows={sheet.table.rows}
            rowTone={sheet.table.rowTone.map((tone) => tone ?? undefined)}
          />
        </Stack>
      ) : null}
      {sheet.charts.map((chart) => (
        <ChartBlock key={chart.title} chart={chart} />
      ))}
      <Callout tone="info" title="审阅稿怎么导出">
        导出会拷贝原来的 Word，原有格式和已有修订都留着，只叠这一轮的新修订。没有新修订时不出空稿。个人版里，独立审稿的缺口写进结果，但不扣下已经改好的稿；律所版未过审稿则先不导出。外发另走发信。
      </Callout>
      {sheet.hasDraft ? (
        <Button
          variant="primary"
          onClick={() =>
            dispatch({
              type: "newComposerChat",
              userPrompt: "请按这份核对导出带修订的 Word 审阅稿。",
            })
          }
        >
          去导出审阅稿
        </Button>
      ) : null}
      <Text size="small" tone="tertiary">
        改字在中间栏，签批在在办。这里只记下你认不认这句。
      </Text>
    </Stack>
  );
}
`;
}
