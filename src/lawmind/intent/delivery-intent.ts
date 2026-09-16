/**
 * Delivery constraints — orthogonal to capability bind.
 *
 * Capability answers *what job* (合同审查 vs 诉讼). Delivery answers *how to hand it
 * over*: new opinion memo vs tracked copy of the source, whether the original may
 * be mutated, and a lawyer-named place (桌面 / 下载 / 文稿).
 *
 * This layer exists so pipeline *defaults* (成套交件, Word 改稿 lock, workspace-only
 * writes) cannot contradict an instruction the model already understands. It does
 * **not** freeze the tool table. Tools stay available; the compiler only removes
 * contradictory completion conditions, honors named places, and forbids overwriting
 * the source file. Feature families, not one frozen phrase. Leaf (no fs).
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { isContractFastLaneInstruction } from "../platform/contract-fast-lane-instruction.js";
import { extractTextIntent } from "./text-intent.js";
import { instructionLooksLikeLetterQa } from "./utterance-kind.js";

export type DeliveryArtifactShape = "opinion_memo" | "tracked_source" | "unspecified";
export type DeliveryMutateSource = "forbid" | "allow" | "unspecified";
export type DeliveryOutputPlace = "desktop" | "downloads" | "documents" | "unspecified";
export type DeliveryChatMirror = "required" | "unspecified";

export type DeliveryIntent = {
  artifactShape: DeliveryArtifactShape;
  mutateSource: DeliveryMutateSource;
  outputPlace: DeliveryOutputPlace;
  chatMirror: DeliveryChatMirror;
};

export const UNSPECIFIED_DELIVERY: DeliveryIntent = {
  artifactShape: "unspecified",
  mutateSource: "unspecified",
  outputPlace: "unspecified",
  chatMirror: "unspecified",
};

export const DELIVERY_MARKER_OPINION_MEMO = "<!--lm-delivery:opinion_memo-->";
export const DELIVERY_MARKER_CHAT_QA = "<!--lm-delivery:chat_qa-->";

export const OPINION_MEMO_PIPELINE_HINT =
  "律师要一份新的意见书 Word（默认 .docx），原文件只读。优先 `draft_document` → `render_document`，并在会话写出完整意见。改稿工具仍可用；不要覆盖原稿，也不要把完成条件理解成必须出红线。";

/** The output *is* comments / an opinion memo, not a marked-up copy of the source. */
const OPINION_OBJECT_RE =
  /审查意见|审阅意见|修改建议|修改意见|意见书|点评意见|review comments|suggested (?:edits|changes|revisions)|comments? in a new/i;

