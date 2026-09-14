/**
 * Intent compiler — Signal Extractor + ranker.
 *
 * Precedence (do not flatten into one regex):
 *  1. Hard nails: 办件 lock, mail short-path, Word 改稿 lock
 *  2. High-precision specialized text (劳动金额、期限、发票、传票…)
 *  3. Joint file-genre × verb  ← accuracy core
 *  4. Keyword / deliverable-type fallback (legacy router)
 *  5. Session continuation
 *  6. Matter kind as TIE-BREAK only (never overrides 2–3)
 *  7. Genre default when materials exist but the utterance is vague
 *
 * Fatal misbind pair: contract.review ↔ litigation.draft.
 * File pleading headers beat "合同" tokens in the body.
 */

import { isMailContractFastPathInstruction } from "../platform/mail-contract-short-path-instruction.js";
import { isWordRevisionTurn } from "../platform/word-revision-instruction.js";
import { isPublicWebFactLookup } from "../skills/capability-patterns.js";
import {
  deskItemById,
  parseCapabilityLock,
  type LawyerCapabilityId,
} from "../skills/lawyer-capability-lock.js";
import {
  classifyDocumentGenre,
  dominantDocumentGenre,
  genresConflictContractVsPleading,
  type DocumentGenre,
} from "./document-genre.js";
import {
  extractTextIntent,
  isContinuationUtterance,
  isCorrectionUtterance,
  isGreetingOnly,
} from "./text-intent.js";
import type {
  CompiledIntent,
  CompileIntentInput,
  DocumentPeek,
  IntentAlternative,
  IntentEvidence,
  IntentSignals,
  IntentSource,
} from "./types.js";

const WORD_REVISION_HINT =
  "拷贝原 Word → `apply_surgical_edits` → `render_tracked_draft` 写入源文件同目录（原名_日期_01）。禁止 `render_document` 重建，不要准备外发邮件。空修订不得导出。";

const SPECIALIZED_ID: Record<string, LawyerCapabilityId> = {
  labor: "labor.calc",
  period: "period.calc",
  invoice: "ops.invoice",
  court_sms: "ops.court_sms",
  ip: "ip.dispute",
  ma: "deal.ma",
  data: "compliance.data",
  ads: "compliance.ads",
  status: "matter.status",
  family: "family.matter",
  capital: "capital.markets",
  governance: "corp.governance",
  civil_stage: "litigation.draft",
  bankruptcy: "litigation.draft",
  criminal: "litigation.draft",
  intake: "matter.intake",
  talk: "litigation.talk",
  quick: "analysis.quick",
  compute_table: "materials.draft",
  research: "research.memo",
};

const GENRE_DEFAULT: Partial<Record<DocumentGenre, LawyerCapabilityId>> = {
  contract: "contract.review",
  pleading: "litigation.draft",
  letter: "letter.draft",
  invoice: "ops.invoice",
  court_notice: "ops.court_sms",
  talk: "litigation.talk",
  privacy: "compliance.data",
  ma: "deal.ma",
  capital: "capital.markets",
  evidence: "litigation.draft",
  spreadsheet: "materials.draft",
};

function emptyIntent(source: IntentSource, evidence: IntentEvidence[] = []): CompiledIntent {
  return {
    confidence: "low",
    source,
    evidence,
    alternatives: [],
    chain: [],
    lawyerSummary: "直接说事或附上材料即可，不必先选流程。",
  };
}

function labelOf(id: LawyerCapabilityId): string {
  return deskItemById(id)?.label ?? id;
}

function summaryFor(
  id: LawyerCapabilityId,
  evidence: IntentEvidence[],
  source: IntentSource,
): string {
  const fileBit = evidence.find((e) => e.kind === "file")?.detail;
  const via = source === "lock" ? "（按你的指定）" : fileBit ? `（${fileBit}）` : "";
  return `本轮按「${labelOf(id)}」处理${via}`;
}

function pinRelPaths(input: CompileIntentInput): string[] {
  const out: string[] = [];
  for (const pin of input.pins ?? []) {
    if ("relPath" in pin && typeof pin.relPath === "string" && pin.relPath.trim()) {
      if ("kind" in pin && pin.kind === "directory") {
        continue;
      }
      out.push(pin.relPath.trim());
    }
  }
  return out;
}

