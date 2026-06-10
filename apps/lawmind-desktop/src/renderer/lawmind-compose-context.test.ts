import { describe, expect, it } from "vitest";
import {
  buildComposeContextPickerItems,
  filterContextPickerItems,
  parseAtTrigger,
  removeAtTokenFromInput,
} from "./lawmind-compose-context.js";

describe("lawmind-compose-context", () => {
  it("detects @ trigger and query at cursor", () => {
    expect(parseAtTrigger("请审查 @cont", 9)).toEqual({ query: "cont", startIndex: 4 });
    expect(parseAtTrigger("no trigger", 10)).toBeNull();
  });

  it("removes @ token from compose input", () => {
    const r = removeAtTokenFromInput("请引用 @cases/foo 继续", 4, 15);
    expect(r.nextInput).toBe("请引用 继续");
    expect(r.nextCursor).toBe(4);
  });

  it("filters picker items by label and hint", () => {
    const items = buildComposeContextPickerItems({
      pinnedFiles: [],
      recentFiles: [{ root: "workspace", relPath: "cases/demo/CASE.md", kind: "file" }],
      matters: [{ matterId: "demo", displayName: "演示案件" }],
      contextMatterId: null,
      templates: [
        {
          id: "contract-review",
          name: "合同审查",
          description: "审查意见",
          stepCount: 1,
          starterPrompt: "请审查合同",
        },
      ],
    });
    const filtered = filterContextPickerItems(items, "合同");
    expect(filtered.some((i) => i.kind === "template")).toBe(true);
    expect(filtered.some((i) => i.kind === "file" && i.label.includes("CASE"))).toBe(false);
  });

  it("marks pinned files and current matter", () => {
    const items = buildComposeContextPickerItems({
      pinnedFiles: [{ id: "1", root: "workspace", relPath: "a.md", kind: "file" }],
      recentFiles: [{ root: "workspace", relPath: "a.md", kind: "file" }],
      matters: [{ matterId: "m1", displayName: "M1" }],
      contextMatterId: "m1",
      templates: [],
    });
    const file = items.find((i) => i.kind === "file");
    const matter = items.find((i) => i.kind === "matter");
    expect(file?.kind === "file" && file.alreadyPinned).toBe(true);
    expect(matter?.kind === "matter" && matter.isCurrent).toBe(true);
  });
});
