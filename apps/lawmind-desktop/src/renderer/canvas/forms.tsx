import { useState, type CSSProperties, type ReactNode } from "react";
import { canvasRadius, canvasTypography } from "./tokens";
import { useCanvasTheme } from "./theme";
import { mergeStyle } from "./primitives";

function useFocusRing(): {
  outline: string;
  outlineOffset: number;
  onFocus: () => void;
  onBlur: () => void;
} {
  const theme = useCanvasTheme();
  const [focused, setFocused] = useState(false);
  return {
    outline: focused ? `1px solid ${theme.stroke.focused}` : "none",
    outlineOffset: 1,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

const fieldBase = {
  height: 28,
  borderRadius: canvasRadius.sm,
  padding: "0 8px",
  font: "inherit",
  fontSize: canvasTypography.body.fontSize,
  lineHeight: canvasTypography.body.lineHeight,
  width: "100%",
  boxSizing: "border-box" as const,
};

export function TextInput(props: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "email" | "password" | "number" | "url" | "search";
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const focus = useFocusRing();
  return (
    <input
      type={props.type ?? "text"}
      value={props.value ?? ""}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.(event.target.value)}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      style={mergeStyle(
        {
          ...fieldBase,
          background: theme.bg.editor,
          color: theme.text.primary,
          border: `1px solid ${theme.stroke.secondary}`,
          outline: focus.outline,
          outlineOffset: focus.outlineOffset,
        },
        props.style,
      )}
    />
  );
}

export function TextArea(props: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const focus = useFocusRing();
  return (
    <textarea
      value={props.value ?? ""}
      placeholder={props.placeholder}
      disabled={props.disabled}
      rows={props.rows ?? 3}
      onChange={(event) => props.onChange?.(event.target.value)}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      style={mergeStyle(
        {
          ...fieldBase,
          height: "auto",
          padding: "6px 8px",
          resize: "vertical",
          background: theme.bg.editor,
          color: theme.text.primary,
          border: `1px solid ${theme.stroke.secondary}`,
          outline: focus.outline,
          outlineOffset: focus.outlineOffset,
        },
        props.style,
      )}
    />
  );
}

export function Checkbox(props: {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  return (
    <label
      style={mergeStyle(
        {
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          color: theme.text.primary,
          ...canvasTypography.body,
          cursor: props.disabled ? "default" : "pointer",
          opacity: props.disabled ? 0.45 : 1,
        },
        props.style,
      )}
    >
      <input
        type="checkbox"
        checked={Boolean(props.checked)}
        disabled={props.disabled}
        onChange={(event) => props.onChange?.(event.target.checked)}
        style={{ accentColor: theme.accent.primary }}
      />
      {props.label}
    </label>
  );
}

export function Toggle(props: {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const md = props.size === "md";
  const width = md ? 36 : 28;
  const height = md ? 20 : 16;
  const on = Boolean(props.checked);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={props.disabled}
      onClick={() => props.onChange?.(!on)}
      style={mergeStyle(
        {
          width,
          height,
          borderRadius: canvasRadius.full,
          border: "none",
          padding: 2,
          background: on ? theme.accent.control : theme.fill.primary,
          cursor: props.disabled ? "default" : "pointer",
          opacity: props.disabled ? 0.45 : 1,
        },
        props.style,
      )}
    >
      <span
        style={{
          display: "block",
          width: height - 4,
          height: height - 4,
          borderRadius: canvasRadius.full,
          background: theme.bg.editor,
          marginLeft: on ? width - height : 0,
        }}
      />
    </button>
  );
}

export function Select(props: {
  value?: string;
  onChange?: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const focus = useFocusRing();
  return (
    <select
      value={props.value ?? ""}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.(event.target.value)}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      style={mergeStyle(
        {
          ...fieldBase,
          background: theme.bg.editor,
          color: theme.text.primary,
          border: `1px solid ${theme.stroke.secondary}`,
          outline: focus.outline,
          outlineOffset: focus.outlineOffset,
        },
        props.style,
      )}
    >
      {props.placeholder ? (
        <option value="" disabled>
          {props.placeholder}
        </option>
      ) : null}
      {props.options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function IconButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "default" | "circle";
  size?: "sm" | "md";
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const px = props.size === "sm" ? 16 : 20;
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      style={mergeStyle(
        {
          width: px,
          height: px,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: props.variant === "circle" ? canvasRadius.full : canvasRadius.sm,
          background: props.variant === "circle" ? theme.fill.tertiary : "transparent",
          color: theme.text.secondary,
          cursor: props.disabled ? "default" : "pointer",
          padding: 0,
        },
        props.style,
      )}
    >
      {props.children}
    </button>
  );
}
