/**
 * Read binary Word (.doc) without Word, WPS, or any system grant.
 *
 * The container is OLE Compound File. Text lives in the `WordDocument` stream;
 * the piece table (`0Table` / `1Table`, pointed to by the FIB) says where each
 * run sits. We rebuild the document text from that table instead of converting
 * the whole file. Encoding is UTF-16LE or code-page-1252 per piece.
 *
 * Tracked changes: when the document was saved with revisions, deleted and
 * inserted runs carry `PropRMark` in CHPX/PAPX. We read the author table
 * (`SttbfRMark`) and the property FKPs, then return both the accepted text
 * and the per-run revision spans so the .docx writer can emit `w:del` / `w:ins`.
 */

import fs from "node:fs";
import path from "node:path";
import { ensureLocalFile } from "../runtime/icloud-materialize.js";

/**
 * 去掉 Word 二进制里的控制字符。
 *
 * `.doc` 正文里夹着域标记（0x13 开始 / 0x14 分隔 / 0x15 结束）、图片 0x01、
 * 单元格 0x07、手动换行 0x0B、分页 0x0C 等。它们既不能进 `analyze_document`
 * 的正文，也不能进 `.docx`（0x00–0x08 不是合法 XML 字符，写进 docx 会打不开）。
 *
 * 域按 Word 的语义处理：指令段（0x13–0x14）整段丢弃，只留结果段，
 * 这样 `PAGE \* MERGEFORMAT` 不会再变成正文。
 */
export function stripWordControlChars(raw: string): string {
  let out = "";
  let inInstruction = false;
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code === 0x13) {
      inInstruction = true;
      continue;
    }
    if (code === 0x14) {
      inInstruction = false;
      continue;
    }
    if (code === 0x15) {
      inInstruction = false;
      continue;
    }
    if (inInstruction) {
      continue;
    }
    if (code === 0x07) {
      out += "\t";
      continue;
    }
    if (code === 0x0b || code === 0x0c) {
      out += "\n";
      continue;
    }
    if (code === 0x1e) {
      out += "-";
      continue;
    }
    if (code === 0x1f || code === 0x0e) {
      continue;
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }
    if (code === 0xfffc || code === 0xfffd) {
      continue;
    }
    out += ch;
  }
  return out;
}

