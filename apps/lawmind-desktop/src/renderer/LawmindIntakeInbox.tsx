/**
 * 工作台 · 待归案：统一收件里还没归案的来件。
 *
 * 只做事、不新建页面：列表按收到时间排，点开在下面出详情（原文 / 附件 / 候选 / 线索），
 * 归案、忽略、进入收案都在这里完成。空的时候整块不出现，不占工作台版面。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IntakeItem } from "../../../../src/lawmind/intake/types.ts";
import { apiGetJson, apiSendJson, errorMessage, fetchApi, fetchWithLoopbackAuthRetry } from "./api-client";
import { intakeAttachmentPreviewKind } from "./lawmind-intake-attachment";
import type { LawmindIntakeAttachmentPreview } from "./LawmindIntakeDetail";
import {
  matchingEvalLine,
  type MatchingEvalSummary,
} from "./lawmind-intake-eval-copy";
import {
  LawmindIntakeDetail,
  type LawmindIntakeLeadAction,
} from "./LawmindIntakeDetail";

const AUDIO_EXT = new Set([
  ".mp3",
  ".m4a",
  ".wav",
  ".aac",
  ".amr",
  ".flac",
  ".opus",
  ".wma",
  ".webm",
  ".ogg",
]);

export type LawmindIntakeInboxProps = {
  apiBase: string;
  /** 可归入的在办案件。 */
  matterChoices: string[];
  matterLabelById?: Record<string, string>;
  /** 归案 / 收到新案后通知外层刷新（案件与新来件都会变）。 */
  onChanged?: () => void;
  /** 归案回执里的「打开案件」；缺省时不渲染按钮。 */
  onOpenMatter?: (matterId: string) => void;
  /** 轮询间隔；缺省 30 秒。传 0 关闭（测试用）。 */
  pollMs?: number;
};

type FilingReceipt = {
  matterId: string;
  label: string;
  files: string[];
};

type IntakeDetail = IntakeItem & { text: string };

const LEAD_SUBTITLE: Record<string, string> = {
  new: "新案线索 · 待判断",
  needs_info: "新案线索 · 待补资料",
  conflict_pending: "新案线索 · 待冲突检查",
};

function rowSubtitle(item: IntakeItem): string {
  const lead = item.lead?.stage;
  if (lead && LEAD_SUBTITLE[lead]) {
    return LEAD_SUBTITLE[lead];
  }
  return item.resolution?.decision === "propose" ? "待确认归入哪个案件" : "待处理收件";
}

function senderLine(item: IntakeItem): string {
  const display = item.from?.display?.trim();
  const address = item.from?.address?.trim();
  if (display && address && !display.includes(address)) {
    return `${display} · ${address}`;
  }
  return display || address || "未知发件人";
}