function instructionRelPaths(instruction: string): string[] {
  const out: string[] = [];
  const tick = /`([^`]+?\.[A-Za-z0-9]+)`/g;
  let m: RegExpExecArray | null = tick.exec(instruction);
  while (m) {
    if (m[1]) {
      out.push(m[1].trim());
    }
    m = tick.exec(instruction);
  }
  return out;
}

export function collectDocumentPeeks(input: CompileIntentInput): DocumentPeek[] {
  const byPath = new Map<string, DocumentPeek>();
  for (const p of input.documents ?? []) {
    if (p.relPath.trim()) {
      byPath.set(p.relPath.trim(), { relPath: p.relPath.trim(), peekText: p.peekText });
    }
  }
  for (const relPath of [...pinRelPaths(input), ...instructionRelPaths(input.instruction)]) {
    if (!byPath.has(relPath)) {
      byPath.set(relPath, { relPath });
    }
  }
  return [...byPath.values()];
}

export function extractIntentSignals(input: CompileIntentInput): IntentSignals {
  const instruction = input.instruction.trim();
  const docs = collectDocumentPeeks(input).map((d) => ({
    relPath: d.relPath,
    peekText: d.peekText ?? "",
    genre: classifyDocumentGenre(d.relPath, d.peekText ?? ""),
  }));
  return {
    instruction,
    text: extractTextIntent(instruction),
    documents: docs,
    dominantGenre: dominantDocumentGenre(docs.map((d) => d.genre)),
    hasMaterials: docs.length > 0,
    matterKind: input.matterKind,
    previousCapabilityId: input.previousCapabilityId,
  };
}

function fileEvidence(signals: IntentSignals): IntentEvidence[] {
  return signals.documents.slice(0, 3).map((d) => ({
    kind: "file" as const,
    detail: `${d.relPath.split(/[/\\]/).pop() ?? d.relPath} · ${genreZh(d.genre)}`,
  }));
}

function genreZh(genre: DocumentGenre): string {
  switch (genre) {
    case "contract":
      return "合同";
    case "pleading":
      return "诉讼文书";
    case "letter":
      return "函件";
    case "invoice":
      return "发票";
    case "court_notice":
      return "传票/开庭";
    case "talk":
      return "谈话";
    case "privacy":
      return "数据合规材料";
    case "ma":
      return "并购材料";
    case "capital":
      return "发行文件";
    case "evidence":
      return "证据";
    case "spreadsheet":
      return "表格";
    default:
      return "材料";
  }
}

function finish(
  id: LawyerCapabilityId,
  opts: {
    source: IntentSource;
    confidence: CompiledIntent["confidence"];
    evidence: IntentEvidence[];
    deliverableType?: string;
    pipelineOverride?: CompiledIntent["pipelineOverride"];
    skillIdsOverride?: readonly string[];
    pipelineHintOverride?: string;
    alternatives?: IntentAlternative[];
    chain?: LawyerCapabilityId[];
  },
): CompiledIntent {
  const chain = opts.chain?.length ? opts.chain : [id];
  const uniqueChain = [...new Set(chain)];
  return {
    capabilityId: id,
    deliverableType: opts.deliverableType,
    pipelineOverride: opts.pipelineOverride,
    skillIdsOverride: opts.skillIdsOverride,
    pipelineHintOverride: opts.pipelineHintOverride,
    confidence: opts.confidence,
    source: opts.source,
    evidence: opts.evidence,
    alternatives: opts.alternatives ?? [],
    chain: uniqueChain,
    lawyerSummary: summaryFor(id, opts.evidence, opts.source),
  };
}

function idForDeliverableType(dt: string): LawyerCapabilityId | undefined {
  if (dt === "contract.review") {
    return "contract.review";
  }
  if (dt === "contract.nda" || dt === "contract.rental" || dt === "contract.general") {
    return "contract.draft";
  }
  if (dt.startsWith("letter.")) {
    return "letter.draft";
  }
  if (dt.startsWith("litigation.")) {
    return "litigation.draft";
  }
  if (dt === "matter.timeline") {
    return "chronology.timeline";
  }
  if (dt === "labor.calc") {
    return "labor.calc";
  }
  if (dt === "period.calc") {
    return "period.calc";
  }
  if (dt === "analysis.table") {
    return "materials.draft";
  }
  if (dt === "memo.research") {
    return "research.memo";
  }
  if (dt.startsWith("report.") || dt === "ppt.training") {
    return "research.memo";
  }
  if (
    dt.startsWith("memo.") ||
    dt.startsWith("matter.") ||
    dt === "meeting.minutes" ||
    dt === "document.general"
  ) {
    return "materials.draft";
  }
  return undefined;
}

function keywordFallback(
  instruction: string,
  text: ReturnType<typeof extractTextIntent>,
  explicit?: string,
): { id: LawyerCapabilityId; deliverableType?: string } | undefined {
  if (explicit) {
    const id = idForDeliverableType(explicit);
    if (id) {
      return { id, deliverableType: explicit };
    }
  }
  if (/时间线|大事记|时间轴/.test(instruction)) {
    return { id: "chronology.timeline", deliverableType: "matter.timeline" };
  }
  if (text.wantsLetter && text.wantsContract && text.verbs.includes("review")) {
    return { id: "contract.review" };
  }
  if (text.wantsLetter || text.verbs.includes("letter")) {
    const demand = /催款|催告|demand/i.test(instruction);
    return { id: "letter.draft", deliverableType: demand ? "letter.demand" : undefined };
  }
  if (text.wantsPleading) {
    return { id: "litigation.draft" };
  }
  if (text.verbs.includes("draft") && text.wantsContract) {
    return { id: "contract.draft" };
  }
  if ((text.verbs.includes("review") || /审查|审阅|条款/.test(instruction)) && text.wantsContract) {
    return { id: "contract.review", deliverableType: "contract.review" };
  }
  if (text.verbs.includes("research")) {
    return { id: "research.memo" };
  }
  if (text.verbs.includes("ask")) {
    return { id: "analysis.quick" };
  }
  return undefined;
}

function jointRoute(
  signals: IntentSignals,
): { id: LawyerCapabilityId; deliverableType?: string } | undefined {
  const { text, dominantGenre, hasMaterials } = signals;
  const verbs = new Set(text.verbs);
  if (!hasMaterials && dominantGenre === "unknown") {
    return undefined;
  }

  if (dominantGenre === "invoice") {
    return { id: "ops.invoice" };
  }
  if (dominantGenre === "court_notice") {
    return { id: "ops.court_sms" };
  }
  if (dominantGenre === "talk") {
    return { id: "litigation.talk" };
  }
  if (dominantGenre === "privacy") {
    return { id: "compliance.data" };
  }
  if (dominantGenre === "ma") {
    return { id: "deal.ma" };
  }
  if (dominantGenre === "capital") {
    return { id: "capital.markets" };
  }
  if (dominantGenre === "spreadsheet") {
    return { id: "materials.draft", deliverableType: "analysis.table" };
  }

  if (dominantGenre === "letter" || (text.wantsLetter && hasMaterials)) {
    return { id: "letter.draft" };
  }

  if (dominantGenre === "pleading" || dominantGenre === "evidence") {
    return { id: "litigation.draft" };
  }

  if (dominantGenre === "contract") {
    if (verbs.has("letter") || text.wantsLetter) {
      return { id: "letter.draft" };
    }
    if (verbs.has("draft") && !verbs.has("review") && !verbs.has("redline")) {
      return { id: "contract.draft" };
    }
    return { id: "contract.review" };
  }

  return undefined;
}

function chainFor(id: LawyerCapabilityId, signals: IntentSignals): LawyerCapabilityId[] {
  const extra: LawyerCapabilityId[] = [];
  if (
    id === "contract.review" &&
    (signals.text.wantsLetter || signals.text.verbs.includes("letter"))
  ) {
    extra.push("letter.draft");
  }
  if (id === "litigation.draft" && signals.text.specialized === "talk") {
    extra.push("litigation.talk");
  }
  return extra;
}

function wordRevisionCapability(signals: IntentSignals): LawyerCapabilityId {
  const g = signals.dominantGenre;
  if (g === "pleading" || g === "evidence") {
    return "litigation.draft";
  }
  if (g === "letter") {
    return "letter.draft";
  }
  return "contract.review";
}

function wordRevisionDeliverable(id: LawyerCapabilityId): string | undefined {
  if (id === "contract.review") {
    return "contract.general";
  }
  if (id === "litigation.draft") {
    return "document.general";
  }
  if (id === "letter.draft") {
    return "letter.counsel";
  }
  return undefined;
}

/** Never return [] — empty override is treated as a real list by hydrateCompiledIntent. */
function wordRevisionSkillIds(id: LawyerCapabilityId): readonly string[] {
  if (id === "contract.review") {
    return ["contract-redline-craft"];
  }
  if (id === "letter.draft") {
    return ["delivery-language"];
  }
  if (id === "litigation.draft") {
    return ["complaint-elements-fill"];
  }
  return ["delivery-language"];
}

function silentMixedPaperPick(signals: IntentSignals): LawyerCapabilityId {
  const reviewContract = signals.text.wantsContract && signals.text.verbs.includes("review");
  const hasContractFile = signals.documents.some((d) => d.genre === "contract");
  if (reviewContract && hasContractFile) {
    return "contract.review";
  }
  return "litigation.draft";
}

/**
 * Compile lawyer text + files + case context into a capability bind.
 * Sync and deterministic — file peek is supplied by the caller.
 * Never asks the lawyer to pick a task type; mixed papers are resolved silently.
 */
export function compileIntent(input: CompileIntentInput): CompiledIntent {
  const instruction = input.instruction.trim();
  const lockedId = input.capabilityId ?? parseCapabilityLock(instruction);
  if (lockedId) {
    const item = deskItemById(lockedId);
    return finish(lockedId, {
      source: "lock",
      confidence: "high",
      evidence: [{ kind: "lock", detail: `指定 ${item?.label ?? lockedId}` }],
      deliverableType: input.deliverableType ?? item?.defaultDeliverableType,
    });
  }

  const mailFast = input.mailFastPath ?? isMailContractFastPathInstruction(instruction);
  if (mailFast) {
    return finish("mail.contract", {
      source: "short_path",
      confidence: "high",
      evidence: [{ kind: "text", detail: "邮件合同短路径" }],
      deliverableType: "contract.review",
    });
  }

  const signals = extractIntentSignals(input);
  const files = fileEvidence(signals);

  if (
    isWordRevisionTurn({
      instruction,
      pins: input.pins,
      historyText: input.historyText,
    })
  ) {
    const id = wordRevisionCapability(signals);
    return finish(id, {
      source: "word_revision",
      confidence: "high",
      evidence: files.length > 0 ? files : [{ kind: "file", detail: "已钉选 Word · 改稿" }],
      deliverableType: wordRevisionDeliverable(id),
      pipelineOverride: "tracked_redline",
      skillIdsOverride: wordRevisionSkillIds(id),
      pipelineHintOverride: WORD_REVISION_HINT,
    });
  }

  if (isPublicWebFactLookup(instruction)) {
    return emptyIntent("unbound", [{ kind: "text", detail: "公开网页事实，不绑法律办件" }]);
  }

  if (isGreetingOnly(instruction) && !signals.hasMaterials) {
    return emptyIntent("unbound");
  }

  if (isCorrectionUtterance(instruction) && !signals.hasMaterials) {
    return emptyIntent("unbound", [{ kind: "text", detail: "纠正上轮绑定" }]);
  }

  if ((!instruction || instruction.length < 2) && !signals.hasMaterials) {
    return emptyIntent("unbound");
  }

  const spec = signals.text.specialized;
  const specId = spec ? SPECIALIZED_ID[spec] : undefined;

  const joint = jointRoute(signals);
  const genres = signals.documents.map((d) => d.genre);
  const mixedPaper = genresConflictContractVsPleading(genres);

  if (specId && spec && spec !== "research" && spec !== "quick") {
    const dt =
      specId === "litigation.draft" && (spec === "civil_stage" || spec === "bankruptcy")
        ? "document.general"
        : specId === "materials.draft" && spec === "compute_table"
          ? "analysis.table"
          : undefined;
    return finish(specId, {
      source: "specialized",
      confidence: "high",
      evidence: [{ kind: "text", detail: spec }, ...files],
      deliverableType: dt,
      chain: [specId, ...chainFor(specId, signals)],
    });
  }

  if (mixedPaper && signals.text.wantsContract && signals.text.verbs.includes("review")) {
    const pick = silentMixedPaperPick(signals);
    return finish(pick, {
      source: "joint",
      confidence: pick === "contract.review" ? "medium" : "high",
      evidence: files,
      chain: [pick, ...chainFor(pick, signals)],
    });
  }

  const researchHasAuthorityCue = /法条|法规|民法典|刑法|司法解释|类案|裁判|条例/.test(instruction);
  if (spec === "research" && researchHasAuthorityCue) {
    return finish("research.memo", {
      source: "specialized",
      confidence: "high",
      evidence: [{ kind: "text", detail: "检索命题" }, ...files],
    });
  }

  if (
    joint &&
    specId &&
    (spec === "quick" || spec === "research") &&
    (joint.id === "contract.review" || joint.id === "litigation.draft")
  ) {
    return finish(joint.id, {
      source: "joint",
      confidence: "high",
      evidence: files,
      chain: [joint.id, ...chainFor(joint.id, signals)],
    });
  }

  if (joint) {
    return finish(joint.id, {
      source: "joint",
      confidence: signals.hasMaterials ? "high" : "medium",
      evidence: files.length > 0 ? files : [{ kind: "text", detail: "材料形态" }],
      deliverableType: joint.deliverableType,
      chain: [joint.id, ...chainFor(joint.id, signals)],
    });
  }

  if (specId) {
    return finish(specId, {
      source: "specialized",
      confidence: spec === "quick" || spec === "research" ? "medium" : "high",
      evidence: [{ kind: "text", detail: spec ?? "specialized" }, ...files],
      deliverableType:
        specId === "materials.draft" && spec === "compute_table" ? "analysis.table" : undefined,
      chain: [specId, ...chainFor(specId, signals)],
    });
  }

  const kw = keywordFallback(instruction, signals.text, input.deliverableType);
  if (kw) {
    return finish(kw.id, {
      source: "keyword",
      confidence: "medium",
      evidence: [{ kind: "text", detail: kw.deliverableType ?? kw.id }, ...files],
      deliverableType: kw.deliverableType,
      chain: [kw.id, ...chainFor(kw.id, signals)],
    });
  }

  if (
    input.previousCapabilityId &&
    isContinuationUtterance(instruction) &&
    !isCorrectionUtterance(instruction) &&
    !signals.text.wantsPleading &&
    signals.text.specialized === null
  ) {
    return finish(input.previousCapabilityId, {
      source: "continue",
      confidence: "medium",
      evidence: [{ kind: "session", detail: `续作 ${labelOf(input.previousCapabilityId)}` }],
    });
  }

  if (signals.hasMaterials && GENRE_DEFAULT[signals.dominantGenre]) {
    const id = GENRE_DEFAULT[signals.dominantGenre]!;
    return finish(id, {
      source: "genre_default",
      confidence: "medium",
      evidence: files,
      chain: [id, ...chainFor(id, signals)],
    });
  }

  if (
    signals.matterKind === "litigation" &&
    signals.hasMaterials &&
    (signals.text.vague || signals.text.verbs.includes("vague"))
  ) {
    return finish("litigation.draft", {
      source: "matter",
      confidence: "low",
      evidence: [{ kind: "matter", detail: "本案为诉讼门类" }, ...files],
    });
  }
  if (
    signals.matterKind === "contract" &&
    signals.hasMaterials &&
    (signals.text.vague ||
      signals.text.verbs.includes("vague") ||
      signals.text.verbs.includes("review"))
  ) {
    return finish("contract.review", {
      source: "matter",
      confidence: "low",
      evidence: [{ kind: "matter", detail: "本案为合同门类" }, ...files],
    });
  }

  if (instruction.length >= 4 && !isGreetingOnly(instruction)) {
    return emptyIntent("unbound", [{ kind: "text", detail: "未匹配产品化能力" }]);
  }
  return emptyIntent("unbound");
}

export function compiledIntentPlanItems(compiled: CompiledIntent): string[] {
  if (compiled.chain.length < 2) {
    return [];
  }
  return compiled.chain.map((id) => labelOf(id)).slice(0, 8);
}
