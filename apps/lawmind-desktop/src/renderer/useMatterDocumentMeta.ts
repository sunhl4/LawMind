import { useEffect, useMemo, useState } from "react";
import { apiGetJson } from "./api-client";
import {
  findLatestProvenanceEvent,
  type ProvenanceChain,
} from "../../../../src/lawmind/drafts/provenance.ts";
import { formatTimelineDay } from "./lawmind-lawyer-desk-format";

export type MatterDocumentMeta = {
  lawyerEditedLabel?: string;
  outboundAttachment?: boolean;
};

function lawyerEditedLabelFromDraft(draft: {
  sections?: Array<{ provenance?: ProvenanceChain }>;
}): string | undefined {
  for (const section of draft.sections ?? []) {
    const ev = findLatestProvenanceEvent(section.provenance, "lawyer_edit");
    if (ev?.timestamp) {
      return `你 ${formatTimelineDay(ev.timestamp)} 改过后未再动`;
    }
  }
  return undefined;
}

function pathMatchesAttachment(outputPath: string, attachment: string): boolean {
  const a = attachment.trim();
  const o = outputPath.trim();
  if (!a || !o) {
    return false;
  }
  return a === o || a.endsWith(o) || o.endsWith(a);
}

export function useMatterDocumentMeta(
  apiBase: string,
  matterId: string | null | undefined,
  documents: Array<{ taskId?: string; outputPath?: string }>,
  outboundAttachments: string[],
): Map<string, MatterDocumentMeta> {
  const docsKey = useMemo(
    () =>
      documents
        .filter((d) => d.taskId?.trim())
        .map((d) => `${d.taskId}\0${d.outputPath ?? ""}`)
        .join("\n"),
    [documents],
  );
  const attachKey = useMemo(() => outboundAttachments.join("\n"), [outboundAttachments]);
  const [metaByTask, setMetaByTask] = useState<Map<string, MatterDocumentMeta>>(new Map());

  useEffect(() => {
    const mid = matterId?.trim();
    if (!mid || !apiBase || !docsKey) {
      setMetaByTask((prev) => (prev.size === 0 ? prev : new Map()));
      return undefined;
    }
    const docs = docsKey.split("\n").map((line) => {
      const [taskId, outputPath] = line.split("\0");
      return { taskId: taskId ?? "", outputPath: outputPath || undefined };
    });
    const attachments = attachKey ? attachKey.split("\n") : [];
    let cancelled = false;
    void Promise.all(
      docs.map(async (doc) => {
        const taskId = doc.taskId;
        const outboundAttachment = Boolean(
          doc.outputPath?.trim() &&
            attachments.some((a) => pathMatchesAttachment(doc.outputPath as string, a)),
        );
        try {
          const j = await apiGetJson<{
            draft?: { sections?: Array<{ provenance?: ProvenanceChain }> };
          }>(apiBase, `/api/drafts/${encodeURIComponent(taskId)}`);
          const lawyerEditedLabel = j.draft ? lawyerEditedLabelFromDraft(j.draft) : undefined;
          return {
            taskId,
            meta: { lawyerEditedLabel, outboundAttachment } satisfies MatterDocumentMeta,
          };
        } catch {
          return { taskId, meta: { outboundAttachment } satisfies MatterDocumentMeta };
        }
      }),
    ).then((rows) => {
      if (cancelled) {
        return;
      }
      const next = new Map<string, MatterDocumentMeta>();
      for (const row of rows) {
        next.set(row.taskId, row.meta);
      }
      setMetaByTask(next);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId, docsKey, attachKey]);

  return metaByTask;
}
