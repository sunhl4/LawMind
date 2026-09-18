/**
 * Live “本轮按××处理” strip.
 * Local compile for instant feedback; when apiBase is set, debounce POST
 * /api/intent/compile so peeks / matterKind match runTurn.
 * Not a picker — lawyers do not choose a task type here.
 * Filename-unknown attachments are not shown as a keyword guess until server peek returns.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiSendJson } from "./api-client";
import { compileIntent } from "../../../../src/lawmind/intent/compile-intent.ts";
import { classifyDocumentGenre } from "../../../../src/lawmind/intent/document-genre.ts";
import type { CompiledIntent } from "../../../../src/lawmind/intent/types.ts";
import type { ComposeContextPin } from "../../../../src/lawmind/platform/compose-context-pin.ts";

export type LawmindIntentStatusBarProps = {
  input: string;
  fileRelPaths: string[];
  matterKind?: "contract" | "litigation" | "general";
  apiBase?: string;
  contextMatterId?: string | null;
  projectDir?: string | null;
  chatSessionId?: string;
};

function pinsFromPaths(paths: string[]): ComposeContextPin[] {
  return paths
    .map((relPath) => relPath.trim())
    .filter((relPath) => relPath.length > 0)
    .map((relPath) => ({
      pinKind: "file" as const,
      root: "project" as const,
      relPath,
      kind: "file" as const,
    }));
}

function filenameLooksNamed(paths: string[]): boolean {
  return paths.some((p) => classifyDocumentGenre(p) !== "unknown");
}

type CompileApiOk = {
  ok: true;
  compiled: CompiledIntent;
};

export function LawmindIntentStatusBar(props: LawmindIntentStatusBarProps): ReactNode {
  const [serverCompiled, setServerCompiled] = useState<CompiledIntent | null>(null);

  useEffect(() => {
    setServerCompiled(null);
  }, [props.chatSessionId]);

  const pins = useMemo(() => pinsFromPaths(props.fileRelPaths), [props.fileRelPaths.join("|")]);
  const pathsKey = props.fileRelPaths.join("|");

  const localCompiled = useMemo(
    () =>
      compileIntent({
        instruction: props.input,
        pins,
        matterKind: props.matterKind,
      }),
    [props.input, pathsKey, props.matterKind, pins],
  );

  useEffect(() => {
    const apiBase = props.apiBase?.trim();
    if (!apiBase) {
      setServerCompiled(null);
      return;
    }
    if (!props.input.trim() && props.fileRelPaths.length === 0) {
      setServerCompiled(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void apiSendJson<CompileApiOk, Record<string, unknown>>(
        apiBase,
        "/api/intent/compile",
        "POST",
        {
          instruction: props.input,
          matterId: props.contextMatterId?.trim() || undefined,
          projectDir: props.projectDir?.trim() || undefined,
          contextPins: pins,
          sessionId: props.chatSessionId?.trim() || undefined,
        },
      )
        .then((body) => {
          if (cancelled || !body.ok || !body.compiled) {
            return;
          }
          setServerCompiled(body.compiled);
        })
        .catch(() => {
          /* keep local compile */
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    props.apiBase,
    props.input,
    pathsKey,
    props.contextMatterId,
    props.projectDir,
    pins,
    props.chatSessionId,
    props.fileRelPaths.length,
  ]);

  const compiled = serverCompiled ?? localCompiled;

  if (!compiled.capabilityId) {
    return null;
  }
  if (!props.input.trim() && props.fileRelPaths.length === 0) {
    return null;
  }
  if (
    !serverCompiled &&
    props.fileRelPaths.length > 0 &&
    !filenameLooksNamed(props.fileRelPaths) &&
    compiled.source === "keyword"
  ) {
    return null;
  }

  return (
    <div className="lm-intent-status" role="status" data-testid="lm-intent-status">
      <div className="lm-intent-status-main">
        <strong>{compiled.lawyerSummary}</strong>
      </div>
    </div>
  );
}
