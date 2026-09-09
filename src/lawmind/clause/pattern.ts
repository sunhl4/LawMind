/**
 * 条款模式（ClausePattern）定义。
 * 模式用于描述「如何识别并提取一类结构化条款」。
 * 待执业法律顾问复核：触发词与捕获正则目前由工程启发式构造，正式使用前应经法律样本校准。
 */

import type { Clause, ClauseType } from "./ast.js";

export type ClauseTrigger = string | RegExp;

export interface CaptureSpec {
  /** 用于识别标题/条款起点的正则；命中整行为标题。 */
  headingRe?: RegExp;
  /**
   * 用于从正文中提取子块正则。
   * 若包含命名捕获组 `body`，则取该组作为子块正文；否则取整条匹配。
   */
  bodyRe?: RegExp;
}

export interface ExtractCtx {
  docText: string;
  /** 当前文本片段在 docText 中的起始行（1-based） */
  lineOffset: number;
  /** 当前文本片段在 docText 中的起始字符偏移 */
  charOffset: number;
  /** 父条款（子模式提取时存在） */
  parent?: Clause;
  /** 可用模式表 */
  patterns: ClausePattern[];
}

export type ClauseExtractor = (text: string, ctx: ExtractCtx) => Partial<Clause> | null;

export interface ClausePattern {
  type: ClauseType;
  /** 人类可读名称，也用作子条款标题 */
  name: string;
  /** 触发词：字符串做包含匹配，正则做 test 匹配 */
  triggers: ClauseTrigger[];
  /** 可选捕获说明 */
  capture?: CaptureSpec;
  /** 子模式（如违约责任下的赔偿上限） */
  children?: ClausePattern[];
  /** 复杂语义提取器；返回 Partial<Clause>，剩余字段由提取器填充 */
  extractor?: ClauseExtractor;
}

/** 命中第一个触发词，返回匹配位置与原文。 */
export function findFirstTrigger(
  text: string,
  triggers: ClauseTrigger[],
): { index: number; text: string } | undefined {
  for (const trigger of triggers) {
    if (typeof trigger === "string") {
      const index = text.indexOf(trigger);
      if (index >= 0) {
        return { index, text: trigger };
      }
      continue;
    }
    // 去 g 标志防止状态残留，并避免无索引匹配
    const flags = trigger.flags.replace("g", "");
    const re = new RegExp(trigger.source, flags);
    const m = re.exec(text);
    if (m && m.index >= 0) {
      return { index: m.index, text: m[0] ?? "" };
    }
  }
  return undefined;
}

/** 判断文本是否命中任一触发词。 */
export function matchesTrigger(text: string, triggers: ClauseTrigger[]): boolean {
  return findFirstTrigger(text, triggers) !== undefined;
}

/** 用 bodyRe 从文本中提取子块正文。 */
export function extractCaptureBody(text: string, capture?: CaptureSpec): string {
  if (!capture?.bodyRe) {
    return text.slice(0, Math.min(200, text.length));
  }
  const flags = capture.bodyRe.flags.replace("g", "");
  const re = new RegExp(capture.bodyRe.source, flags);
  const m = re.exec(text);
  if (!m) {
    return text.slice(0, Math.min(200, text.length));
  }
  const groups = m.groups as Record<string, string> | undefined;
  if (groups?.body) {
    return groups.body;
  }
  return m[0] ?? "";
}

export type { ClauseType } from "./ast.js";
