import {
  createContext,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { openLawyerHref } from "./host-actions";
import { canvasRadius, canvasTypography, type CanvasTokens } from "./tokens";
import { useCanvasTheme } from "./theme";

export function mergeStyle(base: CSSProperties, override?: CSSProperties): CSSProperties {
  return override ? { ...base, ...override } : base;
}

const alignMap = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
} as const;

const justifyMap = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  "space-between": "space-between",
} as const;

export function Stack(props: { children?: ReactNode; gap?: number; style?: CSSProperties }) {
  return (
    <div
      style={mergeStyle(
        { display: "flex", flexDirection: "column", gap: props.gap ?? 0, minWidth: 0 },
        props.style,
      )}
    >
      {props.children}
    </div>
  );
}

export function Row(props: {
  children?: ReactNode;
  gap?: number;
  align?: keyof typeof alignMap;
  justify?: keyof typeof justifyMap;
  wrap?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={mergeStyle(
        {
          display: "flex",
          flexDirection: "row",
          gap: props.gap ?? 0,
          alignItems: alignMap[props.align ?? "stretch"],
          justifyContent: justifyMap[props.justify ?? "start"],
          flexWrap: props.wrap ? "wrap" : "nowrap",
          minWidth: 0,
        },
        props.style,
      )}
    >
      {props.children}
    </div>
  );
}

export function Grid(props: {
  children?: ReactNode;
  columns: number | string;
  gap?: number;
  align?: keyof typeof alignMap;
  style?: CSSProperties;
}) {
  const columns =
    typeof props.columns === "number" ? `repeat(${props.columns}, minmax(0, 1fr))` : props.columns;
  return (
    <div
      style={mergeStyle(
        {
          display: "grid",
          gridTemplateColumns: columns,
          gap: props.gap ?? 0,
          alignItems: alignMap[props.align ?? "stretch"],
          minWidth: 0,
        },
        props.style,
      )}
    >
      {props.children}
    </div>
  );
}

export function Divider(props: { style?: CSSProperties }) {
  const theme = useCanvasTheme();
  return (
    <hr
      style={mergeStyle(
        {
          border: "none",
          borderTop: `1px solid ${theme.stroke.tertiary}`,
          margin: 0,
          width: "100%",
        },
        props.style,
      )}
    />
  );
}

export function Spacer() {
  return <div style={{ flex: "1 1 auto" }} />;
}

const weightMap = { normal: 400, medium: 500, semibold: 590, bold: 650 } as const;
const TextNest = createContext(false);

