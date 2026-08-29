/** Persist lawyer notes / verified flags for review matrix cells (per matter, local only). */

export type ReviewMatrixNoteStore = {
  notes: Record<string, string>;
  verified: Record<string, boolean>;
};

function storageKey(matterId: string): string {
  return `lawmind.reviewMatrix.notes.v1.${matterId}`;
}

export function loadReviewMatrixNotes(matterId: string): ReviewMatrixNoteStore {
  try {
    const raw = localStorage.getItem(storageKey(matterId));
    if (!raw) {
      return { notes: {}, verified: {} };
    }
    const parsed = JSON.parse(raw) as Partial<ReviewMatrixNoteStore>;
    return {
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      verified: parsed.verified && typeof parsed.verified === "object" ? parsed.verified : {},
    };
  } catch {
    return { notes: {}, verified: {} };
  }
}

export function saveReviewMatrixNotes(matterId: string, store: ReviewMatrixNoteStore): void {
  try {
    localStorage.setItem(storageKey(matterId), JSON.stringify(store));
  } catch {
    // quota / private mode — ignore
  }
}

export function matrixCellKey(documentId: string, questionId: string): string {
  return `${documentId}::${questionId}`;
}
