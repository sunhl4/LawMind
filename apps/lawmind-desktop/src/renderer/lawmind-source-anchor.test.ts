import { describe, expect, it } from "vitest";
import {
  resolveSourceAnchorId,
  sectionAnchorExcerpt,
  slugifyHeadingForAnchor,
} from "./lawmind-source-anchor";

describe("lawmind-source-anchor", () => {
  it("resolveSourceAnchorId is stable per task and heading", () => {
    const id = resolveSourceAnchorId("t1", "合同标的");
    expect(id).toBe(`lm-source-anchor-t1-${slugifyHeadingForAnchor("合同标的")}`);
    expect(resolveSourceAnchorId("t1", "合同标的")).toBe(id);
  });

  it("sectionAnchorExcerpt truncates long body", () => {
    const long = "a".repeat(200);
    expect(sectionAnchorExcerpt(long, 50).endsWith("…")).toBe(true);
    expect(sectionAnchorExcerpt("  hello  world  ")).toBe("hello world");
  });
});
