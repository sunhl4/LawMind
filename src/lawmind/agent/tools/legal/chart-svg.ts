import { isEmptyChartSpec, type ChartSpec } from "./chart-spec.js";

const W = 640;
const H = 360;
const PAD = { t: 28, r: 20, b: 56, l: 56 };

const PALETTE = ["#3d5a80", "#ee6c4d", "#98c1d9", "#293241", "#e0fbfc", "#b08968"];

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function maxAbs(spec: ChartSpec): number {
  let m = 0;
  if (spec.type === "stacked_bar") {
    const n = spec.categories.length;
    for (let i = 0; i < n; i++) {
      const sum = spec.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0);
      m = Math.max(m, sum);
    }
    return m || 1;
  }
  for (const s of spec.series) {
    for (const v of s.values) {
      m = Math.max(m, Math.abs(v));
    }
  }
  return m || 1;
}

function plotBox() {
  return {
    x: PAD.l,
    y: PAD.t,
    w: W - PAD.l - PAD.r,
    h: H - PAD.t - PAD.b,
  };
}

function legend(spec: ChartSpec): string {
  const items = spec.series.map((s, i) => {
    const x = PAD.l + i * 140;
    const y = H - 22;
    return `<rect class="lm-chart-swatch" x="${x}" y="${y - 8}" width="10" height="10" fill="${PALETTE[i % PALETTE.length]}"/><text class="lm-chart-legend" x="${x + 14}" y="${y + 2}">${esc(s.name)}</text>`;
  });
  return items.join("");
}

function axis(
  box: { x: number; y: number; w: number; h: number },
  max: number,
  cats: string[],
): string {
  const ticks = 4;
  const parts = [
    `<line class="lm-chart-axis" x1="${box.x}" y1="${box.y}" x2="${box.x}" y2="${box.y + box.h}"/>`,
    `<line class="lm-chart-axis" x1="${box.x}" y1="${box.y + box.h}" x2="${box.x + box.w}" y2="${box.y + box.h}"/>`,
  ];
  for (let i = 0; i <= ticks; i++) {
    const t = i / ticks;
    const y = box.y + box.h - t * box.h;
    const label = (max * t).toFixed(max >= 100 ? 0 : 1);
    parts.push(
      `<line class="lm-chart-grid" x1="${box.x}" y1="${y}" x2="${box.x + box.w}" y2="${y}"/>`,
      `<text class="lm-chart-tick" x="${box.x - 6}" y="${y + 3}" text-anchor="end">${label}</text>`,
    );
  }
  const n = cats.length || 1;
  cats.forEach((c, i) => {
    const x = box.x + ((i + 0.5) * box.w) / n;
    parts.push(
      `<text class="lm-chart-cat" x="${x}" y="${box.y + box.h + 16}" text-anchor="middle">${esc(c.slice(0, 12))}</text>`,
    );
  });
  return parts.join("");
}

function renderBar(spec: ChartSpec): string {
  const box = plotBox();
  const max = maxAbs(spec);
  const n = spec.categories.length;
  const groupW = box.w / n;
  const barW = Math.max(4, (groupW * 0.7) / spec.series.length);
  const parts = [axis(box, max, spec.categories)];
  spec.series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const h = (Math.abs(v) / max) * box.h;
      const x = box.x + i * groupW + groupW * 0.15 + si * barW;
      const y = box.y + box.h - h;
      parts.push(
        `<rect class="lm-chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE[si % PALETTE.length]}"/>`,
        `<text class="lm-chart-value" x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${v}</text>`,
      );
    });
  });
  return parts.join("");
}

