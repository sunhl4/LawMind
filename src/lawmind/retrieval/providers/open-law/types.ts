/**
 * Open-law corpus record (OSS path).
 * Compatible with exports converted from open datasets (e.g. NPC FLK dumps).
 */

export type OpenLawRecord = {
  id: string;
  title: string;
  kind?: "statute" | "case" | "regulation" | "other";
  citation?: string;
  /** Short passage for claims */
  excerpt?: string;
  /** Longer body for local keyword search */
  body?: string;
  url?: string;
  /** e.g. 现行有效 */
  status?: string;
  office?: string;
  tags?: string[];
  /**
   * When true (or tags include "demo"), external CORPUS hits are watermarks as 演示语料.
   * Bundled sample is always treated as demo regardless of this field.
   */
  demo?: boolean;
  /** Provider id for Doctor / attribution (e.g. open-law.local, open-law.npc_flk). */
  provider?: string;
  /** Corpus / dump id (e.g. bundled-sample, flk-dump, caseopen). */
  corpusId?: string;
  /** Short license / attribution note surfaced on hits. */
  licenseNote?: string;
};

/** Retrieval modes for openLawRetrieve. */
export type OpenLawMode =
  | "local"
  | "npc_flk"
  | "caseopen"
  | "courtlistener"
  | "eurlex"
  | "egov_jp"
  | "hybrid";

/** Live / local source ids used in Doctor + hit metadata. */
export type OpenLawSourceId =
  | "local_sample"
  | "local_corpus"
  | "npc_flk"
  | "caseopen"
  | "courtlistener"
  | "harvard_cap"
  | "eurlex"
  | "egov_jp";

export const OPEN_LAW_PROVIDER = {
  local: "open-law.local",
  npcFlk: "open-law.npc_flk",
  caseopen: "open-law.caseopen",
  courtlistener: "open-law.courtlistener",
  eurlex: "open-law.eurlex",
  egovJp: "open-law.egov_jp",
} as const;
