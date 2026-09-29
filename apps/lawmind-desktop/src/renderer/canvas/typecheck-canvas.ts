import ts from "typescript";
import type { CanvasDiagnostic } from "./compile-canvas";

const LIB_DTS = `
interface Array<T> {
  length: number;
  [index: number]: T;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  filter(callbackfn: (value: T, index: number, array: T[]) => boolean): T[];
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  reduce<U>(callbackfn: (previous: U, value: T, index: number) => U, initial: U): U;
  slice(start?: number, end?: number): T[];
  join(separator?: string): string;
  find(callbackfn: (value: T, index: number) => boolean): T | undefined;
  some(callbackfn: (value: T, index: number) => boolean): boolean;
}
interface ReadonlyArray<T> {
  length: number;
  [index: number]: T;
  map<U>(callbackfn: (value: T, index: number) => U): U[];
}
declare const undefined: undefined;
declare const NaN: number;
interface Boolean {}
interface Function {}
interface IArguments {}
interface Number {
  toFixed(fractionDigits?: number): string;
}
interface String {
  length: number;
  [index: number]: string;
  slice(start?: number, end?: number): string;
  includes(search: string): boolean;
  trim(): string;
  replace(search: string | RegExp, replacement: string): string;
  split(separator: string | RegExp): string[];
  startsWith(search: string): boolean;
}
interface Object {}
interface ObjectConstructor {
  keys(value: object): string[];
}
declare const Object: ObjectConstructor;
declare const Math: {
  round(value: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  abs(value: number): number;
};
declare const JSON: { parse(text: string): any; stringify(value: unknown): string };
interface Date {
  toISOString(): string;
}
interface DateConstructor {
  new (): Date;
  now(): number;
}
declare const Date: DateConstructor;
interface RegExp {}
interface RegExpConstructor {
  new (pattern: string): RegExp;
}
declare const RegExp: RegExpConstructor;
declare namespace JSX {
  interface Element {}
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: string | number | null;
  }
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
`;

const REACT_DTS = `
export type ReactNode = JSX.Element | string | number | boolean | null | undefined | ReactNode[];
export type CSSProperties = { [key: string]: string | number | undefined };
export function useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void];
export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
export function useRef<T>(initial: T): { current: T };
`;

const JSX_RUNTIME_DTS = `
export function jsx(type: any, props: any, key?: any): JSX.Element;
export function jsxs(type: any, props: any, key?: any): JSX.Element;
export function jsxDEV(type: any, props: any, key?: any): JSX.Element;
export const Fragment: unique symbol;
`;

const CANVAS_DTS = `
import type { ReactNode, CSSProperties } from "react";
type Loose = Record<string, unknown>;
type Tone = "success" | "danger" | "warning" | "info" | "neutral";
export type ReactNode = ReactNode;
export type CSSProperties = CSSProperties;
export function useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void];
export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
export function useRef<T>(initial: T): { current: T };
export function useHostTheme(): Loose & {
  text: { primary: string; secondary: string; tertiary: string; quaternary: string; link: string; onAccent: string };
  bg: { editor: string; chrome: string; elevated: string };
  fill: { primary: string; secondary: string; tertiary: string; quaternary: string };
  stroke: { primary: string; secondary: string; tertiary: string };
  accent: { primary: string; control: string };
};
export function useCanvasState<T>(key: string, defaultValue: T): [T, (next: T | ((prev: T) => T)) => void];
export type CanvasAction =
  | { type: "openAgent"; agentId: string }
  | { type: "newComposerChat"; userPrompt?: string }
  | {
      type: "openFile";
      path: string;
      selection?: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
    };
export function useCanvasAction(): (action: CanvasAction) => void;
export function Stack(props: Loose & { children?: ReactNode; gap?: number; style?: CSSProperties }): JSX.Element;
export function Row(props: Loose & { children?: ReactNode; gap?: number; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "space-between"; wrap?: boolean; style?: CSSProperties }): JSX.Element;
export function Grid(props: Loose & { children?: ReactNode; columns: number | string; gap?: number; style?: CSSProperties }): JSX.Element;
export function Divider(props?: Loose & { style?: CSSProperties }): JSX.Element;
export function Spacer(): JSX.Element;
export function H1(props: Loose & { children?: ReactNode; style?: CSSProperties }): JSX.Element;
export function H2(props: Loose & { children?: ReactNode; style?: CSSProperties }): JSX.Element;
export function H3(props: Loose & { children?: ReactNode; style?: CSSProperties }): JSX.Element;
export function Text(props: Loose & { children?: ReactNode; tone?: "primary" | "secondary" | "tertiary" | "quaternary"; size?: "body" | "small"; as?: "p" | "span"; weight?: "normal" | "medium" | "semibold" | "bold"; style?: CSSProperties }): JSX.Element;
export function Code(props: Loose & { children?: ReactNode; style?: CSSProperties }): JSX.Element;
export function Link(props: Loose & { children?: ReactNode; href: string; style?: CSSProperties }): JSX.Element;
export function Button(props: { children?: ReactNode; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; onClick?: () => void; type?: "button" | "submit" | "reset"; title?: string; style?: CSSProperties }): JSX.Element;
export function Pill(props: Loose & { children?: ReactNode; active?: boolean; size?: "sm" | "md"; onClick?: () => void; style?: CSSProperties }): JSX.Element;
export function Card(props: Loose & { children?: ReactNode; variant?: "default" | "borderless"; size?: "base" | "lg"; style?: CSSProperties }): JSX.Element;
export function CardHeader(props: Loose & { children?: ReactNode; trailing?: ReactNode; style?: CSSProperties }): JSX.Element;
export function CardBody(props: Loose & { children?: ReactNode; style?: CSSProperties }): JSX.Element;
export function Stat(props: { value: ReactNode; label: string; tone?: "success" | "danger" | "warning" | "info"; style?: CSSProperties }): JSX.Element;
export function Callout(props: { children?: ReactNode; tone?: "info" | "success" | "warning" | "danger" | "neutral"; title?: ReactNode; style?: CSSProperties }): JSX.Element;
export function Table(props: { headers: ReactNode[]; rows: ReactNode[][]; columnAlign?: Array<"left" | "center" | "right" | undefined>; rowTone?: Array<Tone | undefined>; striped?: boolean; stickyHeader?: boolean; framed?: boolean; style?: CSSProperties; emptyMessage?: ReactNode }): JSX.Element;
export function BarChart(props: Loose & { categories: string[]; series: Array<{ name: string; data: number[]; tone?: Tone }>; stacked?: boolean; valueSuffix?: string; style?: CSSProperties }): JSX.Element;
export function LineChart(props: Loose & { categories: string[]; series: Array<{ name: string; data: number[]; tone?: Tone }>; fill?: boolean; valueSuffix?: string; style?: CSSProperties }): JSX.Element;
export function PieChart(props: Loose & { data: Array<{ label: string; value: number; tone?: Tone }>; donut?: boolean; style?: CSSProperties }): JSX.Element;
export function computeDAGLayout(nodes: unknown[], edges: unknown[], options?: Loose): Loose;
export function DiffView(props: Loose): JSX.Element;
export function DiffStats(props: Loose): JSX.Element;
export function Checkbox(props: Loose): JSX.Element;
export function IconButton(props: Loose): JSX.Element;
export function Select(props: Loose): JSX.Element;
export function TextArea(props: Loose): JSX.Element;
export function TextInput(props: Loose): JSX.Element;
export function Toggle(props: Loose): JSX.Element;
export function CollapsibleSection(props: Loose & { children?: ReactNode }): JSX.Element;
export function Swatch(props: Loose): JSX.Element;
export function UsageBar(props: Loose): JSX.Element;
export function TodoList(props: Loose): JSX.Element;
export function TodoListCard(props: Loose): JSX.Element;
export function mergeStyle(base: CSSProperties, override?: CSSProperties): CSSProperties;
`;

