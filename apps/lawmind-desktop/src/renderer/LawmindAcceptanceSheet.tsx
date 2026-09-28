/**
 * 对话中栏的核对纸。结论必须带出处；采信、改弱、拿掉记在本机，不改稿子正文。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AcceptanceClaimView, AcceptanceSheet } from "../../../../src/lawmind/acceptance-sheet/model.ts";
import { tooStrongInstruction } from "../../../../src/lawmind/acceptance-sheet/model.ts";
import { CanvasHost } from "./canvas/CanvasHost";
import { acceptanceCanvasPath, renderAcceptanceCanvas } from "./canvas/acceptance-canvas";
import { Button, Callout, Card, CardBody, CardHeader, H1, H2, Pill, Row, Stack, Stat, Table, Text } from "./canvas/primitives";
import { useCanvasTheme } from "./canvas/theme";
import { LawmindAnalysisChart } from "./LawmindAnalysisChart";
import { describeFsWriteFailure } from "./file/fs-write-error";
import { requestOpenWorkspaceFile } from "./lawmind-workspace-file-open";
import { apiGetJson, apiSendJson, fetchApi, fetchWithLoopbackAuthRetry } from "./api-client";
import {
  isNativeOfficePath,
  LAWMIND_MATERIAL_CHOSEN_EVENT,
  type MaterialChosenDetail,
} from "./lawmind-material-chosen";
import { useAcceptancePaneStore } from "./stores/acceptance-pane-store";
import { readActiveWorkbenchWordFile } from "./lawmind-active-word-file";

type Props = {
  apiBase?: string;
  sessionId?: string | null;
  taskId?: string | null;
  loading: boolean;
  messageCount: number;
  onActive: (active: boolean) => void;
  onAvailable?: (available: boolean) => void;
  onOpenReview?: (target?: { taskId?: string; matterId?: string }) => void;
  onTooStrong?: (text: string) => void;
  onYieldToEditor?: () => void;
};

type SheetResponse = { ok?: boolean; sheet?: AcceptanceSheet | null };

type PagePreview = {
  relPath: string;
  page: number;
  /** Set only when the lawyer already picked this folder. Omitted when we must not guess. */
  root?: "workspace" | "project";
  /** True when the pin did not name a page, so this is the first page only. */
  firstPage: boolean;
  /** Which claim opened this page. Absent when the left rail picked the file. */
  claimId?: string;
};

type PageFailure = "missing" | "too_large" | "ambiguous";

const PAGE_FAILURE_COPY: Record<PageFailure, string> = {
  missing: "这一页打不开。可以改用本机打开。",
  too_large: "这份 PDF 太大，页图打不开。可以改用本机打开。",
  ambiguous: "工作区和本机文件夹里都有这份文件。请从左栏点开要看的那一份，或用本机打开。",
};

function ClaimQuote(props: { children: string }) {
  const theme = useCanvasTheme();
  return (
    <Text
      tone="secondary"
      size="small"
      style={{ marginTop: 10, paddingLeft: 10, borderLeft: `2px solid ${theme.stroke.secondary}` }}
    >
      {props.children}
    </Text>
  );
}

function pageForPath(sheet: AcceptanceSheet, relPath: string): number | undefined {
  for (const claim of sheet.claims) {
    for (const source of claim.sources) {
      if (source.relPath === relPath && source.page) {
        return source.page;
      }
    }
  }
  return undefined;
}

function visibleClaims(sheet: AcceptanceSheet): AcceptanceClaimView[] {
  return sheet.claims.filter((claim) => claim.mark !== "removed");
}

function previewHostClaimId(
  claims: readonly AcceptanceClaimView[],
  preview: PagePreview,
): string | undefined {
  if (preview.claimId && claims.some((claim) => claim.id === preview.claimId)) {
    return preview.claimId;
  }
  return claims.find((claim) => claim.sources.some((source) => source.relPath === preview.relPath))?.id;
}

type MaterialRoot = "workspace" | "project";