export function LawmindIntakeInbox(props: LawmindIntakeInboxProps): ReactNode {
  const { apiBase, matterChoices, matterLabelById = {}, onChanged, onOpenMatter, pollMs = 30_000 } = props;
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filingReceipt, setFilingReceipt] = useState<FilingReceipt | null>(null);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IntakeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [matterId, setMatterId] = useState("");
  const [rememberSender, setRememberSender] = useState(false);
  const [leadTitle, setLeadTitle] = useState("");
  const [overviewMatterIds, setOverviewMatterIds] = useState<string[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeNote, setTranscribeNote] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [partyChoices, setPartyChoices] = useState<Array<{ partyId: string; name: string }>>([]);
  const [matchingEval, setMatchingEval] = useState<MatchingEvalSummary | null>(null);

  const audioSource = useMemo(() => {
    if (!detail) {
      return null;
    }
    const attachment = detail.attachments.find((row) => {
      if (!row.sha256) {
        return false;
      }
      const dot = row.name.toLowerCase().lastIndexOf(".");
      return dot > 0 && AUDIO_EXT.has(row.name.toLowerCase().slice(dot));
    });
    return attachment?.sha256 ? { id: detail.id, sha: attachment.sha256 } : null;
  }, [detail]);
  const audioId = audioSource?.id ?? null;
  const audioSha = audioSource?.sha ?? null;

  useEffect(() => {
    setAudioUrl(null);
    if (!audioId || !audioSha) {
      return () => {};
    }
    let cancelled = false;
    let created: string | null = null;
    void (async () => {
      try {
        // <audio> 不能自带 Authorization；先用带鉴权的 fetch 取回 blob。
        const { response } = await fetchWithLoopbackAuthRetry(apiBase, (base) =>
          fetchApi(
            `${base}/api/intake/items/${encodeURIComponent(audioId)}/audio`,
            {},
            { tag: "intakeAudio" },
          ),
        );
        if (!response.ok) {
          return;
        }
        const blob = await response.blob();
        if (cancelled) {
          return;
        }
        created = URL.createObjectURL(blob);
        setAudioUrl(created);
      } catch {
        // 播放失败不挡归案；分段和文字仍可见。
      }
    })();
    return () => {
      cancelled = true;
      if (created) {
        URL.revokeObjectURL(created);
      }
    };
  }, [apiBase, audioId, audioSha]);

  // 附件预览：按条目里登记的下标取原件，带鉴权取回 blob 后再交给 <img>/<iframe>。
  const [previewAttachment, setPreviewAttachment] =
    useState<LawmindIntakeAttachmentPreview | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewSeqRef = useRef(0);

  const dropPreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const closeAttachmentPreview = useCallback(() => {
    previewSeqRef.current += 1;
    dropPreviewUrl();
    setPreviewAttachment(null);
  }, [dropPreviewUrl]);

  useEffect(() => {
    closeAttachmentPreview();
  }, [selectedId, closeAttachmentPreview]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    },
    [],
  );

  const openAttachmentPreview = useCallback(
    async (index: number) => {
      const id = detail?.id;
      const attachment = detail?.attachments[index];
      if (!id || !attachment) {
        return;
      }
      const kind = intakeAttachmentPreviewKind(attachment.name);
      const seq = previewSeqRef.current + 1;
      previewSeqRef.current = seq;
      dropPreviewUrl();
      setPreviewAttachment({ index, name: attachment.name, kind, url: null, text: null, error: null });
      try {
        const { response } = await fetchWithLoopbackAuthRetry(apiBase, (base) =>
          fetchApi(
            `${base}/api/intake/items/${encodeURIComponent(id)}/attachments/${index}`,
            {},
            { tag: "intakeAttachment" },
          ),
        );
        if (previewSeqRef.current !== seq) {
          return;
        }
        if (!response.ok) {
          setPreviewAttachment((current) =>
            current && current.index === index
              ? { ...current, error: "没能读取附件原件。" }
              : current,
          );
          return;
        }
        const blob = await response.blob();
        if (previewSeqRef.current !== seq) {
          return;
        }
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        if (kind === "text") {
          const tooBig = blob.size > 256 * 1024;
          const text = tooBig ? null : await blob.text();
          if (previewSeqRef.current !== seq) {
            URL.revokeObjectURL(url);
            previewUrlRef.current = null;
            return;
          }
          setPreviewAttachment((current) =>
            current && current.index === index
              ? {
                  ...current,
                  url,
                  text,
                  error: tooBig ? "文本超过 256 KB，只能下载原件。" : null,
                }
              : current,
          );
          return;
        }
        setPreviewAttachment((current) =>
          current && current.index === index ? { ...current, url } : current,
        );
      } catch (e) {
        if (previewSeqRef.current !== seq) {
          return;
        }
        setPreviewAttachment((current) =>
          current && current.index === index
            ? { ...current, error: errorMessage(e, "没能读取附件原件。") }
            : current,
        );
      }
    },
    [apiBase, detail, dropPreviewUrl],
  );

  useEffect(() => {
    let cancelled = false;
    setPartyChoices([]);
    const matter = matterId.trim();
    if (!matter) {
      return () => {};
    }
    void apiGetJson<{ ok?: boolean; parties?: Array<{ partyId: string; name: string }> }>(
      apiBase,
      `/api/intake/matter-parties?matterId=${encodeURIComponent(matter)}`,
    )
      .then((payload) => {
        if (!cancelled && payload.parties) {
          setPartyChoices(payload.parties);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPartyChoices([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId]);

  const loadList = useCallback(async () => {
    try {
      const [payload, overviews] = await Promise.all([
        apiGetJson<{ ok?: boolean; items?: IntakeItem[] }>(
          apiBase,
          "/api/intake/items?status=pending&limit=50",
        ),
        // 可归入的案件以全工作区概览为准：工作台列表会按门类筛选，不能当作全集。
        apiGetJson<{ ok?: boolean; overviews?: Array<{ matterId?: string }> }>(
          apiBase,
          "/api/matters/overviews",
        ).catch(() => null),
      ]);
      const next = payload.items ?? [];
      setItems(next);
      setOverviewMatterIds(
        (overviews?.overviews ?? [])
          .map((row) => row.matterId?.trim() ?? "")
          .filter(Boolean),
      );
      setError(null);
      setSelectedId((current) => {
        if (current && next.some((row) => row.id === current)) {
          return current;
        }
        return next[0]?.id ?? null;
      });
    } catch (e) {
      setError(errorMessage(e, "无法读取待归案来件"));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadList();
    if (!pollMs) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void loadList();
      }
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [loadList, pollMs]);

  const refreshMatchingEval = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    try {
      const payload = await apiGetJson<{ ok?: boolean; report?: MatchingEvalSummary }>(
        apiBase,
        "/api/intake/matching-eval",
      );
      setMatchingEval(payload.report ?? null);
    } catch {
      // 评测只是提示；读不到就静默，不挡归案。
      setMatchingEval(null);
    }
  }, [apiBase]);

  useEffect(() => {
    void refreshMatchingEval();
  }, [refreshMatchingEval]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMatterId("");
      setRememberSender(false);
      setLeadTitle("");
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    setRememberSender(false);
    setLeadTitle("");
    setTranscribeNote(null);
    void apiGetJson<{ ok?: boolean; item?: IntakeDetail }>(
      apiBase,
      `/api/intake/items/${encodeURIComponent(selectedId)}`,
    )
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const next = payload.item ?? null;
        setDetail(next);
        setMatterId(next?.resolution?.candidates?.[0]?.matterId ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, selectedId]);

  /** 动作完成后重新读列表与详情：归案/忽略会让条目离开，其余只更新阶段。 */
  const afterAction = useCallback(async () => {
    await loadList();
    void refreshMatchingEval();
    onChanged?.();
    if (selectedId) {
      try {
        const payload = await apiGetJson<{ ok?: boolean; item?: IntakeDetail }>(
          apiBase,
          `/api/intake/items/${encodeURIComponent(selectedId)}`,
        );
        setDetail(payload.item ?? null);
      } catch {
        setDetail(null);
      }
    }
  }, [apiBase, loadList, onChanged, refreshMatchingEval, selectedId]);

  const runAction = useCallback(
    async (run: () => Promise<void>, fallback: string) => {
      if (busy) {
        return;
      }
      setBusy(true);
      setError(null);
      setAttachNote(null);
      setFilingReceipt(null);
      try {
        await run();
        await afterAction();
      } catch (e) {
        setError(errorMessage(e, fallback));
      } finally {
        setBusy(false);
      }
    },
    [afterAction, busy],
  );

  const transcribe = useCallback(async () => {
    const id = detail?.id;
    if (!id || transcribing) {
      return;
    }
    setTranscribing(true);
    setTranscribeNote(null);
    try {
      const force = (detail?.text ?? "").trim().length > 0;
      const payload = await apiSendJson<{
        ok?: boolean;
        reason?: string;
        chars?: number;
        via?: string;
      }>(
        apiBase,
        `/api/intake/items/${encodeURIComponent(id)}/transcribe${force ? "?force=1" : ""}`,
        "POST",
        {},
      );
      if (payload.ok) {
        setTranscribeNote(
          `已转写 ${payload.chars ?? 0} 字（经 ${payload.via ?? "配置端点"}）。音频原件仍在`,
        );
      } else if (payload.reason === "no_config") {
        setTranscribeNote("还没有配置转写服务：设置 → 环境变量里填 LAWMIND_ASR_ENDPOINT 后再试。");
      } else if (payload.reason === "offline") {
        setTranscribeNote("当前出站模式是离线；只有本机转写服务可用。");
      } else if (payload.reason === "too_large") {
        setTranscribeNote("这条录音超过转写上限，没有出站。");
      } else if (payload.reason === "endpoint_failed" || payload.reason === "empty_transcript") {
        setTranscribeNote("转写服务没有返回可用文字，音频原件未受影响。");
      }
      const refreshed = await apiGetJson<{ ok?: boolean; item?: IntakeDetail }>(
        apiBase,
        `/api/intake/items/${encodeURIComponent(id)}`,
      ).catch(() => null);
      if (refreshed?.item) {
        setDetail(refreshed.item);
      }
    } catch (e) {
      setTranscribeNote(errorMessage(e, "转写失败"));
    } finally {
      setTranscribing(false);
    }
  }, [apiBase, detail?.id, detail?.text, transcribing]);

  const labelSpeaker = useCallback(
    async (speaker: string, label: string) => {
      const id = detail?.id;
      if (!id) {
        return;
      }
      try {
        const payload = await apiSendJson<{
          ok?: boolean;
          item?: IntakeDetail;
          reason?: string;
        }>(apiBase, `/api/intake/items/${encodeURIComponent(id)}/speakers`, "POST", {
          speaker,
          label,
        });
        if (payload.item) {
          setDetail(payload.item);
        } else if (payload.reason) {
          setError(`说话人映射没有保存：${payload.reason}`);
        }
      } catch (e) {
        setError(errorMessage(e, "说话人映射没有保存"));
      }
    },
    [apiBase, detail?.id],
  );

  const mapSpeakerParty = useCallback(
    async (speaker: string, partyId: string) => {
      const id = detail?.id;
      const matter = matterId.trim();
      if (!id || !matter) {
        return;
      }
      try {
        const payload = await apiSendJson<{
          ok?: boolean;
          item?: IntakeDetail;
          reason?: string;
        }>(apiBase, `/api/intake/items/${encodeURIComponent(id)}/speaker-parties`, "POST", {
          speaker,
          matterId: matter,
          partyId,
        });
        if (payload.item) {
          setDetail(payload.item);
        } else if (payload.reason) {
          setError(`说话人映射没有保存：${payload.reason}`);
        }
      } catch (e) {
        setError(errorMessage(e, "说话人映射没有保存"));
      }
    },
    [apiBase, detail?.id, matterId],
  );

  const editSegment = useCallback(
    async (index: number, text: string) => {
      const id = detail?.id;
      if (!id) {
        return;
      }
      try {
        const payload = await apiSendJson<{
          ok?: boolean;
          item?: IntakeDetail;
          reason?: string;
        }>(apiBase, `/api/intake/items/${encodeURIComponent(id)}/transcript-segments`, "POST", {
          index,
          text,
        });
        if (payload.item) {
          setDetail(payload.item);
        } else if (payload.reason) {
          setError(`转写没有保存：${payload.reason}`);
        }
      } catch (e) {
        setError(errorMessage(e, "转写没有保存"));
      }
    },
    [apiBase, detail?.id],
  );

  const attach = useCallback(() => {
    const id = detail?.id;
    const target = matterId.trim();
    if (!id) {
      return;
    }
    if (!target) {
      setError("先选一个要归入的案件。");
      return;
    }
    void runAction(
      async () => {
        const result = await apiSendJson<{
          rememberedSender?: boolean;
          rememberSkippedParties?: string[];
          item?: { filing?: { matterId?: string; materialized?: string[] } };
        }>(apiBase, "/api/intake/items/attach", "POST", {
          itemId: id,
          matterId: target,
          rememberSender: rememberSender && Boolean(detail?.from?.address),
        });
        if (result.rememberSkippedParties?.length) {
          setAttachNote(
            `已归入案件；这个地址已经登记在${result.rememberSkippedParties.join("、")}名下，没有重复登记。`,
          );
        }
        const filing = result.item?.filing;
        if (filing?.matterId) {
          setFilingReceipt({
            matterId: filing.matterId,
            label: matterLabelById[filing.matterId]?.trim() || filing.matterId,
            files: (filing.materialized ?? []).map(
              (relativePath) => relativePath.split("/").pop() || relativePath,
            ),
          });
        }
      },
      "归入案件失败",
    );
  }, [apiBase, detail?.from?.address, detail?.id, matterId, matterLabelById, rememberSender, runAction]);

  const ignore = useCallback(() => {
    const id = detail?.id;
    if (!id) {
      return;
    }
    void runAction(
      () =>
        apiSendJson(apiBase, `/api/intake/items/${encodeURIComponent(id)}/ignore`, "POST", {}).then(
          () => undefined,
        ),
      "忽略来件失败",
    );
  }, [apiBase, detail?.id, runAction]);

  const runLead = useCallback(
    (action: LawmindIntakeLeadAction) => {
      const id = detail?.id;
      if (!id) {
        return;
      }
      const title = leadTitle.trim();
      if (action === "accept" && !title) {
        setError("先填新案名称，再进入收案。");
        return;
      }
      void runAction(
        () =>
          apiSendJson(apiBase, `/api/intake/items/${encodeURIComponent(id)}/lead`, "POST", {
            action,
            ...(action === "accept" ? { matterTitle: title } : {}),
          }).then(() => undefined),
        "更新新案线索失败",
      );
    },
    [apiBase, detail?.id, leadTitle, runAction],
  );

  const choices = useMemo(() => {
    const ids = new Set<string>(overviewMatterIds);
    for (const id of matterChoices) {
      if (id) {
        ids.add(id);
      }
    }
    for (const candidate of detail?.resolution?.candidates ?? []) {
      ids.add(candidate.matterId);
    }
    return [...ids].toSorted((a, b) => a.localeCompare(b, "zh"));
  }, [detail?.resolution?.candidates, matterChoices, overviewMatterIds]);

  /** 录音通道：录音或带音频附件的来件才有「转写」操作（低配 ASR 时按钮给理由）。 */
  const canTranscribe = useMemo(() => {
    if (!detail) {
      return false;
    }
    if (detail.channel === "recording") {
      return true;
    }
    return detail.attachments.some((attachment) => {
      const dot = attachment.name.toLowerCase().lastIndexOf(".");
      return (
        dot > 0 &&
        AUDIO_EXT.has(attachment.name.toLowerCase().slice(dot))
      );
    });
  }, [detail]);

  const evalLine = matchingEvalLine(matchingEval);

  if (loading && items.length === 0) {
    return null;
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="lm-intake-inbox" data-testid="lm-intake-inbox" aria-label="待归案">
      <header className="lm-intake-inbox-head">
        <div>
          <p className="lm-desk-agenda-eyebrow">待归案</p>
          <h2>收件里还有 {items.length} 封没归案</h2>
          <p className="lm-meta">核对原文与线索后归入案件；不合适的可以忽略，或记成新案线索。</p>
          {evalLine ? (
            <p className="lm-meta" data-testid="lm-intake-matching-eval">
              {evalLine}
            </p>
          ) : null}
        </div>
      </header>
      {error ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      {attachNote ? (
        <div
          className="lm-callout lm-callout-info"
          role="status"
          data-testid="lm-intake-attach-note"
        >
          <p className="lm-callout-body">{attachNote}</p>
        </div>
      ) : null}
      {filingReceipt ? (
        <div
          className="lm-callout lm-callout-info"
          role="status"
          data-testid="lm-intake-filing-receipt"
        >
          <p className="lm-callout-body">
            已归入「{filingReceipt.label}」：{filingReceipt.files.length} 个文件写入案件
            {filingReceipt.files.length > 0
              ? `（${filingReceipt.files.slice(0, 3).join("、")}${
                  filingReceipt.files.length > 3 ? " 等" : ""
                }）`
              : ""}
            。
          </p>
          {onOpenMatter ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => onOpenMatter(filingReceipt.matterId)}
            >
              打开案件
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="lm-intake-inbox-body">
        <ul className="lm-intake-inbox-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="lm-intake-inbox-row"
                data-testid={`lm-intake-row-${item.id}`}
                aria-pressed={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="lm-intake-inbox-row-top">
                  <span className="lm-intake-inbox-kind">待归案</span>
                  <strong className="lm-intake-inbox-title">
                    {item.subject?.trim() || item.from?.display?.trim() || "待归案来件"}
                  </strong>
                </span>
                <span className="lm-intake-inbox-meta">
                  {senderLine(item)} · {rowSubtitle(item)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="lm-intake-inbox-detail lm-scroll">
          <LawmindIntakeDetail
            item={detail}
            loading={detailLoading}
            matterId={matterId}
            onMatterIdChange={setMatterId}
            matterChoices={choices}
            matterLabelById={matterLabelById}
            rememberSender={rememberSender}
            onRememberSenderChange={setRememberSender}
            leadTitle={leadTitle}
            onLeadTitleChange={setLeadTitle}
            onLeadAction={runLead}
            truncated={(detail?.text.length ?? 0) >= 2000}
            canTranscribe={canTranscribe}
            transcribing={transcribing}
            transcribeNote={transcribeNote}
            onTranscribe={() => void transcribe()}
            audioUrl={audioUrl}
            onSpeakerLabelChange={(speaker, label) => void labelSpeaker(speaker, label)}
            partyChoices={partyChoices}
            onSpeakerPartyChange={(speaker, partyId) => void mapSpeakerParty(speaker, partyId)}
            onSegmentTextChange={(index, text) => void editSegment(index, text)}
            previewAttachment={previewAttachment}
            onPreviewAttachment={(index) => void openAttachmentPreview(index)}
            onCloseAttachmentPreview={closeAttachmentPreview}
          />
          {detail ? (
            <div className="lm-intake-inbox-actions">
              <button
                type="button"
                className="lm-btn lm-btn-accent"
                data-testid="lm-intake-attach"
                disabled={busy || !matterId.trim()}
                onClick={attach}
              >
                归入案件
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-secondary"
                data-testid="lm-intake-ignore"
                disabled={busy}
                onClick={ignore}
              >
                忽略
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
