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
      expect(isDeniedHostPath(path.join(home, "ethics-wall.json"), { homeDir: home })).toBe(true);
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

  it("allows documentation under docs/lawmind but still denies governance lawmind trees", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-deny-docs-"));
    try {
      expect(
        isDeniedHostPath(path.join(home, "ws", "docs", "lawmind", "LAWMIND-HOST-ACCESS.md"), {
          homeDir: home,
        }),
      ).toBe(false);
      expect(
        isDeniedHostPath(path.join(home, "ws", "lawmind", "mcp-servers.json"), { homeDir: home }),
      ).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not treat the desktop LawMind data directory as governance", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-deny-app-"));
    const workspace = path.join(home, "Library", "Application Support", "LawMind", "workspace");
    const material = path.join(workspace, "cases", "m1", "materials", "起诉状.pdf");
    try {
      fs.mkdirSync(path.dirname(material), { recursive: true });
      fs.writeFileSync(material, "pdf");
      expect(isDeniedHostPath(material, { homeDir: home, workspaceDir: workspace })).toBe(false);
      expect(
        isDeniedHostPath(path.join(workspace, "lawmind", "mcp-servers.json"), {
          homeDir: home,
          workspaceDir: workspace,
        }),
      ).toBe(true);
      expect(
        isDeniedHostPath(path.join(workspace, "audit", "event.json"), {
          homeDir: home,
          workspaceDir: workspace,
        }),
      ).toBe(true);
      expect(
        isDeniedHostPath(path.join(workspace, "docs", "lawmind", "note.md"), {
          homeDir: home,
          workspaceDir: workspace,
        }),
      ).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
