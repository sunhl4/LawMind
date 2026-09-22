import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInsideRoot, resolveWorkspaceRelativePath } from "./workspace-path.js";

describe("workspace-path fence", () => {
  const root = path.join(os.tmpdir(), "lawmind-workspace");

  it("rejects prefix escape that startsWith would allow", () => {
    expect(isPathInsideRoot(root, `${root}-evil${path.sep}secret`)).toBe(false);
    expect(isPathInsideRoot(root, path.join(root, "..", "secret.txt"))).toBe(false);
    expect(isPathInsideRoot(root, path.join(root, "notes.txt"))).toBe(true);
  });

  it("resolveWorkspaceRelativePath returns posix rel or escape", () => {
    const ok = resolveWorkspaceRelativePath(root, "cases/m1/a.md");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.rel).toBe("cases/m1/a.md");
    }
    expect(resolveWorkspaceRelativePath(root, "../etc/passwd").ok).toBe(false);
    expect(resolveWorkspaceRelativePath(root, "").ok).toBe(false);
  });
});
