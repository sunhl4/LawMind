/**
 * 改稿页上的核对记录。只显示律师已经采信或退回的句子，不在这里改稿。
 */

import { useEffect, useState } from "react";
import type { AcceptanceSheet } from "../../../../src/lawmind/acceptance-sheet/model.ts";
import { apiGetJson } from "./api-client";

type Props = {
  apiBase: string;
  taskId: string;
};

export function LawmindAcceptanceMarkStrip(props: Props) {
  const { apiBase, taskId } = props;
  const [sheet, setSheet] = useState<AcceptanceSheet | null>(null);

  useEffect(() => {
    const base = apiBase.trim();
    const id = taskId.trim();
    if (!base || !id) {
      setSheet(null);
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{ sheet?: AcceptanceSheet | null }>(
      base,
      `/api/drafts/${encodeURIComponent(id)}/acceptance-sheet`,
    )
      .then((body) => {
        if (!cancelled) {
          setSheet(body.sheet ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSheet(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, taskId]);

  if (!sheet) {
    return null;
  }
  const accepted = sheet.claims.filter((claim) => claim.mark === "accepted");
  const weakened = sheet.claims.filter((claim) => claim.mark === "too_strong");
  if (accepted.length === 0 && weakened.length === 0) {
    return null;
  }
  const acceptedShown = accepted.slice(0, 4);
  const weakenedShown = weakened.slice(0, 4);

  return (
    <section className="lm-acceptance-marks" data-testid="lm-acceptance-marks" aria-label="核对记录">
      {accepted.length > 0 ? (
        <>
          <p>已采信 {accepted.length} 条</p>
          <ul>
            {acceptedShown.map((claim) => (
              <li key={claim.id}>{claim.text}</li>
            ))}
          </ul>
          {accepted.length > acceptedShown.length ? (
            <p>还有 {accepted.length - acceptedShown.length} 条已采信。回到对话后可打开核对纸。</p>
          ) : null}
        </>
      ) : null}
      {weakened.length > 0 ? (
        <>
          <p>已退回改弱 {weakened.length} 条</p>
          <ul>
            {weakenedShown.map((claim) => (
              <li key={claim.id}>{claim.text}</li>
            ))}
          </ul>
          {weakened.length > weakenedShown.length ? (
            <p>还有 {weakened.length - weakenedShown.length} 条已退回。回到对话后可打开核对纸。</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
