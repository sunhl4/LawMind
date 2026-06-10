import { describe, expect, it } from "vitest";
import { isPathInsideRoot } from "./ingest-helpers.js";

describe("isPathInsideRoot", () => {
  it("rejects paths that escape the workspace root", () => {
    const root = "/tmp/lawmind-workspace";
    expect(isPathInsideRoot(root, "/tmp/lawmind-workspace/notes.txt")).toBe(true);
    expect(isPathInsideRoot(root, "/tmp/other/notes.txt")).toBe(false);
    expect(isPathInsideRoot(root, "/tmp/lawmind-workspace/../secret.txt")).toBe(false);
  });
});
