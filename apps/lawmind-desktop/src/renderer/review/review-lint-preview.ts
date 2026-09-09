/**
 * 审核台 lint / 自检预览：按正文内容 memo，正文变化时 debounce 后再重跑。
 * 批注框击键只触发重渲染、正文未变，lint 不重跑；正文真正变化时防抖合并为一次。
 */
import { useEffect, useMemo, useState } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { draftTextFromUnknown, runLegalLint } from "../../../../../src/lawmind/lint/run-lint.ts";
import { previewSelfRevise } from "../../../../../src/lawmind/lint/self-revise.ts";

export const REVIEW_LINT_DEBOUNCE_MS = 400;

export function useReviewLintPreview(detail: ArtifactDraft, debounceMs = REVIEW_LINT_DEBOUNCE_MS) {
  const draftText = draftTextFromUnknown(detail);
  // analyzedText 滞后于 draftText：debounce 结束后才推进，lint 只对推进后的文本各跑一次。
  const [analyzedText, setAnalyzedText] = useState(draftText);

  useEffect(() => {
    if (analyzedText === draftText) {
      return;
    }
    const timer = setTimeout(() => setAnalyzedText(draftText), debounceMs);
    return () => clearTimeout(timer);
  }, [analyzedText, draftText, debounceMs]);

  return useMemo(() => {
    const deliverableType = detail.deliverableType;
    const lintReport = runLegalLint(analyzedText, undefined, undefined, undefined, { deliverableType });
    const selfRevisePreview =
      analyzedText.trim().length >= 20
        ? previewSelfRevise(analyzedText, { deliverableType })
        : null;
    return { lintReport, selfRevisePreview };
  }, [analyzedText, detail.deliverableType]);
}