function normalizeText(raw: string): string {
  return stripWordControlChars(raw)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True for binary Word 97–2003 `.doc` (not `.docx`). */
export function isBinaryWordDocPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".doc";
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const SECTOR_SHIFT = 9;
const FREE_SECT = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;

type CfbEntry = { name: string; bytes: Uint8Array };

function readCfbStreams(bytes: Uint8Array): CfbEntry[] {
  if (bytes.length < 512 || !OLE_MAGIC.every((b, i) => bytes[i] === b)) {
    return [];
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorSize = 1 << (view.getUint16(30, true) || SECTOR_SHIFT);
  const miniSectorSize = 1 << (view.getUint16(32, true) || 6);
  const fatSectorCount = view.getUint32(44, true);
  const firstDirectorySector = view.getUint32(48, true);
  const miniCutoff = view.getUint32(56, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const miniFatSectorCount = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const difatSectorCount = view.getUint32(72, true);
  const headerDifat = Array.from({ length: 109 }, (_, i) => view.getUint32(76 + i * 4, true));
  const sectorOffset = (sect: number) => 512 + sect * sectorSize;

  const difatSectors = headerDifat.filter((s) => s !== FREE_SECT);
  let nextDifat = firstDifatSector;
  for (let i = 0; i < difatSectorCount && nextDifat !== END_OF_CHAIN; i += 1) {
    const off = sectorOffset(nextDifat);
    for (let j = 0; j < sectorSize / 4 - 1; j += 1) {
      difatSectors.push(view.getUint32(off + j * 4, true));
    }
    nextDifat = view.getUint32(off + sectorSize - 4, true);
  }
  const fatSectors = difatSectors.filter((s) => s !== FREE_SECT).slice(0, fatSectorCount);
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((sect, i) => {
    const off = sectorOffset(sect);
    for (let j = 0; j < sectorSize / 4; j += 1) {
      fat[i * (sectorSize / 4) + j] = view.getUint32(off + j * 4, true);
    }
  });

  function chainBytes(start: number, limit: number): Uint8Array {
    const out = new Uint8Array(limit);
    let cursor = start;
    let written = 0;
    let guard = 0;
    while (
      cursor !== END_OF_CHAIN &&
      cursor !== FREE_SECT &&
      guard < fat.length &&
      written < limit
    ) {
      const off = sectorOffset(cursor);
      const take = Math.min(sectorSize, limit - written);
      out.set(bytes.subarray(off, off + take), written);
      written += take;
      cursor = fat[cursor] ?? END_OF_CHAIN;
      guard += 1;
    }
    return out.subarray(0, written);
  }

  const directoryBytes = chainBytes(firstDirectorySector, sectorSize * 512);
  const entries: Array<{ name: string; size: number; start: number; type: number }> = [];
  for (let off = 0; off + 128 <= directoryBytes.length; off += 128) {
    const nameLen = directoryBytes[off + 64] | (directoryBytes[off + 65] << 8);
    if (nameLen < 2) {
      continue;
    }
    const nameChars: string[] = [];
    for (let i = 0; i + 1 < nameLen - 2; i += 2) {
      nameChars.push(
        String.fromCharCode(directoryBytes[off + i] | (directoryBytes[off + i + 1] << 8)),
      );
    }
    const name = nameChars.join("");
    const type = directoryBytes[off + 66];
    const start = new DataView(directoryBytes.buffer, directoryBytes.byteOffset).getUint32(
      off + 116,
      true,
    );
    const size = new DataView(directoryBytes.buffer, directoryBytes.byteOffset).getUint32(
      off + 120,
      true,
    );
    entries.push({ name, size, start, type });
  }
  const root = entries.find((e) => e.type === 5);
  if (!root) {
    return [];
  }
  const miniStream = chainBytes(root.start, root.size);
  const miniFatBytes = chainBytes(firstMiniFatSector, miniFatSectorCount * sectorSize);
  const miniFat = new Uint32Array(miniFatBytes.length / 4);
  for (let i = 0; i < miniFat.length; i += 1) {
    miniFat[i] = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset).getUint32(i * 4, true);
  }

  function miniChainBytes(start: number, limit: number): Uint8Array {
    const out = new Uint8Array(limit);
    let cursor = start;
    let written = 0;
    let guard = 0;
    while (
      cursor !== END_OF_CHAIN &&
      cursor !== FREE_SECT &&
      guard < miniFat.length &&
      written < limit
    ) {
      const off = cursor * miniSectorSize;
      const take = Math.min(miniSectorSize, limit - written);
      out.set(miniStream.subarray(off, off + take), written);
      written += take;
      cursor = miniFat[cursor] ?? END_OF_CHAIN;
      guard += 1;
    }
    return out.subarray(0, written);
  }

  const out: CfbEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== 2) {
      continue;
    }
    const bytesForEntry =
      entry.size < miniCutoff
        ? miniChainBytes(entry.start, entry.size)
        : chainBytes(entry.start, entry.size);
    out.push({ name: entry.name, bytes: bytesForEntry });
  }
  return out;
}

const CP1252_EXTRA: Record<number, string> = {
  0x80: "\u20ac",
  0x82: "\u201a",
  0x83: "\u0192",
  0x84: "\u201e",
  0x85: "\u2026",
  0x86: "\u2020",
  0x87: "\u2021",
  0x88: "\u02c6",
  0x89: "\u2030",
  0x8a: "\u0160",
  0x8b: "\u2039",
  0x8c: "\u0152",
  0x8e: "\u017d",
  0x91: "\u2018",
  0x92: "\u2019",
  0x93: "\u201c",
  0x94: "\u201d",
  0x95: "\u2022",
  0x96: "\u2013",
  0x97: "\u2014",
  0x98: "\u02dc",
  0x99: "\u2122",
  0x9a: "\u0161",
  0x9b: "\u203a",
  0x9c: "\u0153",
  0x9e: "\u017e",
  0x9f: "\u0178",
};