const FILES = new Map<string, string>([
  ["/lib.d.ts", LIB_DTS],
  ["/node_modules/react/package.json", '{"name":"react","types":"index.d.ts"}'],
  ["/node_modules/react/index.d.ts", REACT_DTS],
  ["/node_modules/react/jsx-runtime.d.ts", JSX_RUNTIME_DTS],
  [
    "/node_modules/cursor/package.json",
    '{"name":"cursor","exports":{"./canvas":{"types":"./canvas.d.ts","default":"./canvas.d.ts"}}}',
  ],
  ["/node_modules/cursor/canvas.d.ts", CANVAS_DTS],
]);

function normalize(fileName: string): string {
  const slash = fileName.replace(/\\/g, "/");
  if (FILES.has(slash)) {
    return slash;
  }
  if (slash.endsWith("/canvas.tsx")) {
    return "/canvas.tsx";
  }
  return slash;
}

/** Typecheck a canvas against `cursor/canvas`. Syntax failures stay with the compiler. */
export function typecheckCanvasSource(source: string): CanvasDiagnostic[] {
  try {
    const options: ts.CompilerOptions = {
      noLib: true,
      strict: false,
      noImplicitAny: false,
      strictNullChecks: false,
      noEmit: true,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "react",
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      allowSyntheticDefaultImports: true,
    };
    const files = new Map(FILES);
    files.set("/canvas.tsx", source);
    const host: ts.CompilerHost = {
      getSourceFile(fileName, languageVersion) {
        const text = files.get(normalize(fileName));
        if (text == null) {
          return undefined;
        }
        const key = normalize(fileName);
        const kind = key.endsWith(".tsx")
          ? ts.ScriptKind.TSX
          : key.endsWith(".json")
            ? ts.ScriptKind.JSON
            : ts.ScriptKind.TS;
        return ts.createSourceFile(fileName, text, languageVersion, true, kind);
      },
      getDefaultLibFileName: () => "/lib.d.ts",
      writeFile() {},
      getCurrentDirectory: () => "/",
      getCanonicalFileName: (fileName) => fileName,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: (fileName) => files.has(normalize(fileName)),
      readFile: (fileName) => files.get(normalize(fileName)),
      directoryExists: (dir) => {
        const name = normalize(dir).replace(/\/$/, "");
        return (
          name === "" ||
          name === "/" ||
          name === "/node_modules" ||
          name === "/node_modules/react" ||
          name === "/node_modules/cursor"
        );
      },
      getDirectories: () => [],
    };
    const program = ts.createProgram({
      rootNames: ["/lib.d.ts", "/canvas.tsx"],
      options,
      host,
    });
    const out: CanvasDiagnostic[] = [];
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      if (!diagnostic.file || !normalize(diagnostic.file.fileName).endsWith("/canvas.tsx")) {
        continue;
      }
      const position =
        diagnostic.start == null
          ? { line: 1, character: 1 }
          : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      out.push({
        line: position.line + 1,
        column: position.character + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      });
      if (out.length >= 8) {
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}
