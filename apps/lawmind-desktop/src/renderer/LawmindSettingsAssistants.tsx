import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import {
  PRACTICE_PERSONAS,
  type PracticePersona,
} from "../../../../src/lawmind/core/practice-personas.ts";
import { apiGetJson } from "./api-client";
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
    onRemove,
  } = props;
  const empty = assistants.length === 0;
  const [sections, setSections] = useState<ProfileSection[] | null>(null);

  useEffect(() => {
    if (!apiBase?.trim() || !selectedAssistantId) {
      setSections(null);
      return;
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

  const selectedPresetKey = selectedAssistant?.presetKey;

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
      <p className="lm-settings-lead">选助手或新建。</p>

      <section className="lm-assistants-block" aria-labelledby="lm-assistants-current-title">
        <header className="lm-assistants-block__head">
          <h3 id="lm-assistants-current-title" className="lm-assistants-block__title">
            当前助手
          </h3>
        </header>

        {empty ? (
          <div className="lm-memory-empty lm-memory-empty--compact" role="status">
            <p className="lm-memory-empty__title">还没有助手</p>
            <p className="lm-memory-empty__desc">点下方业务领域，或「快速新建」开始。</p>
          </div>
        ) : (
          <div className="lm-assistants-current">
            <label className="lm-assistants-field">
              <span>选择助手</span>
              <select
                className="lm-asst-select"
                value={selectedAssistantId}
                onChange={(e) => onSelectAssistantId(e.target.value)}
                data-testid="lm-assistants-select"
              >
                {assistants.map((a) => (
                  <option key={a.assistantId} value={a.assistantId}>
                    {a.displayName}
                    {a.assistantId === DEFAULT_ASSISTANT_ID ? "（默认）" : ""}
                  </option>
                ))}
              </select>
            </label>

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
                快速新建
              </button>
              <button
                type="button"
                className="lm-assistants-action lm-assistants-action--secondary"
                data-testid="lm-assistants-advanced-edit"
                onClick={onOpenEdit}
                disabled={empty}
                title="编辑名称、岗位、组织关系与简介"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M11.2 2.9a1.4 1.4 0 0 1 2 2L5.7 12.4 2.5 13.2l.8-3.2L11.2 2.9Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                高级编辑
              </button>
              {selectedAssistantId !== DEFAULT_ASSISTANT_ID ? (
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
          </div>
        )}

        {empty ? (
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
              快速新建
            </button>
          </div>
        ) : null}
      </section>

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
    </div>
  );
}
