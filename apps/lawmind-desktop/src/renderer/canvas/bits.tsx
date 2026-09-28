import { useState, type CSSProperties, type ReactNode } from "react";
import { canvasRadius, canvasTypography, usageColorSequence, type CanvasColor } from "./tokens";
import { useCanvasTheme } from "./theme";
import { mergeStyle } from "./primitives";

export type { CanvasColor };

export function Swatch(props: { color?: CanvasColor; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  return (
    <span
      aria-hidden="true"
      style={mergeStyle(
        {
          width: 8,
          height: 8,
          borderRadius: canvasRadius.full,
          background: theme.category[props.color ?? "gray"],
          display: "inline-block",
          flexShrink: 0,
        },
        props.style,
      )}
    />
  );
}

export function CollapsibleSection(props: {
  title: string;
  leading?: ReactNode;
  count?: number;
  trailing?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  return (
    <div style={props.style}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 0",
          border: "none",
          background: "transparent",
          color: theme.text.primary,
          font: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          style={{ transform: open ? "rotate(90deg)" : "none", flexShrink: 0 }}
        >
          <path d="M4.2 2.4 7.8 6 4.2 9.6" fill="none" stroke={theme.text.tertiary} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {props.leading}
        <span style={{ ...canvasTypography.body, fontWeight: 590 }}>{props.title}</span>
        {props.count !== undefined ? (
          <span style={{ color: theme.text.tertiary, ...canvasTypography.small }}>{props.count}</span>
        ) : null}
        {props.trailing ? <span style={{ marginLeft: "auto", color: theme.text.tertiary }}>{props.trailing}</span> : null}
      </button>
      {open ? <div style={{ paddingLeft: 20 }}>{props.children}</div> : null}
    </div>
  );
}

export function UsageBar(props: {
  segments: ReadonlyArray<{ id: string; value: number; color?: CanvasColor }>;
  total: number;
  topLeftLabel?: ReactNode;
  topRightLabel?: ReactNode;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const total = props.total > 0 ? props.total : 0;
  const used = props.segments.reduce((sum, segment) => sum + (Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0), 0);
  const remainder = Math.max(0, total - used);
  return (
    <div style={props.style}>
      {props.topLeftLabel || props.topRightLabel ? (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, color: theme.text.tertiary, ...canvasTypography.small }}>
          <span>{props.topLeftLabel}</span>
          <span>{props.topRightLabel}</span>
        </div>
      ) : null}
      <div style={{ display: "flex", height: 8, borderRadius: canvasRadius.full, overflow: "hidden", background: theme.fill.tertiary }}>
        {props.segments.map((segment, index) => {
          const value = Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0;
          if (value <= 0 || total <= 0) {
            return null;
          }
          const color = theme.category[segment.color ?? usageColorSequence[index % usageColorSequence.length] ?? "gray"];
          return <span key={segment.id} style={{ width: `${(value / total) * 100}%`, background: color }} />;
        })}
        {remainder > 0 && total > 0 ? <span style={{ width: `${(remainder / total) * 100}%` }} /> : null}
      </div>
    </div>
  );
}
