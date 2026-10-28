/**
 * 设置 · 本所剧本（三色分流）。
 *
 * 只编辑 `<workspace>/lawmind/playbooks/<id>.json` 里的条件；没有剧本时合同类草稿
 * 按通用标准走 `basis=default`，这里不内置任何条款清单。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CLAUSE_TYPES, type ClauseType } from "../../../../src/lawmind/clause/ast.ts";
import type { Playbook } from "../../../../src/lawmind/deliverables/playbook-triage.ts";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { confirmDialog } from "./lawmind-confirm-dialog";

type PlaybookSummary = {
  id: string;
  name: string;
  version: string;
  criteriaCount: number;
  deliverableTypes: string[];
};

type CheckKind =
  | "manual"
  | "clause_present"
  | "section_present"
  | "phrase_present"
  | "phrase_absent"
  | "citation_present";

type CriterionDraft = {
  id: string;
  kind: "green" | "red";
  title: string;
  checkKind: CheckKind;
  headings: string;
  phrases: string;
  clauseTypes: ClauseType[];
};

type PlaybookDraft = {
  id: string;
  name: string;
  version: string;
  stance: string;
  acceptableRange: string;
  escalationTriggers: string;
  deliverableTypes: string;
  criteria: CriterionDraft[];
};

const CLAUSE_TYPE_LABELS: Record<ClauseType, string> = {
  definition: "定义",
  obligation: "义务",
  right: "权利",
  liability: "责任",
  dispute: "争议解决",
  general: "其他",
};

const SAFE_PLAYBOOK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function lines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function emptyDraft(): PlaybookDraft {
  return {
    id: "",
    name: "",
    version: "1.0.0",
    stance: "",
    acceptableRange: "",
    escalationTriggers: "",
    deliverableTypes: "",
    criteria: [
      {
        id: "c1",
        kind: "green",
        title: "",
        checkKind: "manual",
        headings: "",
        phrases: "",
        clauseTypes: [],
      },
    ],
  };
}

function toDraft(playbook: Playbook): PlaybookDraft {
  return {
    id: playbook.id,
    name: playbook.name,
    version: playbook.version,
    stance: playbook.stance,
    acceptableRange: playbook.acceptableRange,
    escalationTriggers: playbook.escalationTriggers.join("\n"),
    deliverableTypes: (playbook.deliverableTypes ?? []).join("\n"),
    criteria: playbook.criteria.map((criterion) => {
      const check = criterion.check;
      return {
        id: criterion.id,
        kind: criterion.kind,
        title: criterion.title,
        checkKind: check?.kind ?? "manual",
        headings: check?.kind === "section_present" ? check.headings.join("\n") : "",
        phrases:
          check?.kind === "phrase_present" || check?.kind === "phrase_absent"
            ? check.phrases.join("\n")
            : "",
        clauseTypes: [...(criterion.clauseTypes ?? [])],
      };
    }),
  };
}

function draftProblem(draft: PlaybookDraft): string | null {
  if (!SAFE_PLAYBOOK_ID.test(draft.id.trim())) {
    return "剧本编号只能用字母、数字、点、下划线与连字符，并以字母或数字开头。";
  }
  if (!draft.name.trim()) {
    return "请填写剧本名称。";
  }
  if (draft.criteria.length === 0) {
    return "至少保留一条条件。";
  }
  const seen = new Set<string>();
  for (const criterion of draft.criteria) {
    const id = criterion.id.trim();
    if (!id) {
      return "每条条件都要有编号。";
    }
    if (seen.has(id)) {
      return `条件编号重复：${id}。`;
    }
    seen.add(id);
    if (!criterion.title.trim()) {
      return `条件「${id}」还没有写标题。`;
    }
    if (criterion.checkKind === "clause_present" && criterion.clauseTypes.length === 0) {
      return `条件「${id}」选了必含条款，但没有选条款类型。`;
    }
    if (criterion.checkKind === "section_present" && lines(criterion.headings).length === 0) {
      return `条件「${id}」选了必含章节，但没有写章节标题。`;
    }
    if (
      (criterion.checkKind === "phrase_present" || criterion.checkKind === "phrase_absent") &&
      lines(criterion.phrases).length === 0
    ) {
      return `条件「${id}」选了${criterion.checkKind === "phrase_present" ? "必含" : "禁止"}表述，但没有写具体措辞。`;
    }
  }
  return null;
}

function toPayload(draft: PlaybookDraft): Playbook {
  const types = lines(draft.deliverableTypes);
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    jurisdiction: "PRC",
    version: draft.version.trim() || "1.0.0",
    stance: draft.stance.trim(),
    acceptableRange: draft.acceptableRange.trim(),
    escalationTriggers: lines(draft.escalationTriggers),
    criteria: draft.criteria.map((criterion) => {
      const check =
        criterion.checkKind === "manual"
          ? undefined
          : criterion.checkKind === "clause_present"
            ? { kind: "clause_present" as const }
            : criterion.checkKind === "section_present"
              ? { kind: "section_present" as const, headings: lines(criterion.headings) }
              : criterion.checkKind === "phrase_present"
                ? { kind: "phrase_present" as const, phrases: lines(criterion.phrases) }
                : criterion.checkKind === "phrase_absent"
                  ? { kind: "phrase_absent" as const, phrases: lines(criterion.phrases) }
                  : { kind: "citation_present" as const };
      return {
        id: criterion.id.trim(),
        kind: criterion.kind,
        title: criterion.title.trim(),
        ...(check ? { check } : {}),
        ...(check?.kind === "clause_present" && criterion.clauseTypes.length
          ? { clauseTypes: [...criterion.clauseTypes] }
          : {}),
      };
    }),
    ...(types.length ? { deliverableTypes: types } : {}),
  };
}

export function LawmindSettingsPlaybooks({ apiBase }: { apiBase: string }): ReactNode {
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const payload = await apiGetJson<{ ok?: boolean; playbooks?: PlaybookSummary[] }>(
        apiBase,
        "/api/playbooks",
      );
      setPlaybooks(Array.isArray(payload.playbooks) ? payload.playbooks : []);
    } catch (e) {
      setHint(errorMessage(e, "读取剧本失败"));
    }
  }, [apiBase]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const startNew = () => {
    setEditingExisting(false);
    setDraft(emptyDraft());
    setHint(null);
  };

  const openEdit = async (id: string) => {
    setBusy(true);
    setHint(null);
    try {
      const payload = await apiGetJson<{ ok?: boolean; playbook?: Playbook }>(
        apiBase,
        `/api/playbooks/${encodeURIComponent(id)}`,
      );
      if (!payload.playbook) {
        setHint("没有找到这份剧本。");
        return;
      }
      setEditingExisting(true);
      setDraft(toDraft(payload.playbook));
    } catch (e) {
      setHint(errorMessage(e, "读取剧本失败"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (summary: PlaybookSummary) => {
    if (
      !(await confirmDialog({
        title: `删除剧本「${summary.name}」？`,
        body: "删除后合同类草稿不再按它分级；已生成的草稿不会重算。",
        confirmLabel: "删除",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      await apiSendJson(apiBase, `/api/playbooks/${encodeURIComponent(summary.id)}`, "DELETE");
      setHint("已删除。");
      if (draft?.id.trim() === summary.id) {
        setDraft(null);
      }
      await loadList();
    } catch (e) {
      setHint(errorMessage(e, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) {
      return;
    }
    const problem = draftProblem(draft);
    if (problem) {
      setHint(problem);
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/playbooks", "POST", toPayload(draft));
      setHint("已保存。之后的合同、意见书与诉讼文书草稿会按这份剧本分级；已生成的草稿不会重算。");
      setDraft(null);
      await loadList();
    } catch (e) {
      setHint(errorMessage(e, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  const patchCriterion = (index: number, patch: Partial<CriterionDraft>) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        criteria: current.criteria.map((criterion, i) =>
          i === index ? { ...criterion, ...patch } : criterion,
        ),
      };
    });
  };

  return (
    <details className="lm-settings-advanced" data-testid="lm-settings-playbooks">
      <summary>
        <span className="lm-settings-advanced__label">剧本</span>
        <span className="lm-settings-advanced__hint">合同、意见书、诉讼文书按剧本三色分级</span>
      </summary>
      <div className="lm-settings-advanced-body">
        <p className="lm-settings-caption">
          没有剧本时合同、意见书与诉讼文书草稿按通用标准分级（basis=default），不会冒充本所立场。工作区有多份剧本时按「适用范围」选；仍分不清就不出结论。否定性检查只在命中时判不符合，未命中不会自动判通过。
        </p>

        {playbooks.length === 0 ? (
          <p className="lm-settings-caption" data-testid="lm-playbooks-empty">
            还没有剧本。
          </p>
        ) : (
          playbooks.map((summary) => (
            <div
              className="lm-playbook-row"
              key={summary.id}
              data-testid={`lm-playbook-row-${summary.id}`}
            >
              <span className="lm-settings-key">{summary.name}</span>
              <span className="lm-settings-caption">
                {summary.id} · {summary.criteriaCount} 项
                {summary.deliverableTypes.length
                  ? ` · 适用 ${summary.deliverableTypes.join("、")}`
                  : " · 适用所有已支持类型"}
              </span>
              <span className="lm-playbook-row-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  data-testid={`lm-playbook-edit-${summary.id}`}
                  disabled={busy}
                  onClick={() => void openEdit(summary.id)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  data-testid={`lm-playbook-delete-${summary.id}`}
                  disabled={busy}
                  onClick={() => void remove(summary)}
                >
                  删除
                </button>
              </span>
            </div>
          ))
        )}

        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-playbook-new"
            disabled={busy}
            onClick={startNew}
          >
            新建剧本
          </button>
        </div>

        {draft ? (
          <div data-testid="lm-playbook-editor">
            <label className="lm-settings-field">
              <span className="lm-settings-key">编号</span>
              <input
                className="lm-input"
                value={draft.id}
                disabled={editingExisting}
                data-testid="lm-playbook-id"
                placeholder="prc.contract.general"
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">名称</span>
              <input
                className="lm-input"
                value={draft.name}
                data-testid="lm-playbook-name"
                placeholder="中国法合同审查（通用）"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">版本</span>
              <input
                className="lm-input"
                value={draft.version}
                data-testid="lm-playbook-version"
                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">适用范围</span>
              <textarea
                className="lm-input"
                rows={2}
                value={draft.deliverableTypes}
                data-testid="lm-playbook-scope"
                placeholder="一行一条，如 contract.review / memo. / litigation.；留空 = 所有已支持类型"
                onChange={(e) => setDraft({ ...draft, deliverableTypes: e.target.value })}
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">标准立场</span>
              <textarea
                className="lm-input"
                rows={2}
                value={draft.stance}
                data-testid="lm-playbook-stance"
                onChange={(e) => setDraft({ ...draft, stance: e.target.value })}
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">可接受区间</span>
              <textarea
                className="lm-input"
                rows={2}
                value={draft.acceptableRange}
                data-testid="lm-playbook-range"
                onChange={(e) => setDraft({ ...draft, acceptableRange: e.target.value })}
              />
            </label>
            <label className="lm-settings-field">
              <span className="lm-settings-key">升级触发</span>
              <textarea
                className="lm-input"
                rows={2}
                value={draft.escalationTriggers}
                data-testid="lm-playbook-escalations"
                placeholder="一行一条"
                onChange={(e) => setDraft({ ...draft, escalationTriggers: e.target.value })}
              />
            </label>

            <div className="lm-settings-field">
              <span className="lm-settings-key">条件</span>
              <div className="lm-playbook-criteria">
                {draft.criteria.map((criterion, index) => (
                  <div
                    className="lm-playbook-criterion"
                    key={index}
                    data-testid={`lm-playbook-criterion-${index}`}
                  >
                    <div className="lm-playbook-criterion-line">
                      <input
                        className="lm-input lm-playbook-criterion-id"
                        value={criterion.id}
                        aria-label={`条件 ${index + 1} 编号`}
                        onChange={(e) => patchCriterion(index, { id: e.target.value })}
                      />
                      <select
                        className="lm-input"
                        value={criterion.kind}
                        aria-label={`条件 ${index + 1} 类型`}
                        onChange={(e) =>
                          patchCriterion(index, { kind: e.target.value as "green" | "red" })
                        }
                      >
                        <option value="green">GREEN 条件（全过才绿）</option>
                        <option value="red">RED 条件（命中即红）</option>
                      </select>
                      <input
                        className="lm-input"
                        value={criterion.title}
                        aria-label={`条件 ${index + 1} 标题`}
                        placeholder="如：有争议解决条款"
                        onChange={(e) => patchCriterion(index, { title: e.target.value })}
                      />
                      <button
                        type="button"
                        className="lm-btn lm-btn-sm"
                        disabled={draft.criteria.length <= 1}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            criteria: draft.criteria.filter((_, i) => i !== index),
                          })
                        }
                      >
                        移除
                      </button>
                    </div>
                    <div className="lm-playbook-criterion-line">
                      <span>机械核对</span>
                      <select
                        className="lm-input"
                        value={criterion.checkKind}
                        aria-label={`条件 ${index + 1} 机械核对`}
                        data-testid={`lm-playbook-check-kind-${index}`}
                        onChange={(e) =>
                          patchCriterion(index, {
                            checkKind: e.target.value as CheckKind,
                            ...(e.target.value === "clause_present" ? {} : { clauseTypes: [] }),
                          })
                        }
                      >
                        <option value="manual">不机械核对（人工/模型给结论）</option>
                        <option value="clause_present">必含条款</option>
                        <option value="section_present">必含章节</option>
                        <option value="phrase_present">必含表述</option>
                        <option value="phrase_absent">禁止表述</option>
                        <option value="citation_present">至少一处法律依据引用</option>
                      </select>
                    </div>
                    {criterion.checkKind === "clause_present" ? (
                      <div className="lm-playbook-clause-types">
                        {CLAUSE_TYPES.map((type) => (
                          <label key={type}>
                            <input
                              type="checkbox"
                              checked={criterion.clauseTypes.includes(type)}
                              onChange={(e) =>
                                patchCriterion(index, {
                                  clauseTypes: e.target.checked
                                    ? [...criterion.clauseTypes, type]
                                    : criterion.clauseTypes.filter((item) => item !== type),
                                })
                              }
                            />
                            {CLAUSE_TYPE_LABELS[type]}
                          </label>
                        ))}
                      </div>
                    ) : null}
                    {criterion.checkKind === "section_present" ? (
                      <label className="lm-settings-field">
                        <span className="lm-settings-key">章节标题</span>
                        <textarea
                          className="lm-input"
                          rows={2}
                          value={criterion.headings}
                          data-testid={`lm-playbook-headings-${index}`}
                          placeholder="一行一个，如：诉讼请求 / 事实与理由"
                          onChange={(e) => patchCriterion(index, { headings: e.target.value })}
                        />
                      </label>
                    ) : null}
                    {criterion.checkKind === "phrase_present" ||
                    criterion.checkKind === "phrase_absent" ? (
                      <label className="lm-settings-field">
                        <span className="lm-settings-key">
                          {criterion.checkKind === "phrase_present" ? "必含表述" : "禁止表述"}
                        </span>
                        <textarea
                          className="lm-input"
                          rows={2}
                          value={criterion.phrases}
                          data-testid={`lm-playbook-phrases-${index}`}
                          placeholder="一行一条，逐字匹配；否定性检查只在命中时判不符合"
                          onChange={(e) => patchCriterion(index, { phrases: e.target.value })}
                        />
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="lm-settings-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  data-testid="lm-playbook-add-criterion"
                  disabled={draft.criteria.length >= 60}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      criteria: [
                        ...draft.criteria,
                        {
                          id: `c${draft.criteria.length + 1}`,
                          kind: "green",
                          title: "",
                          checkKind: "manual",
                          headings: "",
                          phrases: "",
                          clauseTypes: [],
                        },
                      ],
                    })
                  }
                >
                  加一条条件
                </button>
              </div>
            </div>

            <div className="lm-settings-actions">
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                data-testid="lm-playbook-save"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? "保存中…" : "保存"}
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid="lm-playbook-cancel"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setHint(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        {hint ? (
          <p className="lm-settings-caption" role="status" data-testid="lm-playbook-hint">
            {hint}
          </p>
        ) : null}
      </div>
    </details>
  );
}