function renderStacked(spec: ChartSpec): string {
  const box = plotBox();
  const max = maxAbs(spec);
  const n = spec.categories.length;
  const groupW = box.w / n;
  const barW = groupW * 0.55;
  const parts = [axis(box, max, spec.categories)];
  for (let i = 0; i < n; i++) {
    let acc = 0;
    spec.series.forEach((s, si) => {
      const v = Math.max(0, s.values[i] ?? 0);
      const h = (v / max) * box.h;
      const y = box.y + box.h - acc - h;
      const x = box.x + i * groupW + (groupW - barW) / 2;
      parts.push(
        `<rect class="lm-chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE[si % PALETTE.length]}"/>`,
      );
      if (v > 0) {
        parts.push(
          `<text class="lm-chart-value" x="${(x + barW / 2).toFixed(1)}" y="${(y + h / 2 + 3).toFixed(1)}" text-anchor="middle">${v}</text>`,
        );
      }
      acc += h;
    });
  }
  return parts.join("");
}

function renderLine(spec: ChartSpec): string {
  const box = plotBox();
  const max = maxAbs(spec);
  const n = spec.categories.length;
  const parts = [axis(box, max, spec.categories)];
  spec.series.forEach((s, si) => {
    const pts = s.values.map((v, i) => {
      const x = box.x + ((i + 0.5) * box.w) / n;
      const y = box.y + box.h - (Math.abs(v) / max) * box.h;
      return { x, y, v };
    });
    parts.push(
      `<polyline class="lm-chart-line" fill="none" stroke="${PALETTE[si % PALETTE.length]}" stroke-width="2" points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>`,
    );
    for (const p of pts) {
      parts.push(
        `<circle class="lm-chart-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${PALETTE[si % PALETTE.length]}"/>`,
        `<text class="lm-chart-value" x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle">${p.v}</text>`,
      );
    }
  });
  return parts.join("");
}

function renderPie(spec: ChartSpec): string {
  const values = spec.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + Math.abs(b), 0);
  const cx = W / 2;
  const cy = (H - 24) / 2;
  const r = Math.min(W, H) * 0.28;
  if (total <= 0) {
    return `<text class="lm-chart-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">暂无数据</text>`;
  }
  let angle = -Math.PI / 2;
  const parts: string[] = [];
  values.forEach((v, i) => {
    const slice = (Math.abs(v) / total) * Math.PI * 2;
    const a2 = angle + slice;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = slice > Math.PI ? 1 : 0;
    const mid = angle + slice / 2;
    parts.push(
      `<path class="lm-chart-slice" d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${PALETTE[i % PALETTE.length]}"/>`,
      `<text class="lm-chart-value" x="${(cx + Math.cos(mid) * r * 0.62).toFixed(1)}" y="${(cy + Math.sin(mid) * r * 0.62).toFixed(1)}" text-anchor="middle">${esc(spec.categories[i] ?? "")} ${v}</text>`,
    );
    angle = a2;
  });
  spec.categories.forEach((c, i) => {
    const x = 24;
    const y = H - 20 - (spec.categories.length - 1 - i) * 14;
    parts.push(
      `<rect class="lm-chart-swatch" x="${x}" y="${y - 8}" width="10" height="10" fill="${PALETTE[i % PALETTE.length]}"/>`,
      `<text class="lm-chart-legend" x="${x + 14}" y="${y + 2}">${esc(c)}</text>`,
    );
  });
  return parts.join("");
}

export function renderChartSvg(spec: ChartSpec): string {
  const inner = isEmptyChartSpec(spec)
    ? `<text class="lm-chart-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">暂无数据</text>`
    : spec.type === "pie"
      ? renderPie(spec)
      : spec.type === "line"
        ? renderLine(spec)
        : spec.type === "stacked_bar"
          ? renderStacked(spec)
          : renderBar(spec);
  const unit = spec.unit
    ? `<text class="lm-chart-unit" x="${PAD.l}" y="16">${esc(spec.unit)}</text>`
    : "";
  const body = spec.type === "pie" || isEmptyChartSpec(spec) ? inner : `${inner}${legend(spec)}`;
  return `<svg class="lm-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}">${unit}${body}</svg>`;
}