export function Text(props: {
  children?: ReactNode;
  tone?: "primary" | "secondary" | "tertiary" | "quaternary";
  size?: "body" | "small";
  as?: "p" | "span";
  weight?: keyof typeof weightMap;
  italic?: boolean;
  truncate?: boolean | "start" | "end";
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const nested = useContext(TextNest);
  const type = props.size === "small" ? canvasTypography.small : canvasTypography.body;
  const truncate = props.truncate;
  const style = mergeStyle(
    {
      margin: 0,
      color: theme.text[props.tone ?? "primary"],
      fontSize: type.fontSize,
      lineHeight: type.lineHeight,
      fontWeight: weightMap[props.weight ?? "normal"],
      fontStyle: props.italic ? "italic" : "normal",
      minWidth: truncate ? 0 : undefined,
      overflow: truncate ? "hidden" : undefined,
      textOverflow: truncate ? "ellipsis" : undefined,
      whiteSpace: truncate ? "nowrap" : undefined,
      direction: truncate === "start" ? "rtl" : undefined,
      textAlign: truncate === "start" ? "left" : undefined,
    },
    props.style,
  );
  const Tag = props.as ?? (nested ? "span" : "p");
  return (
    <TextNest.Provider value={true}>
      <Tag style={style}>{props.children}</Tag>
    </TextNest.Provider>
  );
}

export function H1(props: { children?: ReactNode; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  return (
    <h1
      style={mergeStyle(
        {
          margin: 0,
          color: theme.text.primary,
          ...canvasTypography.h1,
          letterSpacing: "-0.02em",
        },
        props.style,
      )}
    >
      {props.children}
    </h1>
  );
}

export function H2(props: { children?: ReactNode; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  return (
    <h2
      style={mergeStyle(
        {
          margin: 0,
          color: theme.text.primary,
          ...canvasTypography.h2,
          letterSpacing: "-0.015em",
        },
        props.style,
      )}
    >
      {props.children}
    </h2>
  );
}

export function H3(props: { children?: ReactNode; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  return (
    <h3
      style={mergeStyle(
        { margin: 0, color: theme.text.primary, ...canvasTypography.h3, letterSpacing: "-0.01em" },
        props.style,
      )}
    >
      {props.children}
    </h3>
  );
}

export function Link(props: { children?: ReactNode; href: string; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  return (
    <a
      href={props.href}
      style={mergeStyle(
        { color: theme.text.link, textDecoration: "underline", textUnderlineOffset: 2 },
        props.style,
      )}
      onClick={(event) => {
        event.preventDefault();
        const href = props.href.trim();
        if (!href) {
          return;
        }
        if (window.parent !== window) {
          window.parent.postMessage({ source: "lawmind-canvas", type: "openHref", href }, "*");
          return;
        }
        openLawyerHref(href);
      }}
    >
      {props.children}
    </a>
  );
}

export function Code(props: { children?: ReactNode; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  return (
    <code
      style={mergeStyle(
        {
          fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
          fontSize: "0.92em",
          lineHeight: "inherit",
          background: theme.fill.tertiary,
          borderRadius: canvasRadius.sm,
          padding: "0 4px",
        },
        props.style,
      )}
    >
      {props.children}
    </code>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  variant?: "primary" | "secondary" | "ghost";
  style?: CSSProperties;
};

export function Button({ variant = "secondary", style, disabled, type = "button", ...rest }: ButtonProps) {
  const theme = useCanvasTheme();
  const [hover, setHover] = useState(false);
  const face =
    variant === "primary"
      ? {
          background: hover && !disabled ? theme.accent.controlHover : theme.accent.control,
          color: theme.text.onAccent,
          border: "1px solid transparent",
        }
      : variant === "ghost"
        ? {
            background: hover && !disabled ? theme.fill.tertiary : "transparent",
            color: theme.text.secondary,
            border: "1px solid transparent",
          }
        : {
            background: hover && !disabled ? theme.fill.secondary : theme.fill.tertiary,
            color: theme.text.primary,
            border: `1px solid ${theme.stroke.secondary}`,
          };
  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
      style={mergeStyle(
        {
          ...face,
          height: 24,
          padding: "0 8px",
          borderRadius: canvasRadius.sm,
          font: "inherit",
          fontSize: canvasTypography.small.fontSize,
          lineHeight: canvasTypography.small.lineHeight,
          fontWeight: 500,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.45 : 1,
          width: "fit-content",
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "nowrap",
        },
        style,
      )}
    />
  );
}

const CardContext = createContext<{
  open: boolean;
  collapsible: boolean;
  stickyHeader: boolean;
  headerHeight: number;
  toggle: () => void;
} | null>(null);

export function Card(props: {
  children?: ReactNode;
  variant?: "default" | "borderless";
  size?: "base" | "lg";
  stickyHeader?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const [uncontrolled, setUncontrolled] = useState(props.defaultOpen ?? true);
  const open = props.open ?? uncontrolled;
  const toggle = () => {
    const next = !open;
    if (props.open === undefined) {
      setUncontrolled(next);
    }
    props.onOpenChange?.(next);
  };
  const borderless = props.variant === "borderless";
  return (
    <CardContext.Provider
      value={{
        open,
        collapsible: Boolean(props.collapsible),
        stickyHeader: Boolean(props.stickyHeader),
        headerHeight: props.size === "lg" ? 32 : 28,
        toggle,
      }}
    >
      <section
        style={mergeStyle(
          {
            border: borderless ? "none" : `1px solid ${theme.stroke.secondary}`,
            borderRadius: borderless ? 0 : canvasRadius.lg,
            background: theme.bg.elevated,
            minWidth: 0,
          },
          props.style,
        )}
      >
        {props.children}
      </section>
    </CardContext.Provider>
  );
}

function CanvasChevron(props: { expanded: boolean }) {
  const theme = useCanvasTheme();
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: props.expanded ? "rotate(90deg)" : "none",
      }}
    >
      <path
        d="M4.2 2.4 7.8 6 4.2 9.6"
        fill="none"
        stroke={theme.text.tertiary}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CardHeader(props: { children?: ReactNode; trailing?: ReactNode; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  const card = useContext(CardContext);
  const height = card?.headerHeight ?? 28;
  const label = (
    <span
      style={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: canvasTypography.small.fontSize,
        lineHeight: canvasTypography.small.lineHeight,
        fontWeight: 590,
        color: theme.text.secondary,
      }}
    >
      {props.children}
    </span>
  );
  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height,
    padding: "0 12px",
    borderBottom: card?.open === false ? "none" : `1px solid ${theme.stroke.tertiary}`,
    position: card?.stickyHeader ? "sticky" : undefined,
    top: card?.stickyHeader ? 0 : undefined,
    zIndex: card?.stickyHeader ? 1 : undefined,
    background: card?.stickyHeader ? theme.bg.elevated : undefined,
  };
  const trailing = props.trailing ? (
    <span style={{ marginLeft: "auto", flexShrink: 0 }}>{props.trailing}</span>
  ) : null;
  if (card?.collapsible) {
    return (
      <button
        type="button"
        aria-expanded={card.open}
        onClick={card.toggle}
        style={mergeStyle(
          {
            ...rowStyle,
            width: "100%",
            borderLeft: "none",
            borderRight: "none",
            borderTop: "none",
            background: "transparent",
            font: "inherit",
            cursor: "pointer",
            textAlign: "left",
          },
          props.style,
        )}
      >
        <CanvasChevron expanded={card.open} />
        {label}
        {trailing}
      </button>
    );
  }
  return (
    <div style={mergeStyle(rowStyle, props.style)}>
      {label}
      {trailing}
    </div>
  );
}

export function CardBody(props: { children?: ReactNode; style?: CSSProperties }) {
  const card = useContext(CardContext);
  if (card && !card.open) {
    return null;
  }
  return <div style={mergeStyle({ padding: 12 }, props.style)}>{props.children}</div>;
}

export function Pill(props: {
  children?: ReactNode;
  active?: boolean;
  size?: "sm" | "md";
  leadingContent?: ReactNode;
  keyboardHint?: string;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const sm = props.size === "sm";
  const [hover, setHover] = useState(false);
  const style = mergeStyle(
    {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: sm ? 18 : 22,
      padding: sm ? "0 6px" : "0 8px",
      borderRadius: canvasRadius.full,
      border: sm ? "none" : `1px solid ${props.active ? theme.stroke.primary : theme.stroke.secondary}`,
      background: props.active ? theme.fill.primary : hover ? theme.fill.tertiary : theme.fill.quaternary,
      color: props.active ? theme.text.primary : theme.text.secondary,
      fontSize: sm ? "11px" : canvasTypography.small.fontSize,
      lineHeight: canvasTypography.small.lineHeight,
      fontWeight: 500,
      whiteSpace: "nowrap",
      width: "fit-content",
      alignSelf: "flex-start",
      fontFamily: "inherit",
      cursor: props.onClick && !props.disabled ? "pointer" : "default",
      opacity: props.disabled ? 0.45 : 1,
    },
    props.style,
  );
  const body = (
    <>
      {props.leadingContent}
      {props.children}
      {props.keyboardHint ? (
        <span style={{ color: theme.text.quaternary, fontWeight: 400 }}>{props.keyboardHint}</span>
      ) : null}
    </>
  );
  if (!props.onClick) {
    return (
      <span title={props.title} style={style}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={style}
    >
      {body}
    </button>
  );
}

export function Stat(props: {
  value: ReactNode;
  label: string;
  tone?: "success" | "danger" | "warning" | "info";
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const color = props.tone ? theme.stat[props.tone] : theme.text.primary;
  return (
    <div style={mergeStyle({ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }, props.style)}>
      <div
        style={{
          color,
          fontSize: "20px",
          lineHeight: "26px",
          fontWeight: 590,
          letterSpacing: "-0.02em",
        }}
      >
        {props.value}
      </div>
      <div style={{ color: theme.text.tertiary, ...canvasTypography.small }}>{props.label}</div>
    </div>
  );
}

function CalloutIcon(props: { tone: "info" | "success" | "warning" | "danger" | "neutral"; color: string }) {
  if (props.tone === "neutral") {
    return null;
  }
  const common = { fill: "none", stroke: props.color, strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
      {props.tone === "warning" ? (
        <path {...common} d="M8 2.2 14.2 13.4H1.8L8 2.2Z M8 6.4v3.2M8 11.4v.6" />
      ) : (
        <g>
          <circle {...common} cx="8" cy="8" r="6.1" />
          {props.tone === "success" ? (
            <path {...common} d="M5 8.2 7 10.2 11 5.8" />
          ) : props.tone === "danger" ? (
            <path {...common} d="M8 4.8v3.8M8 10.8v.5" />
          ) : (
            <path {...common} d="M8 7.2v3.6M8 5.1v.5" />
          )}
        </g>
      )}
    </svg>
  );
}

export function Callout(props: {
  children?: ReactNode;
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
  title?: ReactNode;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const tone = props.tone ?? "info";
  const color =
    tone === "success"
      ? theme.stat.success
      : tone === "danger"
        ? theme.stat.danger
        : tone === "warning"
          ? theme.stat.warning
          : tone === "info"
            ? theme.stat.info
            : theme.text.secondary;
  return (
    <div
      style={mergeStyle(
        {
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          padding: "10px 12px",
          borderRadius: canvasRadius.md,
          background: theme.fill.quaternary,
          border: `1px solid ${theme.stroke.tertiary}`,
          color: theme.text.primary,
        },
        props.style,
      )}
    >
      <CalloutIcon tone={tone} color={color} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {props.title ? (
          <div style={{ fontSize: "13px", lineHeight: "18px", fontWeight: 590 }}>{props.title}</div>
        ) : null}
        <div style={{ ...canvasTypography.body, color: theme.text.secondary }}>{props.children}</div>
      </div>
    </div>
  );
}

const toneDot: Record<"success" | "danger" | "warning" | "info" | "neutral", (t: CanvasTokens) => string> = {
  success: (t) => t.stat.success,
  danger: (t) => t.stat.danger,
  warning: (t) => t.stat.warning,
  info: (t) => t.stat.info,
  neutral: (t) => t.text.quaternary,
};

export function Table(props: {
  headers: ReactNode[];
  rows: ReactNode[][];
  columnAlign?: Array<"left" | "center" | "right" | undefined>;
  rowTone?: Array<"success" | "danger" | "warning" | "info" | "neutral" | undefined>;
  framed?: boolean;
  striped?: boolean;
  stickyHeader?: boolean;
  style?: CSSProperties;
  emptyMessage?: ReactNode;
}) {
  const theme = useCanvasTheme();
  const framed = props.framed !== false;
  const columnCount = props.headers.length;
  const table = (
    <table
      className="lm-canvas-table"
      style={{
        width: "max-content",
        minWidth: "100%",
        borderCollapse: "collapse",
        fontSize: canvasTypography.small.fontSize,
        lineHeight: canvasTypography.small.lineHeight,
        color: theme.text.primary,
      }}
    >
      <thead>
        <tr>
          {props.headers.map((header, index) => (
            <th
              key={index}
              scope="col"
              style={{
                textAlign: props.columnAlign?.[index] ?? "left",
                fontWeight: 590,
                color: theme.text.tertiary,
                padding: "8px 10px",
                borderBottom: `1px solid ${theme.stroke.tertiary}`,
                background: theme.fill.quaternary,
                position: props.stickyHeader ? "sticky" : undefined,
                top: props.stickyHeader ? 0 : undefined,
                whiteSpace: "nowrap",
              }}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.length === 0 ? (
          <tr>
            <td
              colSpan={Math.max(columnCount, 1)}
              style={{ padding: "12px 10px", color: theme.text.tertiary }}
            >
              {props.emptyMessage}
            </td>
          </tr>
        ) : (
          props.rows.map((row, rowIndex) => {
            const tone = props.rowTone?.[rowIndex];
            return (
              <tr key={rowIndex}>
                {props.headers.map((_, columnIndex) => (
                  <td
                    key={columnIndex}
                    style={{
                      textAlign: props.columnAlign?.[columnIndex] ?? "left",
                      padding: "8px 10px",
                      borderBottom: `1px solid ${theme.stroke.tertiary}`,
                      verticalAlign: "top",
                      minWidth: "7.5rem",
                    }}
                  >
                    {columnIndex === 0 && tone ? (
                      <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 6,
                            height: 6,
                            marginTop: 5,
                            borderRadius: canvasRadius.full,
                            background: toneDot[tone](theme),
                            flexShrink: 0,
                          }}
                        />
                        <span>{row[columnIndex] ?? ""}</span>
                      </span>
                    ) : (
                      (row[columnIndex] ?? "")
                    )}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
  const painted = (
    <>
      <style>{`.lm-canvas-table tbody tr:nth-child(even){background:${props.striped ? theme.fill.quaternary : "transparent"}}.lm-canvas-table tbody tr:hover{background:${theme.fill.tertiary}}`}</style>
      {table}
    </>
  );
  if (!framed) {
    return <div style={props.style}>{painted}</div>;
  }
  return (
    <div
      style={mergeStyle(
        {
          border: `1px solid ${theme.stroke.secondary}`,
          borderRadius: canvasRadius.lg,
          overflow: "auto",
          background: theme.bg.editor,
        },
        props.style,
      )}
    >
      {painted}
    </div>
  );
}