function decodeCp1252(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b < 0x80 || b >= 0xa0) {
      out += String.fromCharCode(b);
      continue;
    }
    out += CP1252_EXTRA[b] ?? String.fromCharCode(b);
  }
  return out;
}

type FibInfo = {
  tableStream: "0Table" | "1Table";
  fcMin: number;
  fcMac: number;
  fcClx: number;
  lcbClx: number;
  fcSttbfRMark: number;
  lcbSttbfRMark: number;
  fcPlcfBteChpx: number;
  lcbPlcfBteChpx: number;
  fcPlcfBtePapx: number;
  lcbPlcfBtePapx: number;
  fcDop: number;
  lcbDop: number;
};

function parseFib(bytes: Uint8Array): FibInfo | null {
  if (bytes.length < 512) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint16(0, true);
  if (magic !== 0xa5ec) {
    return null;
  }
  // nFib < 0xC1 是 Word 6/95 及更早：FIB 对的索引与 CLX 布局都不同，不能按 97 解析。
  const nFib = view.getUint16(2, true);
  if (nFib < 0xc1) {
    return null;
  }
  const flags = view.getUint16(0x0a, true);
  // fEncrypted：正文是加密的，抽出来会是乱码，不猜密码。
  if ((flags & 0x0100) !== 0) {
    return null;
  }
  const tableStream = (flags & 0x0200) !== 0 ? "1Table" : "0Table";
  const fcMin = view.getUint32(0x18, true);
  const fcMac = view.getUint32(0x1c, true);
  if (fcMac <= fcMin) {
    return null;
  }
  const base = 32;
  const csw = view.getUint16(base, true);
  const fibRgWEnd = base + 2 + csw * 2;
  const cslw = view.getUint16(fibRgWEnd, true);
  const fibRgLwEnd = fibRgWEnd + 2 + cslw * 4;
  const pairsStart = fibRgLwEnd + 2;
  const pair = (index: number) => ({
    fc: view.getUint32(pairsStart + index * 8, true),
    lcb: view.getUint32(pairsStart + index * 8 + 4, true),
  });
  const p = (i: number) => pair(i);
  return {
    tableStream,
    fcMin,
    fcMac,
    fcClx: p(33).fc,
    lcbClx: p(33).lcb,
    fcSttbfRMark: p(74).fc,
    lcbSttbfRMark: p(74).lcb,
    fcPlcfBteChpx: p(12).fc,
    lcbPlcfBteChpx: p(12).lcb,
    fcPlcfBtePapx: p(13).fc,
    lcbPlcfBtePapx: p(13).lcb,
    fcDop: p(31).fc,
    lcbDop: p(31).lcb,
  };
}

export type DocRevisionSpan = {
  cpStart: number;
  cpEnd: number;
  kind: "ins" | "del";
  author: string;
  date?: string;
  text: string;
};

export type DocTextWithRevisions = {
  /** Accepted text (no deleted runs). */
  acceptedText: string;
  /** Every piece-table run, with the revision it carries (if any). */
  runs: Array<{
    text: string;
    revision?: Omit<DocRevisionSpan, "text">;
  }>;
  /** Revisions found in the source .doc, in document order. */
  revisions: DocRevisionSpan[];
  hasTrackedChanges: boolean;
};

type PieceRun = {
  cpStart: number;
  cpEnd: number;
  text: string;
  fc: number;
  isAnsi: boolean;
};

