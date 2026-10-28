/**
 * 在办 · 待归案来件详情：原文、附件、候选案件与判案线索。
 *
 * 只呈现与让律师作决定有关的事实；判案结论由 resolve.ts 给定，
 * 这里不重新打分，也不把「建议」当成已经归案。
 */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  STRONG_INTAKE_KEY_KINDS,
  type IntakeAttachment,
  type IntakeCandidate,
  type IntakeChannel,
  type IntakeItem,
  type IntakeKey,
  type IntakeKeyKind,
  type IntakeTranscriptSegment,
} from "../../../../src/lawmind/intake/types.ts";
import type { IntakeAttachmentPreviewKind } from "./lawmind-intake-attachment";

export type LawmindIntakeLeadAction =
  | "new"
  | "needs_info"
  | "conflict_pending"
  | "declined"
  | "accept";

/** 已取回的附件预览；`kind=other` 只给下载，不内联渲染。 */
export type LawmindIntakeAttachmentPreview = {
  index: number;
  name: string;
  kind: IntakeAttachmentPreviewKind;
  /** 有 blob URL 就能下载；图片和 PDF 直接用它渲染。 */
  url: string | null;
  /** 文本预览按上限截断过。 */
  text: string | null;
  error: string | null;
};

export type LawmindIntakeDetailProps = {
  item: (IntakeItem & { text: string }) | null;
  loading: boolean;
  /** 已选案件；没有候选时可空。 */
  matterId: string;
  onMatterIdChange: (matterId: string) => void;
  matterChoices: string[];
  matterLabelById?: Record<string, string>;
  /** 记住发件人（写成委托人已核验邮箱）。 */
  rememberSender: boolean;
  onRememberSenderChange: (next: boolean) => void;
  /** 新案线索：律师给的案件名称（同时是案件目录名）。 */
  leadTitle: string;
  onLeadTitleChange: (next: string) => void;
  onLeadAction: (action: LawmindIntakeLeadAction) => void;
  /** 原文预览被预览接口截断时给出提示。 */
  truncated?: boolean;
  /** 录音转写：P2 通道；未配置 ASR 时按钮会给出理由而不是丢在控制台。 */
  canTranscribe?: boolean;
  transcribing?: boolean;
  transcribeNote?: string | null;
  onTranscribe?: () => void;
  /** 已用带鉴权的请求取回的音频 blob URL；没有就只显示分段与文字。 */
  audioUrl?: string | null;
  /** 保存说话人展示名（映射到当事人）；缺省时只读。 */
  onSpeakerLabelChange?: (speaker: string, label: string) => void;
  /** 选中案件的当事人；给了就渲染下拉，否则回退到自由文本名字。 */
  partyChoices?: Array<{ partyId: string; name: string }>;
  /** 保存「说话人 → 当事人」；传空字符串表示取消映射。 */
  onSpeakerPartyChange?: (speaker: string, partyId: string) => void;
  /** 改正某一段转写文字（ASR 错字）；缺省时只读。 */
  onSegmentTextChange?: (index: number, text: string) => void;
  /** 当前打开的附件预览；无则为 null。 */
  previewAttachment?: LawmindIntakeAttachmentPreview | null;
  /** 打开某个附件；缺省时不渲染「查看」按钮。 */
  onPreviewAttachment?: (index: number) => void;
  onCloseAttachmentPreview?: () => void;
};

const CHANNEL_LABEL: Record<IntakeChannel, string> = {
  email: "邮件",
  dropzone: "投递口",
  upload: "上传",
  wecom: "企业微信",
  recording: "录音",
};

const KEY_KIND_LABEL: Record<IntakeKeyKind, string> = {
  thread: "往来线程",
  case_no: "案号",
  matter_ref: "案件编号",
  verified_contact: "已核验邮箱",
  contact: "登记邮箱",
  party_name: "当事人姓名",
};

