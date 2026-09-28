import { describe, expect, it } from "vitest";
import { computeDAGLayout } from "./dag-layout";

describe("computeDAGLayout", () => {
  it("layers a chain from top to bottom", () => {
    const layout = computeDAGLayout({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    const rank = Object.fromEntries(layout.nodes.map((node) => [node.id, node.rank]));
    expect(rank).toEqual({ a: 0, b: 1, c: 2 });
    expect(layout.edges.every((edge) => !edge.isBackEdge)).toBe(true);
    expect(layout.height).toBeGreaterThan(layout.nodes[0]?.y ?? 0);
  });

  it("flags the return edge of a cycle", () => {
    const layout = computeDAGLayout({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    });
    const back = layout.edges.filter((edge) => edge.isBackEdge);
    expect(back).toHaveLength(1);
    expect(back[0]?.from).toBe("b");
    expect(back[0]?.to).toBe("a");
  });
});