function parsePieceTable(
  table: Uint8Array,
  fib: FibInfo,
  wordDocument: Uint8Array,
): { pieces: PieceRun[] } | null {
  const clx = table.subarray(fib.fcClx, fib.fcClx + fib.lcbClx);
  const view = new DataView(clx.buffer, clx.byteOffset, clx.byteLength);
  let cursor = 0;
  let pcdt = null as null | { start: number; size: number };
  while (cursor < clx.length) {
    const kind = clx[cursor];
    if (kind === 0x01) {
      if (cursor + 3 > clx.length) {
        break;
      }
      const skip = view.getUint16(cursor + 1, true);
      cursor += 3 + skip;
    } else if (kind === 0x02) {
      if (cursor + 5 > clx.length) {
        break;
      }
      const size = view.getUint32(cursor + 1, true);
      pcdt = { start: cursor + 5, size };
      break;
    } else {
      break;
    }
  }
  if (!pcdt) {
    return null;
  }
  const pieces = (pcdt.size - 4) / 12;
  if (pieces <= 0) {
    return null;
  }
  const cps: number[] = [];
  for (let i = 0; i <= pieces; i += 1) {
    cps.push(view.getUint32(pcdt.start + i * 4, true));
  }
  const runs: PieceRun[] = [];
  for (let i = 0; i < pieces; i += 1) {
    const pcdStart = pcdt.start + (pieces + 1) * 4 + i * 8;
    if (pcdStart + 8 > clx.length) {
      break;
    }
    const pcd = clx.subarray(pcdStart, pcdStart + 8);
    const cpStart = cps[i] ?? 0;
    const cpEnd = cps[i + 1] ?? 0;
    const cpCount = cpEnd - cpStart;
    const view2 = new DataView(pcd.buffer, pcd.byteOffset, pcd.byteLength);
    const fcRaw = view2.getUint32(2, true);
    const isAnsi = (fcRaw & 0x40000000) !== 0;
    const fc = isAnsi ? (fcRaw & 0x3fffffff) >> 1 : fcRaw;
    const rawText = isAnsi
      ? decodeCp1252(wordDocument.subarray(fc, fc + cpCount))
      : Buffer.from(wordDocument.subarray(fc, fc + cpCount * 2)).toString("utf16le");
    runs.push({ cpStart, cpEnd, text: stripWordControlChars(rawText), fc, isAnsi });
  }
  return { pieces: runs };
}

/** ATRD 尾部固定 12 字节：ibst(2) + ak(4) + grfbmc(2) + lTagBkmk(4)。 */
const ATRD_TAIL_BYTES = 12;

function parseSttbfRMark(table: Uint8Array, fib: FibInfo): string[] {
  if (fib.lcbSttbfRMark === 0) {
    return [];
  }
  const bytes = table.subarray(fib.fcSttbfRMark, fib.fcSttbfRMark + fib.lcbSttbfRMark);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(0, true);
  const authors: string[] = [];
  let cursor = 2;
  for (let i = 0; i < count && cursor + 2 <= bytes.length; i += 1) {
    // 每条：cch(2) + 名字(cch*2) + 12 字节尾部。ibst 指的就是这里的下标。
    const cch = view.getUint16(cursor, true);
    cursor += 2;
    if (cch === 0 || cursor + cch * 2 > bytes.length) {
      break;
    }
    const chars = bytes.subarray(cursor, cursor + cch * 2);
    authors.push(Buffer.from(chars).toString("utf16le").replace(/\0+$/, ""));
    cursor += cch * 2 + ATRD_TAIL_BYTES;
  }
  return authors;
}

