import { useEffect, useMemo, useRef, useState } from "react";
import sandboxRuntime from "./sandbox-runtime.js?raw";
import { requestOpenChatSession } from "../lawmind-open-chat-session-bus";
import { requestOpenWorkspaceFile } from "../lawmind-workspace-file-open";
import {
  canvasDataPath,
  canvasFileStateKey,
  canvasHtmlPath,
  compileCanvasSource,
  type CanvasDiagnostic,
} from "./compile-canvas";
import {
  LAWMIND_CANVAS_EXPORT_EVENT,
  LAWMIND_CANVAS_EXPORT_RESULT_EVENT,
  openLawyerHref,
  requestCanvasComposer,
  type CanvasExportDetail,
  type CanvasExportResultDetail,
} from "./host-actions";
import { workspacePathTarget } from "../../../../../src/lawmind/sources/lawyer-chat-link.ts";
import { describeFsWriteFailure } from "../file/fs-write-error";

type Props = {
  root: string;
  path: string;
  source: string;
};

function readFileState(root: string, path: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(canvasFileStateKey(root, path));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeFileState(root: string, path: string, key: string, value: string): Record<string, string> {
  const current = readFileState(root, path);
  current[key] = value;
  try {
    localStorage.setItem(canvasFileStateKey(root, path), JSON.stringify(current));
  } catch {
    /* ignore quota */
  }
  return current;
}

function parseStateRecord(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return null;
  }
}

