import { describe, expect, it } from "vitest";
import {
  encodeLawmindFsDrag,
  parseLawmindFsDrag,
  LAWMID_FS_DRAG_MIME,
} from "./lawmind-file-drag";

describe("lawmind-file-drag", () => {
  it("round-trips a file payload", () => {
    const raw = encodeLawmindFsDrag({
      root: "workspace",
      relPath: "cases/demo/a.md",
      kind: "file",
    });
    expect(parseLawmindFsDrag(raw)).toEqual({
      root: "workspace",
      relPath: "cases/demo/a.md",
      kind: "file",
    });
    expect(LAWMID_FS_DRAG_MIME).toContain("lawmind");
  });

  it("rejects invalid payloads", () => {
    expect(parseLawmindFsDrag(null)).toBeNull();
    expect(parseLawmindFsDrag("{}")).toBeNull();
    expect(parseLawmindFsDrag('{"root":"x","relPath":"a","kind":"file"}')).toBeNull();
  });
});