/** DTTM 不是 unix 秒：位段为 分/时/日/月/年（自 1900）。 */
function dttmToIso(dttm: number): string | undefined {
  if (!dttm) {
    return undefined;
  }
  const minute = dttm & 0x3f;
  const hour = (dttm >> 6) & 0x1f;
  const day = (dttm >> 11) & 0x1f;
  const month = (dttm >> 16) & 0x0f;
  // 位宽：分6 / 时5 / 日5 / 月4 / 年9（自1900）/ 星期3。
  const year = ((dttm >> 20) & 0x1ff) + 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** FC（WordDocument 里的字节位置）→ CP（字符位置）。ANSI piece 每字符 1 字节。 */
function fcToCp(pieces: PieceRun[], fc: number): number | null {
  for (const piece of pieces) {
    const bytesPerChar = piece.isAnsi ? 1 : 2;
    const byteEnd = piece.fc + (piece.cpEnd - piece.cpStart) * bytesPerChar;
    if (fc < piece.fc || fc > byteEnd) {
      continue;
    }
    return piece.cpStart + Math.floor((fc - piece.fc) / bytesPerChar);
  }
  return null;
}

/** sprm 编号（[MS-DOC] 2.6.1）：插入 0x0801、删除 0x0800、作者 0x4804、时间 0x6805。 */
const SPRM_F_RMARK_DEL = 0x0800;
const SPRM_F_RMARK = 0x0801;
const SPRM_IBST_RMARK = 0x4804;
const SPRM_DTTM_RMARK = 0x6805;

/**
 * spra 推操作数长度。spra=6 是变长：先一字节长度，长度本身不算操作数。
 * 返回操作数起点与长度；无法确定时返回 null。
 */
function readSpanAfterSprm(
  op: number,
  chpx: Uint8Array,
  cursor: number,
): { start: number; size: number } | null {
  const spra = (op >> 13) & 0x7;
  if (spra === 6) {
    if (cursor >= chpx.length) {
      return null;
    }
    return { start: cursor + 1, size: chpx[cursor] ?? 0 };
  }
  const size = { 0: 1, 1: 1, 2: 2, 3: 4, 4: 2, 5: 2, 7: 3 }[spra];
  return size == null ? null : { start: cursor, size };
}

function parsePlcfBte(
  table: Uint8Array,
  fib: FibInfo,
  wordDocument: Uint8Array,
  authors: string[],
  pieces: PieceRun[],
): DocRevisionSpan[] {
  const spans: DocRevisionSpan[] = [];
  if (fib.lcbPlcfBteChpx === 0) {
    return spans;
  }
  const plcf = table.subarray(fib.fcPlcfBteChpx, fib.fcPlcfBteChpx + fib.lcbPlcfBteChpx);
  const view = new DataView(plcf.buffer, plcf.byteOffset, plcf.byteLength);
  const count = Math.floor((fib.lcbPlcfBteChpx - 4) / 8);
  if (count <= 0) {
    return spans;
  }
  const pnOffset = (count + 1) * 4;
  for (let i = 0; i < count; i += 1) {
    const pn = view.getUint32(pnOffset + i * 4, true) & 0x3fffff;
    const fkpStart = pn * 512;
    if (fkpStart + 512 > wordDocument.length) {
      continue;
    }
    const fkp = wordDocument.subarray(fkpStart, fkpStart + 512);
    const fkpView = new DataView(fkp.buffer, fkp.byteOffset, fkp.byteLength);
    const crun = fkp[511];
    if (!crun || crun > 100) {
      continue;
    }
    // ChpxFkp：rgfc (crun+1)*4 字节，紧跟 crun 个 1 字节偏移；CHPX 在页内 b*2 处。
    const bBase = (crun + 1) * 4;
    for (let r = 0; r < crun; r += 1) {
      const b = fkp[bBase + r];
      if (!b) {
        continue;
      }
      const chpxOffset = b * 2;
      if (chpxOffset >= 511) {
        continue;
      }
      const cb = fkp[chpxOffset];
      if (!cb) {
        continue;
      }
      // rgfc 是 FC，不是 CP；一页里可以有多条修订，必须逐 run 换算。
      const cpStart = fcToCp(pieces, fkpView.getUint32(r * 4, true));
      const cpEnd = fcToCp(pieces, fkpView.getUint32((r + 1) * 4, true));
      if (cpStart == null || cpEnd == null || cpEnd <= cpStart) {
        continue;
      }
      const chpx = fkp.subarray(chpxOffset + 1, chpxOffset + 1 + cb);
      const span = parseChpxForRMark(chpx, authors, cpStart, cpEnd, pieces);
      if (span) {
        spans.push(span);
      }
    }
  }
  return spans;
}

function parseChpxForRMark(
  chpx: Uint8Array,
  authors: string[],
  cpStart: number,
  cpEnd: number,
  pieces: PieceRun[],
): DocRevisionSpan | null {
  const view = new DataView(chpx.buffer, chpx.byteOffset, chpx.byteLength);
  let cursor = 0;
  let ibst: number | undefined;
  let dttm: number | undefined;
  let inserted = false;
  let deleted = false;
  while (cursor + 2 <= chpx.length) {
    const op = view.getUint16(cursor, true);
    cursor += 2;
    const span = readSpanAfterSprm(op, chpx, cursor);
    if (!span || span.start + span.size > chpx.length) {
      break;
    }
    if (op === SPRM_F_RMARK && (chpx[span.start] ?? 0) !== 0) {
      inserted = true;
    } else if (op === SPRM_F_RMARK_DEL && (chpx[span.start] ?? 0) !== 0) {
      deleted = true;
    } else if (op === SPRM_IBST_RMARK && span.size >= 2) {
      ibst = view.getUint16(span.start, true);
    } else if (op === SPRM_DTTM_RMARK && span.size >= 4) {
      dttm = view.getUint32(span.start, true);
    }
    cursor = span.start + span.size;
  }
  if (!inserted && !deleted) {
    return null;
  }
  const author = (ibst != null ? authors[ibst] : undefined) ?? "修订";
  const date = dttm != null ? dttmToIso(dttm) : undefined;
  const piece = pieces.find((p) => p.cpStart === cpStart && p.cpEnd === cpEnd);
  if (!piece) {
    return null;
  }
  return {
    cpStart,
    cpEnd,
    kind: deleted ? "del" : "ins",
    author,
    ...(date ? { date } : {}),
    text: piece.text,
  };
}

export function extractTextWithRevisionsFromDocBytes(fileBytes: Uint8Array): DocTextWithRevisions {
  const streams = readCfbStreams(fileBytes);
  const wordDocument = streams.find((s) => s.name === "WordDocument")?.bytes;
  if (!wordDocument) {
    return { acceptedText: "", runs: [], revisions: [], hasTrackedChanges: false };
  }
  const fib = parseFib(wordDocument);
  if (!fib) {
    return { acceptedText: "", runs: [], revisions: [], hasTrackedChanges: false };
  }
  const table = streams.find((s) => s.name === fib.tableStream)?.bytes;
  if (!table || fib.lcbClx === 0) {
    return { acceptedText: "", runs: [], revisions: [], hasTrackedChanges: false };
  }
  const parsed = parsePieceTable(table, fib, wordDocument);
  if (!parsed) {
    return { acceptedText: "", runs: [], revisions: [], hasTrackedChanges: false };
  }
  const authors = parseSttbfRMark(table, fib);
  const revisionSpans = parsePlcfBte(table, fib, wordDocument, authors, parsed.pieces);
  const hasTrackedChanges = revisionSpans.length > 0;
  const deletedCps = new Set(
    revisionSpans.filter((r) => r.kind === "del").map((r) => `${r.cpStart}:${r.cpEnd}`),
  );
  const runs = parsed.pieces.map((p) => {
    const revision = revisionSpans.find((r) => r.cpStart === p.cpStart && r.cpEnd === p.cpEnd);
    return {
      text: p.text,
      ...(revision
        ? {
            revision: {
              cpStart: revision.cpStart,
              cpEnd: revision.cpEnd,
              kind: revision.kind,
              author: revision.author,
              ...(revision.date ? { date: revision.date } : {}),
            },
          }
        : {}),
    };
  });
  // Accepted text = 保留插入、去掉删除。这与 Word「接受全部修订」后看到的一致。
  const acceptedText = parsed.pieces
    .filter((p) => !deletedCps.has(`${p.cpStart}:${p.cpEnd}`))
    .map((p) => p.text)
    .join("");
  return { acceptedText, runs, revisions: revisionSpans, hasTrackedChanges };
}

export function extractTextFromDocBytes(fileBytes: Uint8Array): string {
  return extractTextWithRevisionsFromDocBytes(fileBytes).acceptedText;
}

/**
 * Read a binary `.doc` without touching Word or WPS and without asking the OS.
 * Returns the body text with Word control codes removed (page/field markers stripped).
 */
export async function readBinaryWordDocText(
  absPath: string,
  _opts?: { signal?: AbortSignal },
): Promise<string> {
  await ensureLocalFile(absPath);
  const bytes = await fs.promises.readFile(absPath);
  const text = extractTextFromDocBytes(bytes);
  return normalizeText(text);
}

/**
 * Read a binary `.doc` and return both the accepted text and any tracked-change
 * spans found in the file. Used by the .docx renderer to preserve revisions.
 */
export async function readBinaryWordDocWithRevisions(
  absPath: string,
  _opts?: { signal?: AbortSignal },
): Promise<DocTextWithRevisions> {
  await ensureLocalFile(absPath);
  const bytes = await fs.promises.readFile(absPath);
  return extractTextWithRevisionsFromDocBytes(bytes);
}
