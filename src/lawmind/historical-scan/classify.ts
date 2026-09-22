import type { HistoricalDocKind, HistoricalLayout } from "./types.js";

const MESSY_DIR_RE = /^(desktop|downloads?|download|桌面|下载|未分类|杂项|temp|tmp)$/i;

export function classifyDocKind(fileName: string): HistoricalDocKind {
  const name = fileName.toLowerCase();
  if (/合同|协议|nda|保密|框架协|补充协议/.test(name)) {
    return "contract";
  }
  if (/起诉|答辩|上诉|判决|裁定|仲裁申请|代理词/.test(name)) {
    return "litigation";
  }
  if (/证据|发票|回单|银行|鉴定|笔录/.test(name)) {
    return "evidence";
  }
  if (/函|催告|通知|邮件|email/.test(name)) {
    return "correspondence";
  }
  return "other";
}

export function classifyLayout(parentDirName: string, filesInFolder: number): HistoricalLayout {
  if (MESSY_DIR_RE.test(parentDirName.trim()) || filesInFolder < 2) {
    return "messy";
  }
  return "organized";
}

export function proposedMatterLabel(
  parentDirName: string,
  layout: HistoricalLayout,
): string | undefined {
  if (layout !== "organized") {
    return undefined;
  }
  const label = parentDirName.trim();
  return label && !MESSY_DIR_RE.test(label) ? label : undefined;
}
