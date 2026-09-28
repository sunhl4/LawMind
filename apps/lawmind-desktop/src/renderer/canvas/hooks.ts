import { useCallback, useState } from "react";
import { requestOpenChatSession } from "../lawmind-open-chat-session-bus";
import { requestOpenWorkspaceFile } from "../lawmind-workspace-file-open";
import { requestCanvasComposer } from "./host-actions";
import { buildHostTokens } from "./tokens";
import { useCanvasTheme, useLawmindCanvasKind } from "./theme";

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

export type SetCanvasState<T> = (action: T | ((prev: T) => T)) => void;

/** Host theme. `text` / `bg` / `fill` / `stroke` / `accent` match the public canvas paths. */
export function useHostTheme() {
  const tokens = useCanvasTheme();
  const kind = useLawmindCanvasKind();
  const host = buildHostTokens(kind);
  return {
    kind,
    tokens,
    palette: host.palette,
    ...tokens,
  };
}

function storageKey(key: string): string {
  return `lawmind.canvas.state.${key}`;
}

type CanvasBridge = {
  storage?: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
};

function canvasBridge(): CanvasBridge | null {
  return (globalThis as { LawmindCanvas?: CanvasBridge }).LawmindCanvas ?? null;
}

function readStored(id: string): string | null {
  const storage = canvasBridge()?.storage;
  if (storage) {
    return storage.get(id);
  }
  try {
    return localStorage.getItem(id);
  } catch {
    return null;
  }
}

function writeStored(id: string, value: string): void {
  const storage = canvasBridge()?.storage;
  if (storage) {
    storage.set(id, value);
    return;
  }
  try {
    localStorage.setItem(id, value);
  } catch {
    /* ignore quota */
  }
}

/** Persists on this machine. Inside a canvas file preview, state stays in that frame. */
export function useCanvasState<T>(key: string, defaultValue: T): [T, SetCanvasState<T>] {
  const id = storageKey(key);
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = readStored(id);
      if (raw == null) {
        return defaultValue;
      }
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });
  const set = useCallback<SetCanvasState<T>>(
    (action) => {
      setValue((prev) => {
        const next = typeof action === "function" ? (action as (prev: T) => T)(prev) : action;
        writeStored(id, JSON.stringify(next));
        return next;
      });
    },
    [id],
  );
  return [value, set];
}

/**
 * `openFile` opens the path in the workbench.
 * `newComposerChat` fills the lawyer's composer.
 * `openAgent` opens a LawMind chat when `agentId` is a session id.
 * Inside the canvas iframe these only post a message; the parent window runs them.
 */
export function useCanvasAction(): (action: CanvasAction) => void {
  return useCallback((action: CanvasAction) => {
    const framed = window.parent !== window;
    if (action.type === "openFile") {
      if (framed) {
        window.parent.postMessage({ source: "lawmind-canvas", type: "openFile", path: action.path }, "*");
        return;
      }
      requestOpenWorkspaceFile(action.path);
      return;
    }
    if (action.type === "newComposerChat") {
      const prompt = action.userPrompt?.trim() ?? "";
      if (!prompt) {
        return;
      }
      if (framed) {
        window.parent.postMessage({ source: "lawmind-canvas", type: "composer", prompt }, "*");
        return;
      }
      requestCanvasComposer(prompt);
      return;
    }
    if (framed) {
      window.parent.postMessage({ source: "lawmind-canvas", type: "openAgent", agentId: action.agentId }, "*");
      return;
    }
    requestOpenChatSession({ sessionId: action.agentId, title: action.agentId });
  }, []);
}
