/**
 * Canvas surfaces, type, and spacing.
 *
 * Clean-room match of the Cursor canvas visual contract (flat solids, 24/18/16/14
 * type, hairline strokes). Not derived from Cursor's closed implementation.
 * Mix ratios follow the published token notes: text 100/74/60/36, fills 20/14/8/6,
 * strokes 20/12/8, over a light text base #141414 and a dark text base #F0F0F0.
 */

export const canvasTypography = {
  h1: { fontSize: "24px", lineHeight: "30px", fontWeight: 590 },
  h2: { fontSize: "18px", lineHeight: "24px", fontWeight: 590 },
  h3: { fontSize: "16px", lineHeight: "22px", fontWeight: 590 },
  body: { fontSize: "14px", lineHeight: "20px", fontWeight: 400 },
  small: { fontSize: "12px", lineHeight: "16px", fontWeight: 400 },
} as const;

export const canvasSpacing = {
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "2.5": 10,
  "3": 12,
  "3.5": 14,
  "4": 16,
  "4.5": 18,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
} as const;

export const canvasRadius = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

export const canvasFont =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const canvasMono = 'ui-monospace, "SF Mono", "Cascadia Code", monospace';

export type CanvasKind = "light" | "dark";

export type CanvasTokens = {
  bg: { editor: string; chrome: string; elevated: string };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    quaternary: string;
    link: string;
    onAccent: string;
  };
  stroke: { primary: string; secondary: string; tertiary: string; focused: string };
  fill: { primary: string; secondary: string; tertiary: string; quaternary: string };
  accent: { primary: string; control: string; controlHover: string };
  diff: {
    insertedLine: string;
    removedLine: string;
    stripAdded: string;
    stripRemoved: string;
  };
  stat: { success: string; danger: string; warning: string; info: string };
  category: CategoryPalette;
};

export type CanvasColor = "gray" | "purple" | "green" | "yellow" | "cyan" | "pink" | "blue" | "orange" | "red";
export type CategoryPalette = Readonly<Record<CanvasColor, string>>;

export const categoryPaletteLight: CategoryPalette = {
  gray: "#737373",
  purple: "#6D28D9",
  green: "#0D855A",
  yellow: "#A16207",
  cyan: "#0F766E",
  pink: "#BE185D",
  blue: "#3685BF",
  orange: "#C2410C",
  red: "#CF2D56",
};

export const categoryPaletteDark: CategoryPalette = {
  gray: "#A3A3A3",
  purple: "#C4B5FD",
  green: "#3FA266",
  yellow: "#E8C030",
  cyan: "#5EEAD4",
  pink: "#F9A8D4",
  blue: "#87C3FF",
  orange: "#FDBA74",
  red: "#FC6B83",
};

/** Back-compat name. Prefer `useHostTheme().category` so it follows light/dark. */
export const colorPalette: CategoryPalette = categoryPaletteDark;

export const usageColorSequence: readonly CanvasColor[] = [
  "gray",
  "purple",
  "green",
  "yellow",
  "cyan",
  "pink",
  "blue",
  "orange",
  "red",
];

export type CanvasPalette = {
  readonly foreground: string;
  readonly foregroundSecondary: string;
  readonly foregroundTertiary: string;
  readonly foregroundQuaternary: string;
  readonly editor: string;
  readonly chrome: string;
  readonly sidebar: string;
  readonly elevated: string;
  readonly fillPrimary: string;
  readonly fillSecondary: string;
  readonly fillTertiary: string;
  readonly fillQuaternary: string;
  readonly strokePrimary: string;
  readonly strokeSecondary: string;
  readonly strokeTertiary: string;
  readonly strokeFocused: string;
  readonly accent: string;
  readonly buttonBackground: string;
  readonly buttonForeground: string;
  readonly buttonHoverBackground: string;
  readonly link: string;
  readonly diffInsertedLine: string;
  readonly diffRemovedLine: string;
  readonly diffStripAdded: string;
  readonly diffStripRemoved: string;
};

const lightText = "#141414";
/** Cursor core dark text is slightly under pure white so hairlines stay visible. */
const darkText = "#E4E4E4";

