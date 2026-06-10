/**
 * Matter tabular review matrix (Suzie Law–style): documents × diligence questions.
 */

import fs from "node:fs";
import path from "node:path";
import { readDraft } from "../drafts/index.js";
import { readResearchSnapshot } from "../drafts/research-snapshot.js";
import { listTaskRecords } from "../tasks/index.js";

export type ReviewMatrixQuestion = {
  id: string;
  label: string;
  hint?: string;
};

export const DEFAULT_REVIEW_MATRIX_QUESTIONS: ReviewMatrixQuestion[] = [
  { id: "q-parties", label: "当事人与主体", hint: "签约方、保证人、关联方" },
  { id: "q-term", label: "核心商业条款", hint: "标的、价格、期限" },
  { id: "q-risk", label: "风险与责任", hint: "违约、赔偿、免责" },
  { id: "q-ip", label: "知识产权", hint: "归属、许可、侵权" },
  { id: "q-terminate", label: "解除与终止", hint: "触发条件、后果" },
  { id: "q-governing", label: "争议解决", hint: "管辖、法律适用" },
  { id: "q-misc", label: "其他需律师确认", hint: "未覆盖事项" },
];

export type ReviewMatrixDocument = {
  documentId: string;
  title: string;
  taskId: string;
  sourceId?: string;
  kind: "draft" | "source";
};

export type ReviewMatrixCell = {
  documentId: string;
  questionId: string;
  excerpt: string;
  status: "empty" | "suggested" | "verified";
};

export type MatterReviewMatrix = {
  matterId: string;
  questions: ReviewMatrixQuestion[];
  documents: ReviewMatrixDocument[];
  cells: ReviewMatrixCell[];
};

const QUESTION_KEYWORDS: Record<string, string[]> = {
  "q-parties": ["当事人", "甲方", "乙方", "双方", "签署"],
  "q-term": ["价款", "价格", "期限", "交付", "付款"],
  "q-risk": ["违约", "赔偿", "责任", "损失", "免责"],
  "q-ip": ["知识产权", "专利", "著作权", "许可"],
  "q-terminate": ["解除", "终止", "到期"],
  "q-governing": ["管辖", "仲裁", "争议", "适用法"],
};

function excerptForQuestion(text: string, questionId: string, maxLen = 220): string {
  const body = text.replace(/\s+/g, " ").trim();
  if (!body) {
    return "";
  }
  const keys = QUESTION_KEYWORDS[questionId] ?? [];
  for (const kw of keys) {
    const idx = body.indexOf(kw);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const slice = body.slice(start, start + maxLen);
      return slice.length < body.length ? `${slice}…` : slice;
    }
  }
  return body.length > maxLen ? `${body.slice(0, maxLen)}…` : body;
}

function buildCells(
  documents: ReviewMatrixDocument[],
  questions: ReviewMatrixQuestion[],
  textByDoc: Map<string, string>,
): ReviewMatrixCell[] {
  const cells: ReviewMatrixCell[] = [];
  for (const doc of documents) {
    const text = textByDoc.get(doc.documentId) ?? "";
    for (const q of questions) {
      const excerpt = excerptForQuestion(text, q.id);
      cells.push({
        documentId: doc.documentId,
        questionId: q.id,
        excerpt,
        status: excerpt ? "suggested" : "empty",
      });
    }
  }
  return cells;
}

export function buildMatterReviewMatrix(
  workspaceDir: string,
  matterId: string,
  questions: ReviewMatrixQuestion[] = DEFAULT_REVIEW_MATRIX_QUESTIONS,
): MatterReviewMatrix {
  const documents: ReviewMatrixDocument[] = [];
  const textByDoc = new Map<string, string>();

  const tasks = listTaskRecords(workspaceDir).filter((t) => t.matterId === matterId);

  for (const task of tasks) {
    const draft = readDraft(workspaceDir, task.taskId);
    if (!draft) {
      continue;
    }
    const draftId = `draft:${task.taskId}`;
    documents.push({
      documentId: draftId,
      title: draft.title?.trim() || task.taskId,
      taskId: task.taskId,
      kind: "draft",
    });
    const body = draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
    textByDoc.set(draftId, body);

    const bundle = readResearchSnapshot(workspaceDir, task.taskId);
    if (!bundle?.sources) {
      continue;
    }
    for (const src of bundle.sources) {
      const docId = `source:${task.taskId}:${src.id}`;
      documents.push({
        documentId: docId,
        title: src.title?.trim() || src.id,
        taskId: task.taskId,
        sourceId: src.id,
        kind: "source",
      });
      const text = [src.title, src.citation, src.url].filter(Boolean).join("\n");
      textByDoc.set(docId, text);
    }
  }

  // Project files under cases/<matterId>/ (light scan)
  const caseDir = path.join(workspaceDir, "cases", matterId);
  try {
    const names = fs.readdirSync(caseDir).filter((n) => /\.(md|txt|pdf)$/i.test(n));
    for (const name of names.slice(0, 10)) {
      const docId = `file:${name}`;
      documents.push({
        documentId: docId,
        title: name,
        taskId: "",
        kind: "source",
      });
      try {
        const raw = fs.readFileSync(path.join(caseDir, name), "utf8");
        textByDoc.set(docId, raw.slice(0, 8000));
      } catch {
        textByDoc.set(docId, "");
      }
    }
  } catch {
    // no case dir
  }

  return {
    matterId,
    questions,
    documents,
    cells: buildCells(documents, questions, textByDoc),
  };
}
