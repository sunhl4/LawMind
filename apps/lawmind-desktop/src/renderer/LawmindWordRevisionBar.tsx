/**
 * When a Word is pinned: lawyer confirms 文书类型 × 立场.
 * Writes explicit marker lines the engine already parses.
 */
import { useMemo, type ReactNode } from "react";
import {
  readWordRevisionMarkers,
  resolveWordRevisionChecklist,
  upsertWordRevisionMarkers,
  WORD_REVISION_FAMILY_IDS,
  WORD_REVISION_FAMILY_LABEL,
  WORD_REVISION_STANCES,
  type WordRevisionFamilyId,
  type WordRevisionStance,
} from "../../../../src/lawmind/platform/word-revision-core.ts";

export type LawmindWordRevisionBarProps = {
  composeInput: string;
  filePills: Array<{ relPath?: string; title?: string }>;
  onComposeInputChange: (text: string) => void;
};

export function shouldShowWordRevisionBar(opts: {
  composeInput: string;
  filePills: Array<{ relPath?: string; title?: string }>;
}): boolean {
  if (/改稿类型：|己方立场：/.test(opts.composeInput)) {
    return true;
  }
  return opts.filePills.some((p) => /\.docx?$/i.test(p.relPath ?? p.title ?? ""));
}

export function LawmindWordRevisionBar(props: LawmindWordRevisionBarProps): ReactNode {
  const { composeInput, filePills, onComposeInputChange } = props;
  const markers = useMemo(() => readWordRevisionMarkers(composeInput), [composeInput]);
  const hint = useMemo(
    () =>
      resolveWordRevisionChecklist({
        instruction: composeInput,
        pins: filePills
          .map((p) => p.relPath ?? p.title ?? "")
          .filter((rel) => rel.length > 0)
          .map((relPath) => ({
            pinKind: "file" as const,
            root: "workspace" as const,
            relPath,
            kind: "file" as const,
          })),
      }),
    [composeInput, filePills],
  );

  if (!shouldShowWordRevisionBar({ composeInput, filePills })) {
    return null;
  }

  const setFamily = (family: WordRevisionFamilyId | "") => {
    onComposeInputChange(upsertWordRevisionMarkers(composeInput, { family }));
  };
  const setStance = (stance: WordRevisionStance | "") => {
    onComposeInputChange(upsertWordRevisionMarkers(composeInput, { stance }));
  };

  const hintLine =
    !markers.family && hint.family && (hint.familySource === "hint" || hint.familySource === "inferred")
      ? `未点选时按${hint.familySource === "inferred" ? "合同正文" : "文件名或指令"}判断为「${hint.familyLabel}」，会套该类要点。点选则按你确认的类型。`
      : "未选时将按合同正文判断类型并套对应要点。点选则按你确认的类型。";

  return (
    <div
      className="lm-word-revision-bar"
      role="region"
      aria-label="Word 改稿类型与立场"
      data-testid="lm-word-revision-bar"
    >
      <div className="lm-contract-fast-lane-chips" role="group" aria-label="文书类型">
        <span className="lm-meta">类型</span>
        <button
          type="button"
          className={`lm-chip${!markers.family ? " lm-chip-active" : ""}`}
          data-testid="lm-word-rev-family-none"
          aria-pressed={!markers.family}
          onClick={() => setFamily("")}
        >
          未指定
        </button>
        {WORD_REVISION_FAMILY_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`lm-chip${markers.family === id ? " lm-chip-active" : ""}`}
            data-testid={`lm-word-rev-family-${id}`}
            aria-pressed={markers.family === id}
            onClick={() => setFamily(id)}
          >
            {WORD_REVISION_FAMILY_LABEL[id]}
          </button>
        ))}
      </div>
      <div className="lm-contract-fast-lane-chips" role="group" aria-label="己方立场">
        <span className="lm-meta">立场</span>
        <button
          type="button"
          className={`lm-chip${!markers.stance ? " lm-chip-active" : ""}`}
          data-testid="lm-word-rev-stance-none"
          aria-pressed={!markers.stance}
          onClick={() => setStance("")}
        >
          未指定
        </button>
        {WORD_REVISION_STANCES.map((id) => (
          <button
            key={id}
            type="button"
            className={`lm-chip${markers.stance === id ? " lm-chip-active" : ""}`}
            data-testid={`lm-word-rev-stance-${id}`}
            aria-pressed={markers.stance === id}
            onClick={() => setStance(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <p className="lm-meta" data-testid="lm-word-rev-hint">
        {hintLine}
      </p>
    </div>
  );
}
