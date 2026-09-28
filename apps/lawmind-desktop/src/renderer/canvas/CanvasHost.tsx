import type { HTMLAttributes, ReactNode } from "react";
import { canvasFont } from "./tokens";
import { CanvasThemeProvider, useCanvasTheme, useLawmindCanvasKind } from "./theme";

type HostProps = HTMLAttributes<HTMLElement> & { children?: ReactNode };

/** Theme only. Use inside chat or a card so the surface does not become a second scrolling page. */
export function CanvasThemeRoot(props: { children?: ReactNode }) {
  const kind = useLawmindCanvasKind();
  return <CanvasThemeProvider kind={kind}>{props.children}</CanvasThemeProvider>;
}

export function CanvasHost({ children, style, ...rest }: HostProps) {
  const kind = useLawmindCanvasKind();
  return (
    <CanvasThemeProvider kind={kind}>
      <CanvasHostFrame style={style} {...rest}>
        {children}
      </CanvasHostFrame>
    </CanvasThemeProvider>
  );
}

function CanvasHostFrame({ children, style, ...rest }: HostProps) {
  const theme = useCanvasTheme();
  return (
    <section
      {...rest}
      style={{
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: 0,
        overflow: "auto",
        background: theme.bg.editor,
        color: theme.text.primary,
        fontFamily: canvasFont,
        WebkitFontSmoothing: "antialiased",
        padding: "24px 28px 36px",
        ...style,
      }}
    >
      {children}
    </section>
  );
}
