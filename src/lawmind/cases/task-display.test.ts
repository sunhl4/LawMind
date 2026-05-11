import { describe, expect, it } from "vitest";
import { shortTaskIdForDisplay, taskProgressPrefix } from "./task-display.js";

describe("task-display", () => {
  it("shortens UUID v4 to first segment", () => {
    expect(shortTaskIdForDisplay("cbc9d61b-456a-47ee-84b6-7767edddafad")).toBe("cbc9d61b");
  });

  it("prefix wraps short id in corner brackets", () => {
    expect(taskProgressPrefix("cbc9d61b-456a-47ee-84b6-7767edddafad")).toBe("「cbc9d61b」");
  });
});