function mix(base: string, percent: number): string {
  const alpha = Math.round((percent / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${base}${alpha}`;
}

export const canvasTokensLight: CanvasTokens = {
  bg: { editor: "#FCFCFC", chrome: "#F3F3F3", elevated: "#FCFCFC" },
  text: {
    primary: lightText,
    secondary: mix(lightText, 74),
    tertiary: mix(lightText, 60),
    quaternary: mix(lightText, 36),
    link: "#3685BF",
    onAccent: "#FCFCFC",
  },
  stroke: {
    primary: mix(lightText, 20),
    secondary: mix(lightText, 12),
    tertiary: mix(lightText, 8),
    focused: "#3685BF",
  },
  fill: {
    primary: mix(lightText, 20),
    secondary: mix(lightText, 14),
    tertiary: mix(lightText, 8),
    quaternary: mix(lightText, 6),
  },
  accent: { primary: "#3685BF", control: "#3685BF", controlHover: "#2E76AB" },
  diff: {
    insertedLine: "#1F8A651F",
    removedLine: "#CF2D5614",
    stripAdded: "#1F8A65CC",
    stripRemoved: "#CF2D56CC",
  },
  stat: { success: "#0D855A", danger: "#CF2D56", warning: "#A16207", info: "#3685BF" },
  category: categoryPaletteLight,
};

export const canvasTokensDark: CanvasTokens = {
  bg: { editor: "#181818", chrome: "#141414", elevated: "#181818" },
  text: {
    primary: darkText,
    secondary: mix(darkText, 74),
    tertiary: mix(darkText, 60),
    quaternary: mix(darkText, 36),
    link: "#87C3FF",
    onAccent: "#191C22",
  },
  stroke: {
    primary: mix(darkText, 20),
    secondary: mix(darkText, 12),
    tertiary: mix(darkText, 8),
    focused: "#E4E4E4",
  },
  fill: {
    primary: mix(darkText, 20),
    secondary: mix(darkText, 14),
    tertiary: mix(darkText, 8),
    quaternary: mix(darkText, 6),
  },
  accent: { primary: "#599CE7", control: "#599CE7", controlHover: "#6AABE9" },
  diff: {
    insertedLine: "#3FA26633",
    removedLine: "#B8004933",
    stripAdded: "#3FA2668F",
    stripRemoved: "#FC6B838F",
  },
  stat: { success: "#3FA266", danger: "#FC6B83", warning: "#E8C030", info: "#87C3FF" },
  category: categoryPaletteDark,
};

export const canvasTokens = canvasTokensDark;

export const canvasPaletteLight: CanvasPalette = paletteFrom(canvasTokensLight);
export const canvasPaletteDark: CanvasPalette = paletteFrom(canvasTokensDark);

function paletteFrom(tokens: CanvasTokens): CanvasPalette {
  return {
    foreground: tokens.text.primary,
    foregroundSecondary: tokens.text.secondary,
    foregroundTertiary: tokens.text.tertiary,
    foregroundQuaternary: tokens.text.quaternary,
    editor: tokens.bg.editor,
    chrome: tokens.bg.chrome,
    sidebar: tokens.bg.chrome,
    elevated: tokens.bg.elevated,
    fillPrimary: tokens.fill.primary,
    fillSecondary: tokens.fill.secondary,
    fillTertiary: tokens.fill.tertiary,
    fillQuaternary: tokens.fill.quaternary,
    strokePrimary: tokens.stroke.primary,
    strokeSecondary: tokens.stroke.secondary,
    strokeTertiary: tokens.stroke.tertiary,
    strokeFocused: tokens.stroke.focused,
    accent: tokens.accent.primary,
    buttonBackground: tokens.accent.control,
    buttonForeground: tokens.text.onAccent,
    buttonHoverBackground: tokens.accent.controlHover,
    link: tokens.text.link,
    diffInsertedLine: tokens.diff.insertedLine,
    diffRemovedLine: tokens.diff.removedLine,
    diffStripAdded: tokens.diff.stripAdded,
    diffStripRemoved: tokens.diff.stripRemoved,
  };
}

export function buildHostTokens(kind: string): { tokens: CanvasTokens; palette: CanvasPalette } {
  const light = kind === "light" || kind === "hc-light";
  const tokens = light ? canvasTokensLight : canvasTokensDark;
  return { tokens, palette: light ? canvasPaletteLight : canvasPaletteDark };
}

export function canvasTokensFor(kind: CanvasKind): CanvasTokens {
  return kind === "dark" ? canvasTokensDark : canvasTokensLight;
}