const PRESERVE_SOURCE_RE =
  /不(?:要)?(?:在)?(?:源文件|原稿|原件|原(?:合同|文件|Word))上?(?:修改|改|动)|不(?:要)?(?:修改|改|动|覆盖)(?:原稿|原件|源文件|原(?:合同|文件))|原稿(?:别动|不动|不要改)|leave the original|(?:do not|don't) (?:modify|edit|change|alter) the (?:original|source)/i;

const NEW_FILE_RE =
  /新文档|另存|单独(?:一[份个]|出)|另写一[份个]|单独的?(?:word|Word|docx|文档)|a new (?:word |docx )?file/i;

const REDLINE_OBJECT_RE = /审阅痕迹|红线稿|修订稿|tracked changes|\bredline\b/i;

const DESKTOP_PLACE_RE =
  /(?:放|写|存|保存|输出|导出|输入)到(?:我的|系统)?桌面(?!端|应用|工作台)|(?:到|至)(?:我的)?桌面(?:上|里)?(?!端|应用|工作台)|(?:on|to|onto) (?:my |the )?desktop\b/i;

const DOWNLOADS_PLACE_RE =
  /(?:放|写|存|保存|输出|导出|输入)到(?:我的)?(?:下载(?:文件夹|目录)?|Downloads)|(?:to|into) (?:my )?downloads\b/i;

const DOCUMENTS_PLACE_RE =
  /(?:放|写|存|保存|输出|导出|输入)到(?:我的)?(?:文稿|文档文件夹)|(?:to|into) (?:my )?documents\b/i;

const BOTH_DELIVERABLES_RE =
  /意见.{0,6}(?:和|加|及|并).{0,6}(?:修订|红线|审阅痕迹)|(?:修订|红线).{0,6}(?:和|加|及|并).{0,6}意见/;

function outputPlaceOf(text: string): DeliveryOutputPlace {
  if (DESKTOP_PLACE_RE.test(text)) {
    return "desktop";
  }
  if (DOWNLOADS_PLACE_RE.test(text)) {
    return "downloads";
  }
  if (DOCUMENTS_PLACE_RE.test(text)) {
    return "documents";
  }
  return "unspecified";
}

function mutateSourceOf(text: string): DeliveryMutateSource {
  if (PRESERVE_SOURCE_RE.test(text)) {
    return "forbid";
  }
  if (/覆盖原件|直接改原件/.test(text)) {
    return "allow";
  }
  return "unspecified";
}

function artifactShapeOf(
  text: string,
  mutateSource: DeliveryMutateSource,
  outputPlace: DeliveryOutputPlace,
): DeliveryArtifactShape {
  const opinionObject = OPINION_OBJECT_RE.test(text);
  const weakOpinion = /意见/.test(text);
  const redlineObject = REDLINE_OBJECT_RE.test(text);
  const preserve = mutateSource === "forbid";
  const newFile = NEW_FILE_RE.test(text);
  const namedPlace = outputPlace !== "unspecified";
  const review = extractTextIntent(text).verbs.includes("review");
  if (BOTH_DELIVERABLES_RE.test(text)) {
    return "unspecified";
  }
  if (redlineObject && !opinionObject) {
    return "tracked_source";
  }
  const sidecarCue = preserve || newFile || namedPlace;
  if (
    opinionObject ||
    (weakOpinion && sidecarCue && !redlineObject) ||
    ((preserve || newFile) && review && !redlineObject)
  ) {
    return "opinion_memo";
  }
  return "unspecified";
}

export function extractDeliveryIntent(instruction: string | undefined): DeliveryIntent {
  const text = instruction?.trim() ?? "";
  if (!text) {
    return { ...UNSPECIFIED_DELIVERY };
  }
  const mutateSource = mutateSourceOf(text);
  const outputPlace = outputPlaceOf(text);
  const artifactShape = artifactShapeOf(text, mutateSource, outputPlace);
  return {
    artifactShape,
    mutateSource,
    outputPlace,
    chatMirror: artifactShape === "opinion_memo" ? "required" : "unspecified",
  };
}

export function deliveryPinsIncludeWord(pins: readonly ComposeContextPin[] | undefined): boolean {
  return (pins ?? []).some(
    (pin) => pin.pinKind === "file" && pin.kind === "file" && /\.docx?$/i.test(pin.relPath),
  );
}

/**
 * Turn-level delivery: 5-minute form always says 合同审查意见.
 * A Word pin means default paired (opinion + redline) unless the lawyer forbade mutating the source.
 */
export function resolveTurnDeliveryIntent(
  instruction: string | undefined,
  pins?: readonly ComposeContextPin[],
): DeliveryIntent {
  const delivery = extractDeliveryIntent(instruction);
  if (delivery.mutateSource === "forbid") {
    return delivery;
  }
  if (deliveryPinsIncludeWord(pins) && instruction && isContractFastLaneInstruction(instruction)) {
    return {
      ...delivery,
      artifactShape: "unspecified",
      chatMirror: "unspecified",
    };
  }
  return delivery;
}

export function isOpinionMemoDelivery(delivery: DeliveryIntent | undefined): boolean {
  return delivery?.artifactShape === "opinion_memo";
}

export function deliveryHasNamedPlace(delivery: DeliveryIntent | undefined): boolean {
  const place = delivery?.outputPlace;
  return place === "desktop" || place === "downloads" || place === "documents";
}

export function formatDeliveryConstraintPromptBlock(
  delivery: DeliveryIntent | undefined,
): string | undefined {
  if (!delivery) {
    return undefined;
  }
  const specified =
    delivery.artifactShape !== "unspecified" ||
    delivery.mutateSource === "forbid" ||
    deliveryHasNamedPlace(delivery);
  if (!specified) {
    return undefined;
  }
  const lines: string[] = [];
  if (delivery.artifactShape === "opinion_memo") {
    lines.push(DELIVERY_MARKER_OPINION_MEMO);
    lines.push("## 本轮交件形态（律师已指定）");
    lines.push(
      "- 交付物是一份**新的意见书 Word**（默认 `.docx`）。正文只有审查意见与修改建议，不要拷贝原合同再改。",
    );
    lines.push("- 原文件只读，不得覆盖。不要把完成条件理解成必须出审阅痕迹修订稿。");
    lines.push("- 会话里写出完整意见（结论、风险、建议），不能只给文件路径。");
    lines.push(
      "- 优先 `draft_document` → `render_document`。工具表不收窄；若律师随后要红线，仍可改稿。",
    );
  } else {
    lines.push("## 本轮交件形态（律师已指定）");
    if (delivery.mutateSource === "forbid") {
      lines.push("- 原文件只读，不要覆盖原稿。");
    }
    if (delivery.artifactShape === "tracked_source") {
      lines.push("- 交付物是带审阅痕迹的修订稿副本，不是意见书重建稿。");
    }
  }
  if (delivery.outputPlace === "desktop") {
    lines.push("- 落盘：系统桌面（引擎写入；不要改用工作区 artifacts 代替律师点名的位置）。");
  } else if (delivery.outputPlace === "downloads") {
    lines.push("- 落盘：系统下载文件夹（引擎写入）。");
  } else if (delivery.outputPlace === "documents") {
    lines.push("- 落盘：系统文稿文件夹（引擎写入）。");
  }
  return lines.join("\n");
}

/** 已有函核对：交付是会话意见，不是另起一稿。 */
export function formatChatQaDeliveryPromptBlock(instruction: string): string | undefined {
  if (!instructionLooksLikeLetterQa(instruction)) {
    return undefined;
  }
  return [
    DELIVERY_MARKER_CHAT_QA,
    "## 本轮交件形态",
    "- 交付物是会话里的核对意见：逐点对错、引用文件夹/函件出处、必要时给出建议改法。",
    "- 不要另起一封律师函 Word，不要出审阅痕迹稿，不要按合同审查成套交件。",
  ].join("\n");
}
