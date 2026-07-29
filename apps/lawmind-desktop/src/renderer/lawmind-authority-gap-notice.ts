/**
 * SSE tool_call_end → lawyer-facing 缺源 / 演示语料 Banner copy.
 * Single source: `src/lawmind/retrieval/authority-gap.ts`.
 */

import {
  formatAuthorityGapLawyerNotice,
  formatDemoCorpusLawyerNotice,
} from "../../../../src/lawmind/retrieval/authority-gap.ts";

/** Build notice when stream marks authorityGap; undefined when not a gap. */
export function noticeFromToolAuthorityGap(
  toolName: string,
  authorityGap?: boolean,
): string | undefined {
  if (authorityGap !== true) {
    return undefined;
  }
  return formatAuthorityGapLawyerNotice({ toolName });
}

/** Build notice when stream marks demoCorpus; undefined otherwise. */
export function noticeFromToolDemoCorpus(demoCorpus?: boolean): string | undefined {
  if (demoCorpus !== true) {
    return undefined;
  }
  return formatDemoCorpusLawyerNotice();
}
