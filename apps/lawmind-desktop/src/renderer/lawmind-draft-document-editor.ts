import type { ArtifactDraft, ArtifactSection } from "../../../../src/lawmind/types.ts";

export type DraftDocumentEditorSection = {
  heading: string;
  body: string;
  citations?: string[];
  provenance?: ArtifactSection["provenance"];
};

export type DraftDocumentEditorValue = {
  title: string;
  summary: string;
  sections: DraftDocumentEditorSection[];
};

export function draftDocumentEditorValueFromDraft(draft: ArtifactDraft): DraftDocumentEditorValue {
  return {
    title: draft.title ?? "",
    summary: draft.summary ?? "",
    sections: (draft.sections ?? []).map((section) => ({
      heading: section.heading,
      body: section.body,
      citations: section.citations?.length ? [...section.citations] : undefined,
      provenance: section.provenance,
    })),
  };
}

export function draftDocumentEditorValuesEqual(
  a: DraftDocumentEditorValue,
  b: DraftDocumentEditorValue,
): boolean {
  if (a.title !== b.title || a.summary !== b.summary || a.sections.length !== b.sections.length) {
    return false;
  }
  return a.sections.every((section, index) => {
    const other = b.sections[index];
    if (!other) {
      return false;
    }
    if (section.heading !== other.heading || section.body !== other.body) {
      return false;
    }
    const leftCites = section.citations ?? [];
    const rightCites = other.citations ?? [];
    return leftCites.length === rightCites.length && leftCites.every((cite, i) => cite === rightCites[i]);
  });
}

export function isDraftDocumentEditable(reviewStatus: ArtifactDraft["reviewStatus"] | undefined): boolean {
  const status = reviewStatus ?? "pending";
  return status === "pending" || status === "modified";
}

export function draftDocumentEditorValueToPatch(value: DraftDocumentEditorValue): {
  title: string;
  summary: string;
  sections: ArtifactSection[];
} {
  return {
    title: value.title.trim(),
    summary: value.summary,
    sections: value.sections.map((section) => ({
      heading: section.heading.trim(),
      body: section.body,
      ...(section.citations?.length ? { citations: [...section.citations] } : {}),
      ...(section.provenance ? { provenance: section.provenance } : {}),
    })),
  };
}
