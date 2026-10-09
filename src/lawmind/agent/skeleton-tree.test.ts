import { describe, expect, it } from "vitest";
import {
  ADIABATIC_MAX_STEPS,
  applyProseSyndrome,
  bindSkeletonSlot,
  commitPassedSkeleton,
  emptyFactorState,
  extractSkeletonHeadings,
  ingestToolResult,
  rememberSkeleton,
  renderEngineReadings,
  selectSkeleton,
  skeletonHeadingsForRender,
} from "./factor-state.js";
import {
  cloneSkeleton,
  flattenSkeleton,
  outlineDepth,
  parseSkeletonForest,
  skeletonHasHeading,
} from "./skeleton-tree.js";

const OUTLINE = "1 工程概况\n1.1 工程名称\n1.2 工程地点\n2 工程质量";

describe("skeleton syntax tree", () => {
  it("parses a numbered outline into a forest and flattens back in order", () => {
    const headings = extractSkeletonHeadings(OUTLINE);
    expect(headings).toEqual(["1 工程概况", "1.1 工程名称", "1.2 工程地点", "2 工程质量"]);
    expect(outlineDepth("1.1 工程名称")).toBe(2);
    const tree = parseSkeletonForest(headings);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.heading).toBe("1 工程概况");
    expect(tree[0]?.children.map((node) => node.heading)).toEqual(["1.1 工程名称", "1.2 工程地点"]);
    expect(tree[1]?.heading).toBe("2 工程质量");
    expect(flattenSkeleton(tree)).toEqual(headings);
    expect(skeletonHasHeading(tree, "1.2 工程地点")).toBe(true);
  });

  it("stores the tree on rememberSkeleton and keeps headings editable", () => {
    const state = emptyFactorState();
    rememberSkeleton(state, extractSkeletonHeadings(OUTLINE), "document");
    expect(state.skeletonTree?.[0]?.children).toHaveLength(2);
    const readings = renderEngineReadings(state);
    expect(readings).toContain("【骨架起点】");
    expect(readings).toContain("1 工程概况");
    expect(readings).toContain("可改、可增、可删");
    expect(selectSkeleton({ revisingDocument: true }).kind).toBe("document");
  });

  it("freezes the outline after a clean syndrome and refuses a dirty one", () => {
    const clean = emptyFactorState();
    rememberSkeleton(clean, extractSkeletonHeadings(OUTLINE), "document");
    ingestToolResult(clean, "calculate", { op: "wage", value: 15000 });
    expect(clean.lastPassedSkeleton?.[0]?.heading).toBe("1 工程概况");
    const dirty = emptyFactorState();
    rememberSkeleton(dirty, extractSkeletonHeadings(OUTLINE), "document");
    ingestToolResult(dirty, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(dirty, "经济补偿为 99999 元。");
    dirty.lastPassedSkeleton = [];
    commitPassedSkeleton(dirty);
    expect(dirty.lastPassedSkeleton).toEqual([]);
  });

  it("binds six new skeleton slots and rejects the seventh; a repeat does not consume a step", () => {
    const state = emptyFactorState();
    rememberSkeleton(state, extractSkeletonHeadings(OUTLINE), "document");
    for (let step = 1; step <= ADIABATIC_MAX_STEPS; step += 1) {
      expect(bindSkeletonSlot(state, `amount:slot-${step}`)).toBe(true);
    }
    expect(bindSkeletonSlot(state, "amount:slot-7")).toBe(false);
    expect(bindSkeletonSlot(state, "amount:slot-1")).toBe(true);
    expect(state.adiabaticStep).toBe(ADIABATIC_MAX_STEPS);
    expect(state.skeletonBoundAnchors).toHaveLength(ADIABATIC_MAX_STEPS);
  });

  it("treats 第N条 headings as siblings and skip-level numbers as nested", () => {
    const clauses = extractSkeletonHeadings("第一条 合同目的\n第二条 付款");
    expect(clauses).toEqual(["第一条 合同目的", "第二条 付款"]);
    const clauseTree = parseSkeletonForest(clauses);
    expect(clauseTree.map((node) => node.heading)).toEqual(clauses);
    expect(clauseTree.every((node) => node.children.length === 0)).toBe(true);
    const skipped = parseSkeletonForest(["1 总则", "1.1.1 定义", "2 附则"]);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]?.children[0]?.heading).toBe("1.1.1 定义");
    expect(outlineDepth("1.1.1 定义")).toBe(3);
    expect(parseSkeletonForest(["", "  "])).toEqual([]);
    expect(bindSkeletonSlot(emptyFactorState(), "  ")).toBe(false);
  });

  it("clones the tree so later heading edits do not mutate the frozen copy", () => {
    const tree = parseSkeletonForest(extractSkeletonHeadings(OUTLINE));
    const cloned = cloneSkeleton(tree);
    expect(cloned[0]?.children[0]).toBeDefined();
    if (cloned[0]?.children[0]) {
      cloned[0].children[0].heading = "改过";
    }
    expect(tree[0]?.children[0]?.heading).toBe("1.1 工程名称");
  });

  it("falls back to lastPassedSkeleton when live headings are cleared", () => {
    const state = emptyFactorState();
    rememberSkeleton(state, extractSkeletonHeadings(OUTLINE), "document");
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    expect(state.lastPassedSkeleton?.[0]?.children[0]?.heading).toContain("工程名称");
    state.skeletonHeadings = [];
    state.skeletonTree = [];
    expect(skeletonHeadingsForRender(state)[0]).toContain("工程概况");
    expect(renderEngineReadings(state)).toContain("1.1 工程名称");
    expect(renderEngineReadings(state)).toContain("【骨架起点】");
  });

  it("records calculated amounts without spending outline slots", () => {
    const state = emptyFactorState();
    rememberSkeleton(state, extractSkeletonHeadings(OUTLINE), "document");
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    ingestToolResult(state, "calculate", { op: "wage", value: 16000 });
    for (let step = 2; step <= ADIABATIC_MAX_STEPS + 1; step += 1) {
      ingestToolResult(state, "calculate", { op: `slot-${step}`, value: step });
    }
    expect(state.adiabaticStep).toBe(0);
    expect(state.skeletonBoundAnchors ?? []).not.toContain("amount:wage");
    expect(state.factors.some((factor) => factor.anchor === "amount:slot-7")).toBe(true);
  });
});