async function resolveMaterialRoot(
  apiBase: string | undefined,
  relPath: string,
): Promise<MaterialRoot | PageFailure> {
  const base = apiBase?.trim();
  if (!base) {
    return "missing";
  }
  try {
    const query = new URLSearchParams({ path: relPath });
    const { response } = await fetchWithLoopbackAuthRetry(base, (nextBase) =>
      fetchApi(`${nextBase}/api/acceptance-sheet/locate?${query}`, { cache: "no-store" }, { tag: "acceptance-locate" }),
    );
    if (!response.ok) {
      return readPageFailure(response);
    }
    const body = (await response.json()) as { root?: string };
    if (body.root === "workspace" || body.root === "project") {
      return body.root;
    }
    return "missing";
  } catch {
    return "missing";
  }
}

async function openMaterial(
  apiBase: string | undefined,
  relPath: string,
  root?: MaterialRoot,
): Promise<PageFailure | null> {
  const desk = window.lawmindDesktop;
  if (!desk?.openWithSystem) {
    return null;
  }
  let chosen = root;
  if (!chosen) {
    const resolved = await resolveMaterialRoot(apiBase, relPath);
    if (resolved !== "workspace" && resolved !== "project") {
      return resolved;
    }
    chosen = resolved;
  }
  const opened = await desk.openWithSystem({ root: chosen, path: relPath });
  if (opened && ! opened.ok) {
    return "missing";
  }
  return null;
}

async function readPageFailure(response: Response): Promise<PageFailure> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error === "pdf_too_large") {
      return "too_large";
    }
    if (body.error === "ambiguous_root") {
      return "ambiguous";
    }
  } catch {
    /* 错误体不是 JSON 时，按打不开处理。 */
  }
  return "missing";
}

function AcceptancePdfFrame(props: {
  apiBase?: string;
  preview: PagePreview;
  onOpen: () => void;
}) {
  const { apiBase, preview, onOpen } = props;
  const [src, setSrc] = useState<string | null>(null);
  const [failure, setFailure] = useState<PageFailure | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const adopt = (next: string | null) => {
      if (urlRef.current && urlRef.current !== next) {
        URL.revokeObjectURL(urlRef.current);
      }
      urlRef.current = next;
      setSrc(next);
    };
    const base = apiBase?.trim();
    if (!base) {
      adopt(null);
      setFailure("missing");
      return undefined;
    }
    let cancelled = false;
    adopt(null);
    setFailure(null);
    const query = new URLSearchParams({
      path: preview.relPath,
      page: String(preview.page),
    });
    if (preview.root) {
      query.set("root", preview.root);
    }
    void fetchWithLoopbackAuthRetry(base, (nextBase) =>
      fetchApi(`${nextBase}/api/acceptance-sheet/page?${query}`, { cache: "no-store" }, { tag: "acceptance-page" }),
    )
      .then(async ({ response }) => {
        if (!response.ok) {
          const reason = await readPageFailure(response);
          if (!cancelled) {
            setFailure(reason);
          }
          return;
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        adopt(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setFailure("missing");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, preview.page, preview.relPath, preview.root]);

  const theme = useCanvasTheme();
  const name = preview.relPath.split("/").pop() ?? preview.relPath;
  const caption = `${name} · 第 ${preview.page} 页${preview.firstPage ? "（出处未写页码，从第 1 页看起）" : ""}`;
  return (
    <figure
      data-testid="lm-acceptance-page-frame"
      aria-busy={!src && !failure ? true : undefined}
      style={{ margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 8 }}
    >
      <Text as="span" size="small" tone="tertiary">
        {caption}
      </Text>
      {failure ? <Text size="small">{PAGE_FAILURE_COPY[failure]}</Text> : null}
      {!src && !failure ? (
        <Text size="small" tone="tertiary">
          正在打开这一页。
        </Text>
      ) : null}
      {src ? (
        <img
          src={src}
          alt={`${name} 第 ${preview.page} 页`}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            border: `1px solid ${theme.stroke.secondary}`,
            borderRadius: 8,
            background: theme.bg.elevated,
          }}
        />
      ) : null}
      <Button variant="ghost" onClick={onOpen}>
        用本机打开
      </Button>
    </figure>
  );
}

