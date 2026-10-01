import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import { ASSISTANT_PRESENCE_LABEL } from "../../../../src/lawmind/assistants/presence.ts";
import {
  assistantJobBriefHint,
  sortAssistantsForRoster,
} from "../../../../src/lawmind/assistants/roster.ts";
import {
  PRACTICE_PERSONAS,
  type PracticePersona,
} from "../../../../src/lawmind/core/practice-personas.ts";
import { ApiRequestError, apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { confirmDialog } from "./lawmind-confirm-dialog";
import type { AssistantRow } from "./lawmind-settings-models.ts";

type Props = {
  apiBase?: string;
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (id: string) => void;
  selectedAssistant: AssistantRow | undefined;
  selectedAssistantStats: AssistantRow["stats"] | undefined;
  onOpenNew: (presetKey?: string) => void;
  onOpenEdit: () => void;
  onRemove: () => void;
  /** 复制当前助手（只复制角色与边界，不复制记忆）。 */
  onDuplicate: () => void;
  /** 置顶或从日常切换隐藏。隐藏不删除对话与交付物。 */
  onPatchRoster: (assistantId: string, patch: { pinned?: boolean; hidden?: boolean }) => void;
  /** Firm+ only. Solo shows single-parent editor (no hire / duplicate / persona grid). */
  allowMultiAssistantRoster?: boolean;
};

type ProfileSection = {
  stamp?: string;
  body?: string;
  sourceHint?: string;
};

function roleLabel(assistant: AssistantRow | undefined): string {
  if (!assistant) {
    return "—";
  }
  if (assistant.customRoleTitle?.trim()) {
    return assistant.customRoleTitle.trim();
  }
  const fromPersona = PRACTICE_PERSONAS.find((p) => p.presetKey === assistant.presetKey);
  if (fromPersona) {
    return fromPersona.label;
  }
  if (assistant.presetKey === "general_default" || !assistant.presetKey) {
    return "通用法律助理";
  }
  return assistant.presetKey;
}

function findAssistantForPersona(
  assistants: AssistantRow[],
  persona: PracticePersona,
): AssistantRow | undefined {
  return assistants.find((a) => a.presetKey === persona.presetKey);
}

export function LawmindSettingsAssistants(props: Props): ReactNode {
  const {
    apiBase,
    assistants,
    selectedAssistantId,
    onSelectAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    onOpenNew,
    onOpenEdit,
    onDuplicate,
    onRemove,
    onPatchRoster,
    allowMultiAssistantRoster = false,
  } = props;
  const empty = assistants.length === 0;
  const multi =  allowMultiAssistantRoster;
  const [sections, setSections] = useState<ProfileSection[] | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterHits, setRosterHits] = useState<
    Array<{ assistantId: string | null; label: string; hits: Array<{ kind: string; title: string; snippet: string }> }>
  >([]);

  useEffect(() => {
    if (!apiBase?.trim() || !selectedAssistantId) {
      setSections(null);
      // 显式 undefined：与下面的 cleanup 保持一致的返回形状（oxlint consistent-return）。
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; sections?: ProfileSection[] }>(
      apiBase,
      `/api/assistants/${encodeURIComponent(selectedAssistantId)}/profile-sections`,
    )
      .then((j) => {
        if (!cancelled) {
          setSections(Array.isArray(j.sections) ? j.sections : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSections(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, selectedAssistantId]);

  useEffect(() => {
    const query = rosterQuery.trim();
    if (!apiBase?.trim() || query.length < 2) {
      setRosterHits([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void apiGetJson<{
        groups?: Array<{
          assistantId: string | null;
          label: string;
          hits: Array<{ kind: string; title: string; snippet: string }>;
        }>;
      }>(apiBase, `/api/assistants/roster-search?q=${encodeURIComponent(query)}`)
        .then((payload) => {
          if (!cancelled) {
            setRosterHits(Array.isArray(payload.groups) ? payload.groups : []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRosterHits([]);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, rosterQuery]);

  const selectedPresetKey = selectedAssistant?.presetKey;

  const shareTemplate = useCallback(async () => {
    if (!apiBase?.trim() || !selectedAssistantId) {
      return;
    }
    setShareNote(null);
    const post = (acknowledgeWarnings: boolean) =>
      apiSendJson<{
        ok?: boolean;
        template?: unknown;
        blockers?: string[];
        warnings?: string[];
      }>(apiBase, `/api/assistants/${encodeURIComponent(selectedAssistantId)}/share-template`, "POST", {
        acknowledgeWarnings,
      });
    const explain = (body: { blockers?: string[]; warnings?: string[] } | null) => {
      if (body?.blockers && body.blockers.length > 0) {
        setShareNote(body.blockers.join(" "));
        return true;
      }
      return false;
    };
    try {
      let result = await post(false);
      const text = JSON.stringify(result.template, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        setShareNote("已复制岗位模板。里面没有记忆、对话和密钥。");
      } catch {
        setShareNote(text);
      }
    } catch (cause) {
      const body =
        cause instanceof ApiRequestError && cause.body && typeof cause.body === "object"
          ? (cause.body as { blockers?: string[]; warnings?: string[] })
          : null;
      if (explain(body)) {
        return;
      }
      if (body?.warnings && body.warnings.length > 0) {
        const accepted = await confirmDialog({
          title: "导出前确认",
          body: body.warnings.join("\n"),
          confirmLabel: "仍然导出",
        });
        if (!accepted) {
          return;
        }
        try {
          const result = await post(true);
          const text = JSON.stringify(result.template, null, 2);
          await navigator.clipboard.writeText(text);
          setShareNote("已复制岗位模板。里面没有记忆、对话和密钥。");
        } catch (again) {
          setShareNote(errorMessage(again, "导出失败"));
        }
        return;
      }
      setShareNote(errorMessage(cause, "导出失败"));
    }
  }, [apiBase, selectedAssistantId]);

  const onPersonaActivate = useCallback(
    (persona: PracticePersona) => {
      const existing = findAssistantForPersona(assistants, persona);
      if (existing) {
        onSelectAssistantId(existing.assistantId);
        return;
      }
      onOpenNew(persona.presetKey);
    },
    [assistants, onOpenNew, onSelectAssistantId],
  );

  const roster = useMemo(() => sortAssistantsForRoster(assistants), [assistants]);
  const visibleRoster = useMemo(() => {
    if (multi) {
      return roster;
    }
    const current =
      roster.find((a) => a.assistantId === selectedAssistantId) ??
      roster.find((a) => a.assistantId === DEFAULT_ASSISTANT_ID) ??
      roster[0];
    return current ? [current] : [];
  }, [multi, roster, selectedAssistantId]);

  const personaHints = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assistants) {
      if (!a.presetKey) {
        continue;
      }
      map.set(a.presetKey, (map.get(a.presetKey) ?? 0) + 1);
    }
    return map;
  }, [assistants]);

  return (
    <div className="lm-settings-section lm-assistants-settings" data-testid="lm-settings-assistants">
      <p className="lm-settings-lead">
        {multi
          ? "律所可编制多名助手。日常办案仍以一位父助手为主；复杂活优先用隔离子工。置顶排在前面；隐藏只影响顶栏切换。"
          : "独立律师版只需一位父助手。可改名称与职务说明；复杂活在对话里开子工并行，不必再建人。"}
      </p>
      <label className="lm-assistants-search">
        <span>在名册里找办过的事</span>
        <input
          className="lm-input"
          value={rosterQuery}
          onChange={(event) => setRosterQuery(event.target.value)}
          placeholder="至少两个字，例如续签"
          data-testid="lm-assistants-search"
        />
      </label>
      {rosterHits.length > 0 ? (
        <ul className="lm-assistants-search-hits" aria-label="名册检索结果">
          {rosterHits.map((group) => (
            <li key={group.assistantId ?? group.label}>
              <strong>{group.label}</strong>
              {group.hits.slice(0, 3).map((hit) => (
                <p key={`${hit.kind}-${hit.title}`}>{hit.title}</p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="lm-assistants-block" aria-labelledby="lm-assistants-current-title">
        <header className="lm-assistants-block__head">
          <h3 id="lm-assistants-current-title" className="lm-assistants-block__title">
            当前助手
          </h3>
        </header>

        {empty ? (
          <div className="lm-memory-empty lm-memory-empty--compact" role="status">
            <p className="lm-memory-empty__title">还没有助手</p>
            <p className="lm-memory-empty__desc">
              {multi ? "点下方业务领域，或「新建助手」开始。" : "打开应用后会自动就绪一位父助手。"}
            </p>
          </div>
        ) : (
          <div className="lm-assistants-current">
            <ul className="lm-assistants-roster" aria-label={multi ? "助手名册" : "当前父助手"}>
              {visibleRoster.map((assistant) => {
                const selected = assistant.assistantId === selectedAssistantId;
                const pinned = assistant.pinned === true;
                const hidden = assistant.hidden === true;
                return (
                  <li key={assistant.assistantId} className="lm-assistants-roster__item">
                    <button
                      type="button"
                      className={`lm-assistants-roster__pick${selected ? " is-selected" : ""}${hidden ? " is-hidden" : ""}`}
                      aria-pressed={selected}
                      data-testid={`lm-assistants-roster-${assistant.assistantId}`}
                      onClick={() => onSelectAssistantId(assistant.assistantId)}
                    >
                      <span className="lm-assistants-roster__name">
                        {assistant.displayName}
                        {assistant.assistantId === DEFAULT_ASSISTANT_ID ? "（默认）" : ""}
                      </span>
                      <span className="lm-assistants-roster__meta">
                        {ASSISTANT_PRESENCE_LABEL[assistant.presence ?? "idle"]}
                        {" · "}
                        {roleLabel(assistant)}
                        {" · "}
                        {assistantJobBriefHint(assistant.jobBrief)}
                        {multi && pinned ? " · 已置顶" : ""}
                        {multi && hidden ? " · 已从日常切换隐藏" : ""}
                      </span>
                    </button>
                    {multi ? (
                      <div className="lm-assistants-roster__flags">
                        <button
                          type="button"
                          className="lm-assistants-roster__flag"
                          aria-pressed={pinned}
                          data-testid={`lm-assistants-pin-${assistant.assistantId}`}
                          onClick={() =>
                            onPatchRoster(assistant.assistantId, { pinned: !pinned })
                          }
                        >
                          {pinned ? "取消置顶" : "置顶"}
                        </button>
                        {assistant.assistantId === DEFAULT_ASSISTANT_ID ? null : (
                          <button
                            type="button"
                            className="lm-assistants-roster__flag"
                            aria-pressed={hidden}
                            data-testid={`lm-assistants-hide-${assistant.assistantId}`}
                            onClick={() =>
                              onPatchRoster(assistant.assistantId, { hidden: !hidden })
                            }
                          >
                            {hidden ? "显示" : "隐藏"}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <dl className="lm-assistants-meta">
              <div>
                <dt>岗位</dt>
                <dd>{roleLabel(selectedAssistant)}</dd>
              </div>
              {selectedAssistantStats ? (
                <div>
                  <dt>使用</dt>
                  <dd>
                    {selectedAssistantStats.turnCount} 轮 · {selectedAssistantStats.sessionCount}{" "}
                    会话
                  </dd>
                </div>
              ) : null}
              {selectedAssistant?.introduction?.trim() ? (
                <div className="lm-assistants-meta__wide">
                  <dt>简介</dt>
                  <dd>{selectedAssistant.introduction.trim()}</dd>
                </div>
              ) : null}
            </dl>

            {sections && sections.length > 0 ? (
              <details className="lm-settings-advanced lm-assistants-profile">
                <summary>
                  <span className="lm-settings-advanced__label">习惯摘要</span>
                  <span className="lm-settings-advanced__hint">{sections.length} 段</span>
                </summary>
                <div className="lm-settings-advanced-body">
                  <ul className="lm-assistants-profile__list">
                    {sections.slice(0, 8).map((s, i) => {
                      const label = s.stamp?.trim() || `要点 ${i + 1}`;
                      const preview = (s.body ?? "").trim();
                      return (
                        <li key={`${label}-${i}`}>
                          <strong>{label}</strong>
                          {preview ? <p>{preview.slice(0, 160)}{preview.length > 160 ? "…" : ""}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </details>
            ) : null}

            <div className="lm-assistants-actions" role="group" aria-label="助手操作">
              {multi ? (
                <button
                  type="button"
                  className="lm-assistants-action lm-assistants-action--primary"
                  data-testid="lm-assistants-quick-create"
                  onClick={() => onOpenNew()}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M8 3.25v9.5M3.25 8h9.5"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                    />
                  </svg>
                  新建助手
                </button>
              ) : null}
              <button
                type="button"
                className={`lm-assistants-action ${multi ? "lm-assistants-action--secondary" : "lm-assistants-action--primary"}`}
                data-testid="lm-assistants-advanced-edit"
                onClick={onOpenEdit}
                disabled={empty}
                title="编辑名称、职务说明与简介"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M11.2 2.9a1.4 1.4 0 0 1 2 2L5.7 12.4 2.5 13.2l.8-3.2L11.2 2.9Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                {multi ? "高级编辑" : "编辑父助手"}
              </button>
              {multi ? (
                <button
                  type="button"
                  className="lm-assistants-action lm-assistants-action--secondary"
                  data-testid="lm-assistants-share"
                  onClick={() => void shareTemplate()}
                  disabled={empty || !apiBase?.trim()}
                  title="导出岗位模板。不含记忆、对话和密钥。对方得到的是独立副本。"
                >
                  导出岗位模板
                </button>
              ) : null}
              {multi ? (
                <button
                  type="button"
                  className="lm-assistants-action lm-assistants-action--secondary"
                  data-testid="lm-assistants-duplicate"
                  onClick={onDuplicate}
                  disabled={empty}
                  title="复制这个助手的岗位与边界（不含它的记忆与用量）；之后可改名用于新范围"
                >
                  复制
                </button>
              ) : null}
              {multi && selectedAssistantId !== DEFAULT_ASSISTANT_ID ? (
                <button
                  type="button"
                  className="lm-assistants-action lm-assistants-action--danger"
                  data-testid="lm-assistants-remove"
                  onClick={onRemove}
                  disabled={empty}
                >
                  删除
                </button>
              ) : null}
            </div>
            {shareNote ? (
              <p className="lm-meta" role="status" data-testid="lm-assistants-share-note">
                {shareNote}
              </p>
            ) : null}
          </div>
        )}

        {empty && multi ? (
          <div className="lm-assistants-actions" role="group" aria-label="助手操作">
            <button
              type="button"
              className="lm-assistants-action lm-assistants-action--primary"
              data-testid="lm-assistants-quick-create"
              onClick={() => onOpenNew()}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 3.25v9.5M3.25 8h9.5"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
              新建助手
            </button>
          </div>
        ) : null}
      </section>

      {multi ? (
      <section className="lm-assistants-block" aria-labelledby="lm-assistants-persona-title">
        <header className="lm-assistants-block__head">
          <h3 id="lm-assistants-persona-title" className="lm-assistants-block__title">
            按业务领域
          </h3>
          <p className="lm-assistants-block__desc">
            已有对应助手则切换；没有则打开新建并预选岗位。
          </p>
        </header>
        <ul className="lm-assistants-persona-grid" aria-label="业务领域">
          {PRACTICE_PERSONAS.map((p) => {
            const count = personaHints.get(p.presetKey) ?? 0;
            const active = Boolean(selectedPresetKey && selectedPresetKey === p.presetKey);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`lm-assistants-persona${active ? " is-active" : ""}`}
                  title={p.description}
                  onClick={() => onPersonaActivate(p)}
                  data-testid={`lm-assistants-persona-${p.id}`}
                >
                  <span className="lm-assistants-persona__label">{p.label}</span>
                  <span className="lm-assistants-persona__desc">{p.description}</span>
                  <span className="lm-assistants-persona__hint">
                    {count > 0 ? `已有 ${count} 位 · 点击切换` : "点击新建"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      ) : null}
    </div>
  );
}
