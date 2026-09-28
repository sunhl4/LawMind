import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { canvasTokensFor, type CanvasKind, type CanvasTokens } from "./tokens";

const CanvasThemeContext = createContext<CanvasTokens | null>(null);

export function useCanvasTheme(): CanvasTokens {
  const theme = useContext(CanvasThemeContext);
  if (!theme) {
    throw new Error("Canvas components must render inside CanvasHost");
  }
  return theme;
}

export function CanvasThemeProvider(props: { kind: CanvasKind; children: ReactNode }) {
  return (
    <CanvasThemeContext.Provider value={canvasTokensFor(props.kind)}>
      {props.children}
    </CanvasThemeContext.Provider>
  );
}

export function useLawmindCanvasKind(): CanvasKind {
  const read = (): CanvasKind =>
    document.documentElement.classList.contains("lm-theme-dark") ? "dark" : "light";
  const [kind, setKind] = useState<CanvasKind>(read);
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setKind(read());
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return kind;
}
