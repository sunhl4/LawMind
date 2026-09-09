/**
 * 条款解析 DSL 的 AST 定义。
 * 注释使用中文；关键法律语义假设标注「待执业法律顾问复核」。
 */

export type ClauseType =
  | "definition"
  | "obligation"
  | "right"
  | "liability"
  | "dispute"
  | "general";

export const CLAUSE_TYPES: ClauseType[] = [
  "definition",
  "obligation",
  "right",
  "liability",
  "dispute",
  "general",
];

export interface SourceRange {
  /** 1-based 起始行 */
  startLine: number;
  /** 1-based 结束行（含） */
  endLine: number;
  /** 在原始文本中的起始字符偏移 */
  startChar: number;
  /** 在原始文本中的结束字符偏移（含） */
  endChar: number;
}

/** 引用：条款、段落或定义术语。 */
export interface Reference {
  kind: "article" | "term" | "previous" | "above";
  /** 目标：article 为条号字符串，term 为术语，previous/above 为占位标识 */
  target: string;
  /** 引用所在条款 id */
  clauseId: string;
  /** 原文片段 */
  text: string;
  sourceRange?: SourceRange;
}

export interface Clause {
  /** 本条款在文档中的唯一标识 */
  id: string;
  type: ClauseType;
  /** 标题，通常来自条号后的文字 */
  title: string;
  /** 正文（不含标题行） */
  body: string;
  /** 子条款（如违约责任下的赔偿上限） */
  children: Clause[];
  sourceRange: SourceRange;
  /** 第 N 条中的规范条号；若非条号式标题则为 undefined */
  articleNo?: number;
  /** 本条款给出的定义 key（如「违约金」） */
  definitionKeys?: string[];
  /** 从本条款正文中提取的引用 */
  references?: Reference[];
}

export interface ClauseDoc {
  /** 原始输入文本 */
  text: string;
  /** 顶层条款列表 */
  clauses: Clause[];
  /** 定义 key -> 定义所在条款 */
  definitions: Map<string, Clause>;
  /** 全部引用 */
  references: Reference[];
}

export type ClauseDocJSON = {
  text: string;
  clauses: Clause[];
  definitions: Array<[string, Clause]>;
  references: Reference[];
};

/** 序列化：Map 无法被 JSON.stringify 直接保留，故转成条目数组。 */
export function clauseDocToJSON(doc: ClauseDoc): ClauseDocJSON {
  return {
    text: doc.text,
    clauses: doc.clauses,
    definitions: [...doc.definitions.entries()],
    references: doc.references,
  };
}

/** 反序列化。子条款循环引用由 id 重建，不还原运行时闭包。 */
export function clauseDocFromJSON(json: ClauseDocJSON): ClauseDoc {
  return {
    text: json.text,
    clauses: json.clauses,
    definitions: new Map(json.definitions),
    references: json.references,
  };
}

/** 判断两个 SourceRange 是否指向同一段原文。 */
export function sourceRangeEqual(a: SourceRange, b: SourceRange): boolean {
  return (
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.startChar === b.startChar &&
    a.endChar === b.endChar
  );
}
