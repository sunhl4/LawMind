/**
 * Lawyer-maintained 案由词表. Not a national classifier — candidates only.
 */

import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";

export const CAUSE_LEXICON_REL = path.join("lawmind", "cause-lexicon.json");

export const DEFAULT_CAUSE_LEXICON = [
  "买卖合同纠纷",
  "租赁合同纠纷",
  "民间借贷纠纷",
  "劳动争议",
  "劳动合同纠纷",
  "服务合同纠纷",
  "建设工程合同纠纷",
  "侵权责任纠纷",
  "离婚纠纷",
  "知识产权权属、侵权纠纷",
] as const;

export type CauseLexicon = {
  causes: string[];
  updatedAt?: string;
};

export function causeLexiconPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), CAUSE_LEXICON_REL);
}

export function loadCauseLexicon(workspaceDir: string): CauseLexicon {
  const file = causeLexiconPath(workspaceDir);
  try {
    if (!fs.existsSync(file)) {
      return { causes: [...DEFAULT_CAUSE_LEXICON] };
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { causes?: unknown };
    const causes = Array.isArray(parsed.causes)
      ? parsed.causes
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 80)
      : [...DEFAULT_CAUSE_LEXICON];
    return { causes: causes.length > 0 ? causes : [...DEFAULT_CAUSE_LEXICON] };
  } catch {
    return { causes: [...DEFAULT_CAUSE_LEXICON] };
  }
}

export async function saveCauseLexicon(
  workspaceDir: string,
  causes: string[],
): Promise<CauseLexicon> {
  const next: CauseLexicon = {
    causes: causes
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 80),
    updatedAt: new Date().toISOString(),
  };
  const file = causeLexiconPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeFileAtomicAsync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export type CauseCandidate = {
  label: string;
  reason: string;
};

export function suggestCauseCandidates(text: string, lexicon: CauseLexicon): CauseCandidate[] {
  const hay = text.trim();
  if (!hay) {
    return [];
  }
  const hits: CauseCandidate[] = [];
  for (const label of lexicon.causes) {
    const stem = label.replace(/纠纷$/, "");
    if (hay.includes(label) || (stem.length >= 2 && hay.includes(stem))) {
      hits.push({ label, reason: `材料或谈话中出现「${stem}」` });
    }
  }
  if (/拖欠工资|被开除|劳动合同/.test(hay) && !hits.some((h) => /劳动/.test(h.label))) {
    hits.push({ label: "劳动争议", reason: "谈话含用工报酬或解除" });
  }
  if (/借钱|不还|利息|借条/.test(hay) && !hits.some((h) => /借贷/.test(h.label))) {
    hits.push({ label: "民间借贷纠纷", reason: "谈话含出借与未还" });
  }
  if (/货|货款|买卖/.test(hay) && !hits.some((h) => /买卖/.test(h.label))) {
    hits.push({ label: "买卖合同纠纷", reason: "谈话含货物或货款" });
  }
  return hits.slice(0, 5);
}
