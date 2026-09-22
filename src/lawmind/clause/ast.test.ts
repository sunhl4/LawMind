import { describe, expect, it } from "vitest";
import {
  CLAUSE_TYPES,
  clauseDocFromJSON,
  clauseDocToJSON,
  sourceRangeEqual,
  type Clause,
  type ClauseDoc,
} from "./ast.js";

describe("clause AST", () => {
  it("exports all clause types", () => {
    expect(new Set(CLAUSE_TYPES)).toEqual(
      new Set(["definition", "obligation", "right", "liability", "dispute", "general"]),
    );
  });

  it("round-trips through JSON", () => {
    const clause: Clause = {
      id: "article-1",
      type: "definition",
      title: "定义",
      body: "本合同所称...",
      children: [],
      sourceRange: { startLine: 1, endLine: 1, startChar: 0, endChar: 10 },
      articleNo: 1,
      definitionKeys: ["保密信息"],
    };
    const doc: ClauseDoc = {
      text: "第一条 定义。",
      clauses: [clause],
      definitions: new Map([["保密信息", clause]]),
      references: [],
    };

    const json = clauseDocToJSON(doc);
    const restored = clauseDocFromJSON(json);

    expect(restored.text).toBe(doc.text);
    expect(restored.clauses).toHaveLength(1);
    expect(restored.clauses[0]?.definitionKeys).toContain("保密信息");
    expect(restored.definitions.get("保密信息")?.id).toBe("article-1");
  });

  it("compares source ranges", () => {
    expect(
      sourceRangeEqual(
        { startLine: 1, endLine: 2, startChar: 0, endChar: 5 },
        { startLine: 1, endLine: 2, startChar: 0, endChar: 5 },
      ),
    ).toBe(true);
    expect(
      sourceRangeEqual(
        { startLine: 1, endLine: 2, startChar: 0, endChar: 5 },
        { startLine: 1, endLine: 2, startChar: 0, endChar: 6 },
      ),
    ).toBe(false);
  });
});
