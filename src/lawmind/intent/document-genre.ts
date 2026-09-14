/**
 * Deterministic document-genre classifier.
 *
 * Accuracy rules (do not invert):
 * 1. Filename of a pleading beats contract-like clauses in the body
 *    (起诉状 quotes 合同 all the time).
 * 2. Pleading headers in the peek (诉讼请求 / 原告 / 被告) beat a
 *    generic *协议.docx filename.
 * 3. Sticky genres (pleading, invoice, court notice, letter, talk) win
 *    over a pile of unknown attachments when the instruction is vague.
 * 4. Never use a lone 合同/协议 token in peek to override a pleading.
 */

export type DocumentGenre =
  | "contract"
  | "pleading"
  | "letter"
  | "invoice"
  | "court_notice"
  | "talk"
  | "evidence"
  | "privacy"
  | "ma"
  | "capital"
  | "spreadsheet"
  | "unknown";

const BASE_RE = /[/\\]([^/\\]+)$/;

export function fileBaseName(relPath: string): string {
  const trimmed = relPath.trim();
  const m = BASE_RE.exec(trimmed.replace(/\\/g, "/"));
  return (m?.[1] ?? trimmed).trim();
}

function filenameStem(relPath: string): string {
  return fileBaseName(relPath).replace(/\.[^.]+$/, "");
}

const FILENAME_RULES: Array<{ genre: DocumentGenre; re: RegExp }> = [
  { genre: "invoice", re: /发票|增值税专用|进项|销项|invoice/i },
  { genre: "court_notice", re: /传票|开庭通知|开庭传票|12368|缴费通知|应诉通知/ },
  { genre: "talk", re: /谈话记录|谈话笔录|会议纪要|客户口述|intake.?notes/i },
  { genre: "letter", re: /律师函|催告函|催款函|通知函|demand.?letter/i },
  {
    genre: "pleading",
    re: /起诉状|起诉书|答辩状|上诉状|代理词|辩护词|执行异议|执行复议|立案材料|民事起诉|仲裁申请/,
  },
  { genre: "privacy", re: /隐私政策|个人信息保护|数据出境|PIPL|隐私条款/i },
  { genre: "ma", re: /尽调|尽职调查|交割清单|股权收购|资产收购|SPA\b/i },
  { genre: "capital", re: /招股说明书|募集说明书|信息披露|再融资/ },
  { genre: "evidence", re: /证据目录|证据清单|证据清单|书证|证人证言/ },
  {
    genre: "contract",
    re: /买卖合同|采购合同|租赁合同|服务合同|保密协议|框架协议|补充协议|劳动合同|NDA\b|合同|协议/i,
  },
];

const PLEADING_HEADER_RE =
  /(民事起诉状|行政起诉状|刑事自诉状|答辩状|上诉状|诉讼请求|事实与理由|原告[：:]|被告[：:]|上诉人[：:]|被上诉人[：:])/;
const CONTRACT_STRUCTURE_RE = /(甲方|乙方).{0,40}(甲方|乙方)|(鉴于|违约责任|合同编号|协议编号)/;
const LETTER_BODY_RE = /(律师函|催告函|此致[\s\S]{0,40}律师事务所|敬启者)/;
const INVOICE_BODY_RE = /(增值税专用发票|发票代码|发票号码|价税合计)/;
const COURT_BODY_RE = /(开庭传票|传票|12368|定于.{0,20}开庭|应到庭)/;
const TALK_BODY_RE = /(谈话记录|客户口述|会议纪要|整理如下)/;
const PRIVACY_BODY_RE = /(个人信息保护|处理者|数据出境|隐私政策)/;

export function classifyDocumentGenre(relPath: string, peekText = ""): DocumentGenre {
  const name = fileBaseName(relPath);
  if (/\.(xlsx|csv)$/i.test(name)) {
    return "spreadsheet";
  }

  const stem = filenameStem(relPath);
  let fromName: DocumentGenre = "unknown";
  for (const rule of FILENAME_RULES) {
    if (rule.re.test(stem) || rule.re.test(name)) {
      fromName = rule.genre;
      break;
    }
  }

  const peek = peekText.slice(0, 8000);
  if (peek) {
    // Pleading headers always win: complaints quote 合同 / 发票号码 all the time.
    if (PLEADING_HEADER_RE.test(peek) || fromName === "pleading") {
      return "pleading";
    }
    // Other peek upgrades may only classify an unknown filename.
    // Never steal 买卖合同.docx because the body mentions an invoice number.
    if (fromName === "unknown") {
      if (INVOICE_BODY_RE.test(peek)) {
        return "invoice";
      }
      if (COURT_BODY_RE.test(peek)) {
        return "court_notice";
      }
      if (LETTER_BODY_RE.test(peek)) {
        return "letter";
      }
      if (TALK_BODY_RE.test(peek)) {
        return "talk";
      }
      if (PRIVACY_BODY_RE.test(peek)) {
        return "privacy";
      }
      if (CONTRACT_STRUCTURE_RE.test(peek)) {
        return "contract";
      }
    }
  }

  return fromName;
}

const STICKY_RANK: Record<DocumentGenre, number> = {
  court_notice: 90,
  invoice: 85,
  pleading: 80,
  letter: 70,
  talk: 65,
  privacy: 55,
  ma: 50,
  capital: 50,
  evidence: 45,
  contract: 40,
  spreadsheet: 30,
  unknown: 0,
};

export function dominantDocumentGenre(genres: readonly DocumentGenre[]): DocumentGenre {
  if (genres.length === 0) {
    return "unknown";
  }
  const sticky = genres
    .filter((g) => STICKY_RANK[g] >= 45)
    .toSorted((a, b) => STICKY_RANK[b] - STICKY_RANK[a]);
  if (sticky[0]) {
    return sticky[0];
  }
  const counts = new Map<DocumentGenre, number>();
  for (const g of genres) {
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best: DocumentGenre = "unknown";
  let bestN = 0;
  for (const [g, n] of counts) {
    if (n > bestN || (n === bestN && STICKY_RANK[g] > STICKY_RANK[best])) {
      best = g;
      bestN = n;
    }
  }
  return best;
}

export function genresConflictContractVsPleading(genres: readonly DocumentGenre[]): boolean {
  return genres.includes("contract") && genres.includes("pleading");
}

/**
 * Contract-family 改稿要点 packs are for 买卖/采购/章程 Word.
 * Pleadings and letters still use the tracked-redline tool lock, not those packs.
 */
export function wordRevisionShouldInjectFamilyChecklist(
  instruction: string,
  fileRelPaths: readonly string[] = [],
): boolean {
  const genres: DocumentGenre[] = fileRelPaths.map((p) => classifyDocumentGenre(p));
  const tick = /`([^`]+?\.[A-Za-z0-9]+)`/g;
  let m: RegExpExecArray | null = tick.exec(instruction);
  while (m) {
    if (m[1]) {
      genres.push(classifyDocumentGenre(m[1]));
    }
    m = tick.exec(instruction);
  }
  const g = dominantDocumentGenre(genres);
  return g !== "pleading" && g !== "letter" && g !== "evidence";
}
