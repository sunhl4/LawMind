/**
 * .docx 级别的修订对账：交付前后逐条比对 w:ins / w:del。
 *
 * 只读两个文件，不修改任何一方。调用方决定「不一致时是否拒交」。
 */

import fs from "node:fs/promises";
import JSZip from "jszip";
import {
  compareRevisionPreservation,
  explainRevisionPreservation,
  snapshotDocumentRevisions,
  type RevisionPreservation,
} from "./preservation.js";

export async function readDocxDocumentXml(absPath: string): Promise<string | undefined> {
  try {
    const zip = await JSZip.loadAsync(await fs.readFile(absPath));
    const file = zip.file("word/document.xml");
    return file ? await file.async("string") : undefined;
  } catch {
    return undefined;
  }
}

export type DocxRevisionPreservation = RevisionPreservation & {
  /** 两侧至少有一侧读不出来：结论是「无法核验」，不是「通过」。 */
  verified: boolean;
  note?: string;
};

/** 对账两份 .docx 的修订条目。读不出来时 `verified=false`，绝不当作通过。 */
export async function verifyDocxRevisionPreservation(params: {
  beforeAbs: string;
  afterAbs: string;
}): Promise<DocxRevisionPreservation> {
  const [beforeXml, afterXml] = await Promise.all([
    readDocxDocumentXml(params.beforeAbs),
    readDocxDocumentXml(params.afterAbs),
  ]);
  if (beforeXml == null || afterXml == null) {
    return {
      ok: false,
      verified: false,
      missing: [],
      altered: [],
      alteredInsertions: [],
      renumbered: [],
      dateOnlyChanges: [],
      added: [],
      beforeCount: 0,
      afterCount: 0,
      note:
        beforeXml == null
          ? "读不出原件正文，无法核对原有修订是否保留。"
          : "读不出交付件正文，无法核对原有修订是否保留。",
    };
  }
  const before = snapshotDocumentRevisions(beforeXml);
  const result = compareRevisionPreservation(before, snapshotDocumentRevisions(afterXml));
  return {
    ...result,
    verified: true,
    ...(result.ok ? {} : { note: explainRevisionPreservation(result) }),
  };
}

/** 只看一份 .docx 里有多少条修订（转换后至少能说明「有没有带过来」）。 */
export async function countDocxRevisions(
  absPath: string,
): Promise<{ ok: boolean; count: number; authors: string[] }> {
  const xml = await readDocxDocumentXml(absPath);
  if (xml == null) {
    return { ok: false, count: 0, authors: [] };
  }
  const revisions = snapshotDocumentRevisions(xml);
  return {
    ok: true,
    count: revisions.length,
    authors: [...new Set(revisions.map((item) => item.author).filter(Boolean))],
  };
}