const SKIPPED_LABEL: Record<NonNullable<IntakeAttachment["skippedReason"]>, string> = {
  type_not_persisted: "类型不存档",
  too_large: "超过单件上限",
  too_large_total: "超过单封合计上限",
};

const AUDIO_EXTENSIONS = new Set([
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

function hasAudioAttachment(item: IntakeItem): boolean {
  return item.attachments.some((attachment) => {
    const dot = attachment.name.toLowerCase().lastIndexOf(".");
    return dot > 0 && AUDIO_EXTENSIONS.has(attachment.name.toLowerCase().slice(dot));
  });
}

function formatWhen(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return "";
  }
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpan(segment: IntakeTranscriptSegment): string {
  if (segment.startMs === undefined) {
    return "";
  }
  const seconds = Math.max(0, Math.round(segment.startMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function isStrong(key: IntakeKey): boolean {
  return STRONG_INTAKE_KEY_KINDS.has(key.kind);
}

function dmarcLine(item: IntakeItem): string {
  if (item.dmarc === "fail") {
    return "发件域认证未通过：不能自动归案，请人工核对发件人。";
  }
  if (item.dmarc === "pass") {
    return "发件域认证通过。";
  }
  return "这封信没有可用的发件域认证结果。";
}

const LEAD_STAGE_LABEL: Record<string, string> = {
  new: "新案线索",
  needs_info: "待补资料",
  conflict_pending: "待冲突检查",
  declined: "已婉拒",
  accepted: "已进入收案",
};

export function LawmindIntakeDetail(props: LawmindIntakeDetailProps): ReactNode {
  const {
    item,
    loading,
    matterId,
    onMatterIdChange,
    matterChoices,
    matterLabelById = {},
    rememberSender,
    onRememberSenderChange,
    leadTitle,
    onLeadTitleChange,
    onLeadAction,
    truncated = false,
    canTranscribe = false,
    transcribing = false,
    transcribeNote = null,
    onTranscribe,
    audioUrl = null,
    onSpeakerLabelChange,
    partyChoices,
    onSpeakerPartyChange,
    onSegmentTextChange,
    previewAttachment = null,
    onPreviewAttachment,
    onCloseAttachmentPreview,
  } = props;

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  /**
   * 放在早退之前：条目先从「读来件…」切到详情时，hook 数量不能变。
   * 放到 `if (!item) return` 后面会触发「Rendered more hooks than during the previous render」。
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const itemId = item?.id;
  useEffect(() => {
    setEditingIndex(null);
    setDraft("");
  }, [itemId]);

  if (loading && !item) {
    return (
      <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-loading">
        <p className="lm-meta" aria-busy="true">
          读来件…
        </p>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-missing">
        <p>这条来件找不到了。可能已被归案或忽略。</p>
      </div>
    );
  }

  const candidates = item.resolution?.candidates ?? [];
  const top = candidates[0];
  const strongTotal = candidates.filter((candidate) => candidate.strong).length;
  /**
   * 多候选时给一张「线索 × 案件」对照表：哪条线索指向哪个案件一眼能比，
   * 不用在两张候选卡之间来回对。强线索引出的行排在前面，其余按出现顺序。
   */
  const compareKinds = (() => {
    const seen: IntakeKeyKind[] = [];
    for (const candidate of candidates) {
      for (const key of candidate.keys) {
        if (!seen.includes(key.kind)) {
          seen.push(key.kind);
        }
      }
    }
    const strong = [...STRONG_INTAKE_KEY_KINDS];
    const rank = (kind: IntakeKeyKind): number => {
      const index = strong.indexOf(kind);
      return index === -1 ? strong.length : index;
    };
    return seen.toSorted((a, b) => rank(a) - rank(b));
  })();
  const hasSenderAddress = Boolean(item.from?.address);
  const segments = item.transcript?.segments ?? [];
  const speakerLabels = item.transcript?.speakerLabels ?? {};
  const speakers = [
    ...new Set(
      segments
        .map((segment) => segment.speaker)
        .filter((speaker): speaker is string => Boolean(speaker)),
    ),
  ];
  const audioSrc = audioUrl && hasAudioAttachment(item) ? audioUrl : null;
  const seekSegment = (segment: IntakeTranscriptSegment): void => {
    const audio = audioRef.current;
    if (!audio || segment.startMs === undefined) {
      return;
    }
    audio.currentTime = Math.max(0, segment.startMs / 1000);
    void audio.play().catch(() => {});
  };
  const partyNameById = new Map((partyChoices ?? []).map((party) => [party.partyId, party.name]));
  const speakerDisplay = (speaker: string): string => {
    const mapped = item.transcript?.speakerParties?.[speaker];
    const mappedName =
      mapped && mapped.matterId === matterId ? partyNameById.get(mapped.partyId) : undefined;
    return mappedName ?? speakerLabels[speaker] ?? speaker;
  };

  return (
    <div className="lm-intake" data-testid="lm-fleet-intake-detail">
      <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-summary">
        <dl className="lm-intake-facts">
          <div>
            <dt>主题</dt>
            <dd>{item.subject?.trim() || "(无主题)"}</dd>
          </div>
          <div>
            <dt>渠道</dt>
            <dd>{CHANNEL_LABEL[item.channel] ?? item.channel}</dd>
          </div>
          <div>
            <dt>发件人</dt>
            <dd>{item.from?.display || item.from?.address || "未知"}</dd>
          </div>
          <div>
            <dt>收到</dt>
            <dd>{formatWhen(item.receivedAt)}</dd>
          </div>
          <div>
            <dt>认证</dt>
            <dd data-tone={item.dmarc === "fail" ? "warn" : undefined}>{dmarcLine(item)}</dd>
          </div>
        </dl>
        {item.to ? <p className="lm-meta">收件人：{item.to}</p> : null}
      </div>

      {audioSrc || segments.length > 0 ? (
        <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-transcript">
          <h3 className="lm-intake-heading">录音与转写</h3>
          {audioSrc ? (
            <audio
              ref={audioRef}
              className="lm-intake-audio"
              controls
              preload="none"
              src={audioSrc}
              data-testid="lm-intake-audio"
            />
          ) : null}
          {speakers.length > 0 && (onSpeakerLabelChange || onSpeakerPartyChange) ? (
            <div className="lm-intake-speakers">
              {speakers.map((speaker) => {
                const mapped = item.transcript?.speakerParties?.[speaker];
                const mappedHere = mapped?.matterId === matterId ? mapped.partyId : "";
                return (
                  <label className="lm-intake-speaker-field" key={speaker}>
                    <span>{speaker}</span>
                    {onSpeakerPartyChange && partyChoices && partyChoices.length > 0 ? (
                      <select
                        className="lm-input"
                        data-testid={`lm-intake-speaker-party-${speaker}`}
                        value={mappedHere}
                        onChange={(event) => onSpeakerPartyChange(speaker, event.target.value)}
                      >
                        <option value="">不映射当事人</option>
                        {partyChoices.map((party) => (
                          <option key={party.partyId} value={party.partyId}>
                            {party.name}
                          </option>
                        ))}
                      </select>
                    ) : onSpeakerLabelChange ? (
                      <input
                        className="lm-input"
                        key={`${speaker}:${speakerLabels[speaker] ?? ""}`}
                        defaultValue={speakerLabels[speaker] ?? ""}
                        placeholder="写当事人姓名"
                        data-testid={`lm-intake-speaker-${speaker}`}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next !== (speakerLabels[speaker] ?? "")) {
                            onSpeakerLabelChange(speaker, next);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : null}
                  </label>
                );
              })}
            </div>
          ) : null}
          {segments.length > 0 ? (
            <ol className="lm-intake-segments">
              {segments.map((segment, index) => (
                <li className="lm-intake-segment" key={`${segment.startMs ?? "x"}-${index}`}>
                  <button
                    type="button"
                    className="lm-intake-seek"
                    data-testid={`lm-intake-seek-${index}`}
                    onClick={() => seekSegment(segment)}
                    disabled={segment.startMs === undefined || !audioSrc}
                    title={audioSrc ? "从这一段开始播放" : "没有可播放的音频"}
                  >
                    {formatSpan(segment) || "—"}
                  </button>
                  {segment.speaker ? (
                    <span className="lm-intake-speaker">{speakerDisplay(segment.speaker)}</span>
                  ) : null}
                  {segment.editedAt ? (
                    <span
                      className="lm-intake-edited"
                      data-testid={`lm-intake-segment-edited-${index}`}
                    >
                      已改正
                    </span>
                  ) : null}
                  {editingIndex === index && onSegmentTextChange ? (
                    <span className="lm-intake-segment-edit">
                      <textarea
                        className="lm-input"
                        rows={2}
                        value={draft}
                        data-testid={`lm-intake-segment-input-${index}`}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        className="lm-btn lm-btn-sm"
                        data-testid={`lm-intake-segment-save-${index}`}
                        disabled={!draft.trim()}
                        onClick={() => {
                          const next = draft.trim();
                          if (next) {
                            onSegmentTextChange(index, next);
                          }
                          setEditingIndex(null);
                        }}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        data-testid={`lm-intake-segment-cancel-${index}`}
                        onClick={() => setEditingIndex(null)}
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className="lm-intake-segment-text">{segment.text}</span>
                      {onSegmentTextChange ? (
                        <button
                          type="button"
                          className="lm-intake-seek"
                          data-testid={`lm-intake-segment-edit-${index}`}
                          title="改正这段转写"
                          onClick={() => {
                            setEditingIndex(index);
                            setDraft(segment.text);
                          }}
                        >
                          改
                        </button>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ol>
          ) : item.text.trim() ? (
            <p className="lm-meta">转写服务没有给分段；全文在下面的「原文」里。</p>
          ) : null}
        </div>
      ) : null}

      <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-candidates">
        <h3 className="lm-intake-heading">归入哪个案件</h3>
        {candidates.length === 0 ? (
          <p className="lm-meta">没有命中任何在办案件。可以选一个案件手动归入，或先忽略。</p>
        ) : (
          <>
            <p className="lm-meta">
              {strongTotal === 1
                ? "只有一条强线索命中，系统没有替你决定，请核对后归入。"
                : strongTotal > 1
                  ? "多条强线索指向不同案件，必须由你选择。"
                  : "只有弱线索（联系人、当事人姓名），不能自动归案。"}
            </p>
            <ul className="lm-intake-candidates">
              {candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.matterId}
                  candidate={candidate}
                  label={matterLabelById[candidate.matterId]?.trim() || candidate.matterId}
                  selected={candidate.matterId === matterId}
                  onSelect={() => onMatterIdChange(candidate.matterId)}
                />
              ))}
            </ul>
            {candidates.length >= 2 && compareKinds.length > 0 ? (
              <div
                className="lm-intake-candidate-compare lm-scroll"
                data-testid="lm-fleet-intake-candidate-compare"
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">线索</th>
                      {candidates.map((candidate) => (
                        <th key={candidate.matterId} scope="col">
                          {matterLabelById[candidate.matterId]?.trim() || candidate.matterId}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compareKinds.map((kind) => (
                      <tr key={kind}>
                        <th scope="row">{KEY_KIND_LABEL[kind]}</th>
                        {candidates.map((candidate) => {
                          const key = candidate.keys.find((row) => row.kind === kind);
                          return (
                            <td key={candidate.matterId}>{key?.detail ?? "—"}</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
        <label className="lm-intake-picker">
          <span>归入案件</span>
          <select
            className="lm-input"
            data-testid="lm-fleet-intake-matter-select"
            value={matterId}
            onChange={(event) => onMatterIdChange(event.target.value)}
          >
            <option value="">请选择案件</option>
            {matterChoices.map((id) => (
              <option key={id} value={id}>
                {matterLabelById[id]?.trim() || id}
              </option>
            ))}
          </select>
        </label>
        {hasSenderAddress ? (
          <label className="lm-intake-remember">
            <input
              type="checkbox"
              data-testid="lm-fleet-intake-remember-sender"
              checked={rememberSender}
              onChange={(event) => onRememberSenderChange(event.target.checked)}
            />
            <span>
              记住 {item.from?.address} 是本案委托人的邮箱；下次同一个地址来信可直接判案。
            </span>
          </label>
        ) : (
          <p className="lm-meta">这封来件没有解析出发件地址，不能记住发件人。</p>
        )}
      </div>

      {item.attachments.length > 0 ? (
        <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-attachments">
          <h3 className="lm-intake-heading">附件 {item.attachments.length}</h3>
          <ul className="lm-intake-attachments">
            {item.attachments.map((attachment, index) => (
              <li key={`${attachment.name}-${index}`}>
                <span className="lm-intake-attachment-name">{attachment.name}</span>
                <span className="lm-meta">
                  {formatBytes(attachment.size)}
                  {attachment.skippedReason
                    ? ` · ${SKIPPED_LABEL[attachment.skippedReason]}`
                    : ""}
                </span>
                {onPreviewAttachment && attachment.sha256 && !attachment.skippedReason ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    onClick={() => onPreviewAttachment(index)}
                  >
                    查看
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {previewAttachment ? (
            <div
              className="lm-intake-attachment-preview"
              data-testid="lm-fleet-intake-attachment-preview"
            >
              <div className="lm-intake-attachment-preview-head">
                <span className="lm-intake-attachment-name">{previewAttachment.name}</span>
                <div className="lm-lawyer-inline-actions">
                  {previewAttachment.url ? (
                    <a
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      href={previewAttachment.url}
                      download={previewAttachment.name}
                    >
                      下载原件
                    </a>
                  ) : null}
                  {onCloseAttachmentPreview ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      onClick={onCloseAttachmentPreview}
                    >
                      关闭
                    </button>
                  ) : null}
                </div>
              </div>
              {previewAttachment.error ? (
                <p className="lm-meta" role="status">
                  {previewAttachment.error}
                </p>
              ) : null}
              {previewAttachment.kind === "image" && previewAttachment.url ? (
                <img
                  className="lm-intake-attachment-preview-image"
                  src={previewAttachment.url}
                  alt={previewAttachment.name}
                />
              ) : null}
              {previewAttachment.kind === "pdf" && previewAttachment.url ? (
                <iframe
                  className="lm-intake-attachment-preview-frame"
                  src={previewAttachment.url}
                  title={previewAttachment.name}
                />
              ) : null}
              {previewAttachment.kind === "text" && previewAttachment.text !== null ? (
                <pre className="lm-intake-attachment-preview-text lm-scroll">
                  {previewAttachment.text}
                </pre>
              ) : null}
              {previewAttachment.kind === "other" ? (
                <p className="lm-meta">
                  这类文件不能在 LawMind 里预览；下载后用本机应用打开。
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-body">
        <h3 className="lm-intake-heading">原文</h3>
        <pre className="lm-intake-body lm-scroll">{item.text}</pre>
        {truncated ? <p className="lm-meta">只显示前 2,000 字，归案后可在案件邮件里看全文。</p> : null}
      </div>

      {canTranscribe ? (
        <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-transcribe">
          <h3 className="lm-intake-heading">录音转写</h3>
          {item.text ? (
            <p className="lm-meta">已转写。点击会重新出站并覆盖现有文字。</p>
          ) : (
            <p className="lm-meta">
              这条录音还没有文字。点「转写」会把音频发到配置的转写服务（设置里配置
              LAWMIND_ASR_ENDPOINT）；不配置就不出站。
            </p>
          )}
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-fleet-intake-transcribe-run"
            disabled={transcribing || !onTranscribe}
            onClick={() => onTranscribe?.()}
          >
            {transcribing ? "转写中…" : item.text ? "重新转写" : "转写录音"}
          </button>
          {transcribeNote ? (
            <p className="lm-meta" data-testid="lm-fleet-intake-transcribe-note">
              {transcribeNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {item.channel === "dropzone" ? (
        <p className="lm-meta" data-testid="lm-fleet-intake-dropzone-hint">
          投递口文件归案后会复制到案件材料目录；原件留在「收件投递/已入库」。
        </p>
      ) : null}
      {item.channel === "recording" || hasAudioAttachment(item) ? (
        <p className="lm-meta" data-testid="lm-fleet-intake-recording-hint">
          音频原件按内容哈希保存在统一收件库；归案后可从案件材料里回听。
        </p>
      ) : null}
      {top?.strong ? null : (
        <p className="lm-meta" data-testid="lm-fleet-intake-weak-note">
          没有任何强线索时，系统不会自动归案。归案是你此刻的判断。
        </p>
      )}

      <div className="lm-agents-wb-block" data-testid="lm-fleet-intake-lead">
        <h3 className="lm-intake-heading">当作新案线索</h3>
        <p className="lm-meta">
          {item.lead
            ? `现在：${LEAD_STAGE_LABEL[item.lead.stage] ?? item.lead.stage}。`
            : "没有可靠案件候选时，先记成线索；补资料或做冲突检查后再决定是否收案。"}
          这里只建「收案中」的案件，不会直接变成在办案件。
        </p>
        {item.lead?.note ? <p className="lm-meta">备注：{item.lead.note}</p> : null}
        <div className="lm-intake-lead-stages" role="group" aria-label="线索阶段">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-fleet-intake-lead-needs-info"
            aria-pressed={item.lead?.stage === "needs_info"}
            onClick={() => onLeadAction("needs_info")}
            title="缺委托材料，等客户补齐"
          >
            待补资料
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-fleet-intake-lead-conflict"
            aria-pressed={item.lead?.stage === "conflict_pending"}
            onClick={() => onLeadAction("conflict_pending")}
            title="先做利益冲突检查，再决定是否收案"
          >
            待冲突检查
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-fleet-intake-lead-decline"
            onClick={() => onLeadAction("declined")}
            title="不受理这条线索；来件会从待归案里拿掉"
          >
            婉拒
          </button>
        </div>
        <label className="lm-intake-picker">
          <span>新案名称（同时是案件目录名）</span>
          <input
            className="lm-input"
            data-testid="lm-fleet-intake-lead-title"
            value={leadTitle}
            maxLength={128}
            placeholder="例如：李四买卖合同纠纷"
            onChange={(event) => onLeadTitleChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm lm-intake-lead-accept"
          data-testid="lm-fleet-intake-lead-accept"
          disabled={!leadTitle.trim()}
          title={leadTitle.trim() ? "建「收案中」的案件并把这封来件归进去" : "先填新案名称"}
          onClick={() => onLeadAction("accept")}
        >
          进入收案
        </button>
      </div>
    </div>
  );
}

function CandidateRow(props: {
  candidate: IntakeCandidate;
  label: string;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const { candidate, label, selected, onSelect } = props;
  return (
    <li>
      <button
        type="button"
        className="lm-intake-candidate"
        data-testid={`lm-fleet-intake-candidate-${candidate.matterId}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="lm-intake-candidate-head">
          <span className="lm-intake-candidate-title">{label}</span>
          <span className="lm-intake-candidate-badge" data-strong={candidate.strong}>
            {candidate.strong ? "强线索" : "弱线索"}
          </span>
        </span>
        <span className="lm-intake-keys">
          {candidate.keys.map((key) => (
            <span
              key={`${candidate.matterId}-${key.kind}`}
              className="lm-intake-key"
              data-strong={isStrong(key)}
            >
              {KEY_KIND_LABEL[key.kind] ?? key.kind}：{key.detail}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}