export function LawmindAcceptanceSheet(props: Props) {
  const {
    apiBase,
    sessionId,
    taskId,
    loading,
    messageCount,
    onActive,
    onAvailable,
    onOpenReview,
    onTooStrong,
    onYieldToEditor,
  } = props;
  const [sheet, setSheet] = useState<AcceptanceSheet | null>(null);
  const [dismissedTaskId, setDismissedTaskId] = useState<string | null>(null);
  const [yielded, setYielded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [pagePreview, setPagePreview] = useState<PagePreview | null>(null);
  const [placed, setPlaced] = useState(false);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const activeRef = useRef(false);
  const sheetRef = useRef(sheet);
  const refreshGen = useRef(0);
  const apiBaseRef = useRef(apiBase);
  apiBaseRef.current = apiBase;
  const rootsByPath = useRef(new Map<string, MaterialRoot>());
  sheetRef.current = sheet;
  const onActiveRef = useRef(onActive);
  const onAvailableRef = useRef(onAvailable);
  const onYieldRef = useRef(onYieldToEditor);
  onActiveRef.current = onActive;
  onAvailableRef.current = onAvailable;
  onYieldRef.current = onYieldToEditor;
  const revealEditorNonce = useAcceptancePaneStore((state) => state.revealEditorNonce);
  const openSheetNonce = useAcceptancePaneStore((state) => state.openSheetNonce);
  const seenRevealNonce = useRef(revealEditorNonce);
  const seenOpenNonce = useRef(openSheetNonce);

  const refresh = useCallback(async () => {
    const gen = ++refreshGen.current;
    const base = apiBase?.trim();
    const sid = sessionId?.trim();
    if (!base || !sid) {
      setSheet(null);
      return;
    }
    const query = taskId?.trim() ? `?taskId=${encodeURIComponent(taskId.trim())}` : "";
    try {
      const body = await apiGetJson<SheetResponse>(
        base,
        `/api/sessions/${encodeURIComponent(sid)}/acceptance-sheet${query}`,
      );
      if (gen !== refreshGen.current) {
        return;
      }
      setSheet(body.sheet ?? null);
      setError(null);
    } catch {
      if (gen !== refreshGen.current) {
        return;
      }
      setSheet(null);
    }
  }, [apiBase, sessionId, taskId]);

  useEffect(() => {
    if (loading) {
      return;
    }
    void refresh();
  }, [loading, messageCount, refresh]);

  const showing = Boolean(
    sheet?.open && sheet.taskId !== dismissedTaskId && !yielded,
  );
  activeRef.current = showing;

  const available = Boolean(sheet?.open);

  useEffect(() => {
    onActiveRef.current(showing);
  }, [showing]);

  useEffect(() => {
    onAvailableRef.current?.(available);
  }, [available]);

  useEffect(() => {
    if (revealEditorNonce === seenRevealNonce.current) {
      return;
    }
    seenRevealNonce.current = revealEditorNonce;
    if (activeRef.current) {
      setYielded(true);
    }
  }, [revealEditorNonce]);

  useEffect(() => {
    if (openSheetNonce === seenOpenNonce.current) {
      return;
    }
    seenOpenNonce.current = openSheetNonce;
    setDismissedTaskId(null);
    setYielded(false);
  }, [openSheetNonce]);

  useEffect(() => {
    const onMaterial = (event: Event) => {
      if (!activeRef.current) {
        return;
      }
      const detail = (event as CustomEvent<MaterialChosenDetail>).detail;
      if (!detail?.relPath) {
        return;
      }
      rootsByPath.current.set(detail.relPath, detail.root);
      if (detail.relPath.toLowerCase().endsWith(".pdf")) {
        const current = sheetRef.current;
        const named = current ? pageForPath(current, detail.relPath) : undefined;
        setFocusPath(detail.relPath);
        setPagePreview({
          relPath: detail.relPath,
          page: named ?? 1,
          root: detail.root,
          firstPage: named == null,
        });
        return;
      }
      if (/\.docx$/i.test(detail.relPath)) {
        setYielded(true);
        onYieldRef.current?.();
        return;
      }
      if (isNativeOfficePath(detail.relPath)) {
        setFocusPath(detail.relPath);
        void openMaterial(apiBaseRef.current, detail.relPath, detail.root).then((failure) => {
          if (failure) {
            setError(PAGE_FAILURE_COPY[failure]);
          }
        });
        return;
      }
      setYielded(true);
      onYieldRef.current?.();
    };
    window.addEventListener(LAWMIND_MATERIAL_CHOSEN_EVENT, onMaterial);
    return () => window.removeEventListener(LAWMIND_MATERIAL_CHOSEN_EVENT, onMaterial);
  }, []);

  const seenMessages = useRef(messageCount);
  useEffect(() => {
    if (messageCount === seenMessages.current) {
      return;
    }
    seenMessages.current = messageCount;
    setDismissedTaskId(null);
    if (readActiveWorkbenchWordFile()) {
      setYielded(true);
      return;
    }
    setYielded(false);
  }, [messageCount]);

  useEffect(() => {
    if (sheet && dismissedTaskId && sheet.taskId !== dismissedTaskId) {
      setDismissedTaskId(null);
      setYielded(false);
    }
  }, [dismissedTaskId, sheet]);

  const post = useCallback(
    async (
      body: { claimId: string; mark: AcceptanceClaimView["mark"] } | { restoreRemoved: true },
    ): Promise<boolean> => {
      const base = apiBase?.trim();
      const id = sheet?.taskId;
      if (!base || !id) {
        return false;
      }
      const gen = refreshGen.current;
      setBusyId("claimId" in body ? body.claimId : "restore");
      setError(null);
      try {
        const next = await apiSendJson<SheetResponse>(
          base,
          `/api/drafts/${encodeURIComponent(id)}/acceptance-sheet`,
          "POST",
          body,
        );
        if (gen !== refreshGen.current) {
          return false;
        }
        setSheet(
          next.sheet
            ? {
                ...next.sheet,
                charts: next.sheet.charts ?? (sheet?.taskId === next.sheet.taskId ? sheet?.charts : undefined),
              }
            : null,
        );
        return true;
      } catch {
        setError("没记下。请再试一次。");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [apiBase, sheet?.taskId],
  );

  const revealFile = (relPath: string, root?: MaterialRoot) => {
    void openMaterial(apiBase, relPath, root).then((failure) => {
      if (failure) {
        setError(PAGE_FAILURE_COPY[failure]);
      }
    });
  };

  const openAcceptanceCanvas = async () => {
    if (!sheet) {
      return;
    }
    const path = acceptanceCanvasPath(sheet.taskId);
    if (!path) {
      setError("这份核对没有可用的编号，画布没写成。");
      return;
    }
    setCanvasBusy(true);
    try {
      const res = await window.lawmindDesktop?.fsWrite({
        root: "workspace",
        path,
        content: renderAcceptanceCanvas(sheet),
      });
      if (!res?.ok) {
        setError(describeFsWriteFailure(res));
        return;
      }
      setYielded(true);
      onYieldToEditor?.();
      requestOpenWorkspaceFile(path, "workspace");
    } finally {
      setCanvasBusy(false);
    }
  };

  if (!showing || !sheet) {
    return null;
  }

  const claims = visibleClaims(sheet);
  const gapCount = sheet.gaps.length + sheet.risks.length;
  const pageHostId = pagePreview ? previewHostClaimId(claims, pagePreview) : undefined;

  return (
    <CanvasHost
      className="lm-scroll"
      aria-label="核对"
      aria-busy={busyId !== null}
      data-testid="lm-acceptance-sheet"
    >
      <Stack gap={16}>
        <Row align="start" justify="space-between" gap={16} wrap>
          <Stack gap={8}>
            <Text size="small" tone="tertiary">
              核对
            </Text>
            <H1>{sheet.title}</H1>
            <Row gap={20} wrap>
              <Stat value={claims.length} label="可核对" />
              {gapCount > 0 ? <Stat value={gapCount} label="还没站稳" tone="warning" /> : null}
              {sheet.removedCount > 0 ? <Stat value={sheet.removedCount} label="已拿掉" /> : null}
            </Row>
          </Stack>
          <Row gap={8} align="center" wrap>
            {sheet.hasDraft && onOpenReview ? (
              <Button
                variant="primary"
                data-testid="lm-acceptance-review"
                onClick={() => {
                  setDismissedTaskId(sheet.taskId);
                  onOpenReview({ taskId: sheet.taskId, matterId: sheet.matterId });
                }}
              >
                看修订
              </Button>
            ) : null}
            {onYieldToEditor ? (
              <Button
                variant="secondary"
                data-testid="lm-acceptance-canvas"
                disabled={canvasBusy}
                onClick={() => void openAcceptanceCanvas()}
              >
                画布
              </Button>
            ) : null}
            {onYieldToEditor ? (
              <Button
                variant="ghost"
                data-testid="lm-acceptance-files"
                onClick={() => {
                  setYielded(true);
                  onYieldToEditor?.();
                }}
              >
                看文件
              </Button>
            ) : null}
            <Button variant="ghost" data-testid="lm-acceptance-close" onClick={() => setDismissedTaskId(sheet.taskId)}>
              关闭
            </Button>
          </Row>
        </Row>

        {sheet.summary ? (
          <Callout tone="neutral" title="导语，还不能逐句采信。">
            {sheet.summary}
          </Callout>
        ) : null}
        {pagePreview && !pageHostId ? (
          <AcceptancePdfFrame
            apiBase={apiBase}
            preview={pagePreview}
            onOpen={() => revealFile(pagePreview.relPath, pagePreview.root)}
          />
        ) : null}
        {error ? (
          <Callout tone="danger" title="没记下">
            <span role="alert">{error}</span>
          </Callout>
        ) : null}
        {placed ? <Text size="small" tone="secondary">已放到输入框，改完再发送。</Text> : null}

        {claims.length > 0 ? (
          <Stack gap={16}>
            {claims.map((claim) => (
              <Card key={claim.id}>
                <CardHeader
                  trailing={
                    claim.mark === "accepted" ? (
                      <Pill active size="sm">
                        已采信
                      </Pill>
                    ) : claim.mark === "too_strong" ? (
                      <Pill size="sm">已退回改弱</Pill>
                    ) : null
                  }
                >
                  {claim.locator || "结论"}
                </CardHeader>
                <CardBody>
                  <div data-testid="lm-acceptance-claim">
                    <Text>{claim.text}</Text>
                    <Row gap={8} wrap style={{ marginTop: 8 }}>
                      {claim.confidenceLabel ? (
                        <Text as="span" size="small" tone="tertiary">
                          把握{claim.confidenceLabel}
                        </Text>
                      ) : null}
                      {claim.demo ? (
                        <Text as="span" size="small" tone="tertiary">
                          演示语料
                        </Text>
                      ) : null}
                    </Row>
                    {claim.quote ? <ClaimQuote>{claim.quote}</ClaimQuote> : null}
                    <Stack gap={6} style={{ marginTop: 10 }}>
                      {claim.sources.map((source) => {
                        const relPath = source.relPath;
                        const focused = Boolean(focusPath && relPath && focusPath === relPath);
                        const knownRoot = relPath ? rootsByPath.current.get(relPath) : undefined;
                        return (
                          <Row key={source.id} gap={8} align="center" wrap>
                            <Text as="span" size="small" tone={focused ? "primary" : "tertiary"}>
                              {source.citation || source.title}
                            </Text>
                            {source.pageLabel ? (
                              <Text as="span" size="small" tone="quaternary">
                                {source.pageLabel}
                              </Text>
                            ) : null}
                            {relPath && source.openKind === "pdf" ? (
                              <Button
                                variant="ghost"
                                data-testid="lm-acceptance-page"
                                onClick={() =>
                                  setPagePreview({
                                    relPath,
                                    page: source.page ?? 1,
                                    root: knownRoot,
                                    firstPage: source.page == null,
                                    claimId: claim.id,
                                  })
                                }
                              >
                                看这一页
                              </Button>
                            ) : null}
                            {relPath && source.openKind !== "citation" ? (
                              <Button variant="ghost" onClick={() => revealFile(relPath, knownRoot)}>
                                {source.openKind === "word" ? "用 Word 打开" : "用本机打开"}
                              </Button>
                            ) : null}
                          </Row>
                        );
                      })}
                    </Stack>
                    <Row gap={8} wrap style={{ marginTop: 12 }}>
                      <Button
                        aria-pressed={claim.mark === "accepted"}
                        disabled={busyId === claim.id}
                        data-testid="lm-acceptance-accept"
                        onClick={() =>
                          void post({
                            claimId: claim.id,
                            mark: claim.mark === "accepted" ? null : "accepted",
                          })
                        }
                      >
                        {claim.mark === "accepted" ? "撤销采信" : "采信"}
                      </Button>
                      <Button
                        disabled={busyId === claim.id || claim.mark === "too_strong"}
                        title="记下这句，并把改弱要求放进对话框，由你发送"
                        data-testid="lm-acceptance-weaken"
                        onClick={() => {
                          void (async () => {
                            const ok = await post({ claimId: claim.id, mark: "too_strong" });
                            if (ok) {
                              onTooStrong?.(tooStrongInstruction(claim));
                              if (onTooStrong) {
                                setPlaced(true);
                              }
                            }
                          })();
                        }}
                      >
                        这句太满
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busyId === claim.id}
                        data-testid="lm-acceptance-remove"
                        onClick={() => void post({ claimId: claim.id, mark: "removed" })}
                      >
                        拿掉
                      </Button>
                    </Row>
                    {pageHostId === claim.id && pagePreview ? (
                      <AcceptancePdfFrame
                        apiBase={apiBase}
                        preview={pagePreview}
                        onOpen={() => revealFile(pagePreview.relPath, pagePreview.root)}
                      />
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            ))}
          </Stack>
        ) : sheet.removedCount > 0 ? (
          <Text tone="secondary">可核对的句子都已拿掉。</Text>
        ) : gapCount === 0 && !sheet.table && (sheet.charts?.length ?? 0) === 0 ? (
          <Text tone="secondary">这轮没有能挂上出处的结论。</Text>
        ) : null}

        {sheet.removedCount > 0 ? (
          <Button variant="ghost" onClick={() => void post({ restoreRemoved: true })}>
            放回拿掉的 {sheet.removedCount} 条
          </Button>
        ) : null}

        {sheet.gaps.length > 0 || sheet.risks.length > 0 ? (
          <Stack gap={8}>
            <H2>还没站稳</H2>
            <Callout tone="warning">
              <Stack gap={4}>
                {sheet.gaps.map((gap) => (
                  <Text key={gap.id} size="small" tone="secondary">
                    {gap.text}
                  </Text>
                ))}
                {sheet.risks.map((risk) => (
                  <Text key={risk} size="small" tone="secondary">
                    {risk}
                  </Text>
                ))}
              </Stack>
            </Callout>
          </Stack>
        ) : null}

        {sheet.table ? (
          <Stack gap={8}>
            <H2>{sheet.table.title}</H2>
            <div className="lm-scroll" aria-label={sheet.table.title}>
              <Table
                striped
                stickyHeader
                headers={[...sheet.table.columns.map((column) => column.label), "出处"]}
                rowTone={sheet.table.rows.map((row) => (row.sourced ? undefined : "danger"))}
                rows={sheet.table.rows.map((row) => [
                  ...sheet.table!.columns.map((column) => row.cells[column.key] ?? ""),
                  row.sourceLabel,
                ])}
              />
            </div>
          </Stack>
        ) : null}

        {sheet.charts?.map((chart) => (
          <Stack key={chart.id} gap={8}>
            <div className="lm-acceptance-chart" aria-label={chart.title}>
              <LawmindAnalysisChart specText={chart.specText} />
            </div>
            <Text size="small" tone="tertiary">
              只读。要改数字，改表格后再出图。
            </Text>
          </Stack>
        ))}

        <Text size="small" tone="tertiary">
          改字在中间栏，签批在在办。这里只记下你认不认这句。
        </Text>
      </Stack>
    </CanvasHost>
  );
}
