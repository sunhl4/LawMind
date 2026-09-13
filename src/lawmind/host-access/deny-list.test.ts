import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDeniedHostPath } from "./deny-list.js";

describe("isDeniedHostPath", () => {
  it("blocks ssh keys, env files, and extra patterns", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-deny-home-"));
    try {
      expect(isDeniedHostPath(path.join(home, ".ssh", "id_ed25519"), { homeDir: home })).toBe(true);
      expect(isDeniedHostPath(path.join(home, "Desktop", ".env"), { homeDir: home })).toBe(true);
      expect(isDeniedHostPath(path.join(home, "a.pem"), { homeDir: home })).toBe(true);
      expect(
        isDeniedHostPath(path.join(home, "ok.md"), {
          homeDir: home,
          extraPatterns: ["**/secret.txt"],
        }),
      ).toBe(false);
      expect(
        isDeniedHostPath(path.join(home, "secret.txt"), {
          homeDir: home,
          extraPatterns: ["**/secret.txt"],
        }),
      ).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