export function CanvasFileView({ root, path, source }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [debounced, setDebounced] = useState(source);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(source), 200);
    return () => window.clearTimeout(timer);
  }, [source]);

  const compiled = useMemo(() => compileCanvasSource(debounced), [debounced]);
  const [typeDiagnostics, setTypeDiagnostics] = useState<CanvasDiagnostic[]>([]);
  const [typedFor, setTypedFor] = useState("");
  useEffect(() => {
    let cancelled = false;
    void import("./typecheck-canvas")
      .then((mod) => {
        if (cancelled) {
          return;
        }
        setTypeDiagnostics(mod.typecheckCanvasSource(debounced));
        setTypedFor(debounced);
      })
      .catch(() => {
        if (!cancelled) {
          setTypeDiagnostics([]);
          setTypedFor(debounced);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);
  const typeReady = typedFor === debounced;
  const typeErrors = typeReady ? typeDiagnostics : [];
  const stateIdentity = `${root}:${path}`;
  const [fileState, setFileState] = useState(() => readFileState(root, path));
  const [loadedFor, setLoadedFor] = useState(stateIdentity);
  if (loadedFor !== stateIdentity) {
    setLoadedFor(stateIdentity);
    setFileState(readFileState(root, path));
  }
  useEffect(() => {
    const dataPath = canvasDataPath(path);
    if (!dataPath || (root !== "workspace" && root !== "project")) {
      return undefined;
    }
    let cancelled = false;
    void window.lawmindDesktop?.fsRead({ root, path: dataPath }).then((res) => {
      if (cancelled || !res?.ok || typeof res.content !== "string") {
        return;
      }
      const parsed = parseStateRecord(res.content);
      if (!parsed) {
        return;
      }
      setFileState(parsed);
      try {
        localStorage.setItem(canvasFileStateKey(root, path), JSON.stringify(parsed));
      } catch {
        /* ignore quota */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, root]);
  const dark = document.documentElement.classList.contains("lm-theme-dark");
  const srcDoc = useMemo(() => {
    if (!compiled.ok) {
      return "";
    }
    const state = JSON.stringify(fileState).replaceAll("<", "\\u003c");
    const runtime = sandboxRuntime.replaceAll("</script", "<\\/script");
    const script = compiled.script.replaceAll("</script", "<\\/script");
    const pageBg = dark ? "#181818" : "#FCFCFC";
    const pageFg = dark ? "#E4E4E4" : "#141414";
    return `<!doctype html><html class="${dark ? "lm-theme-dark" : ""}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>html,body{height:100%;margin:0}body{background:${pageBg};color:${pageFg};font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#root{box-sizing:border-box;min-height:100%;padding:24px 28px 36px;overflow:auto}</style></head><body><div id="root"></div><script>${runtime}</script><script>Object.assign(LawmindCanvas.storage.mem, ${state});</script><script>${script}</script></body></html>`;
  }, [compiled, dark, fileState, path, root]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) {
        return;
      }
      const data = event.data as {
        source?: string;
        type?: string;
        key?: string;
        value?: string;
        path?: string;
        href?: string;
        line?: number;
        column?: number;
        prompt?: string;
        agentId?: string;
      };
      if (data?.source !== "lawmind-canvas") {
        return;
      }
      if (data.type === "state" && data.key && typeof data.value === "string") {
        const next = writeFileState(root, path, data.key, data.value);
        const dataPath = canvasDataPath(path);
        if (dataPath && (root === "workspace" || root === "project")) {
          void window.lawmindDesktop?.fsWrite({
            root,
            path: dataPath,
            content: `${JSON.stringify(next, null, 2)}\n`,
          });
        }
      }
      if (data.type === "openFile" && typeof data.path === "string") {
        const target = workspacePathTarget(data.path);
        const path = target?.path;
        if (path) {
          const line = typeof data.line === "number" ? data.line : target?.line;
          const column = typeof data.column === "number" ? data.column : target?.column;
          const fileRoot = root === "project" ? "project" : "workspace";
          requestOpenWorkspaceFile(path, fileRoot, {
            ...(line ? { line } : {}),
            ...(column ? { column } : {}),
          });
        }
      }
      if (data.type === "openHref" && typeof data.href === "string") {
        openLawyerHref(data.href, root === "project" ? "project" : "workspace");
      }
      if (data.type === "composer" && typeof data.prompt === "string") {
        requestCanvasComposer(data.prompt, { root, path });
      }
      if (data.type === "openAgent" && typeof data.agentId === "string") {
        requestOpenChatSession({ sessionId: data.agentId, title: data.agentId });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [path, root]);

  useEffect(() => {
    const onExport = (event: Event) => {
      const detail = (event as CustomEvent<CanvasExportDetail>).detail;
      if (!detail || detail.root !== root || detail.path !== path) {
        return;
      }
      const htmlPath = canvasHtmlPath(path);
      const publish = (result: CanvasExportResultDetail) => {
        window.dispatchEvent(
          new CustomEvent<CanvasExportResultDetail>(LAWMIND_CANVAS_EXPORT_RESULT_EVENT, { detail: result }),
        );
      };
      if (!htmlPath || !compiled.ok || (root !== "workspace" && root !== "project")) {
        publish({ root, path, ok: false, message: "这份画布还不能导出。" });
        return;
      }
      void window.lawmindDesktop?.fsWrite({ root, path: htmlPath, content: srcDoc }).then((res) => {
        if (!res?.ok) {
          publish({ root, path, ok: false, message: describeFsWriteFailure(res) });
          return;
        }
        publish({ root, path, ok: true, htmlPath, message: htmlPath });
      });
    };
    window.addEventListener(LAWMIND_CANVAS_EXPORT_EVENT, onExport);
    return () => window.removeEventListener(LAWMIND_CANVAS_EXPORT_EVENT, onExport);
  }, [compiled, path, root, srcDoc]);

  const checkDiagnostics = !compiled.ok ? compiled.diagnostics : typeErrors;
  if (checkDiagnostics.length > 0) {
    return (
      <div style={{ padding: 16, color: "var(--text)", fontSize: 13, lineHeight: 1.5 }} role="alert">
        <div style={{ fontWeight: 590, marginBottom: 8 }}>Canvas check</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {checkDiagnostics.map((item) => (
            <li key={`${item.line}:${item.column}:${item.message}`}>
              {item.line}:{item.column} {item.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      title={path}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ flex: "1 1 auto", width: "100%", minHeight: 0, border: "none", background: "transparent" }}
    />
  );
}
