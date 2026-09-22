import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLawyerLocalDir } from "./lawyer-local-file.js";
import {
  formatDirectoryListingBlock,
  resolveAndListDirectory,
  walkDirectoryListing,
} from "./list-dir.js";
import { resolveWorkspaceRelativePathAllowRoot } from "./workspace-path.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveWorkspaceRelativePathAllowRoot", () => {
  it("treats empty and dot as the root", () => {
    const root = tmp("lm-ws-root-");
    expect(resolveWorkspaceRelativePathAllowRoot(root, "")).toEqual({
      ok: true,
      abs: path.resolve(root),
      rel: "",
    });
    expect(resolveWorkspaceRelativePathAllowRoot(root, ".").ok).toBe(true);
  });
});

describe("walkDirectoryListing", () => {
  it("recurses into subdirectories and skips junk", () => {
    const root = tmp("lm-list-walk-");
    fs.mkdirSync(path.join(root, "contracts", "附件"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "contracts", "nda.docx"), "docx");
    fs.writeFileSync(path.join(root, "contracts", "附件", "清单.pdf"), "pdf");
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "secret.js"), "no");
    fs.writeFileSync(path.join(root, "README.md"), "hi");

    const walked = walkDirectoryListing(root, { recursive: true });
    const files = walked.entries.filter((e) => e.kind === "file").map((e) => e.path);
    expect(files).toEqual(
      expect.arrayContaining(["README.md", "contracts/nda.docx", "contracts/附件/清单.pdf"]),
    );
    expect(files.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("can list a single level", () => {
    const root = tmp("lm-list-flat-");
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.txt"), "a");
    fs.writeFileSync(path.join(root, "nested", "b.txt"), "b");
    const walked = walkDirectoryListing(root, { recursive: false });
    expect(walked.entries.some((e) => e.path === "a.txt")).toBe(true);
    expect(walked.entries.some((e) => e.path === "nested")).toBe(true);
    expect(walked.entries.some((e) => e.path === "nested/b.txt")).toBe(false);
  });
});

describe("resolveAndListDirectory", () => {
  it("lists a pinned nested directory", () => {
    const workspace = tmp("lm-list-ws-");
    const nested = path.join(workspace, "cases", "m1", "materials", "证据包");
    fs.mkdirSync(path.join(nested, "往来"), { recursive: true });
    fs.writeFileSync(path.join(nested, "合同.docx"), "x");
    fs.writeFileSync(path.join(nested, "往来", "函.md"), "y");

    const listing = resolveAndListDirectory(
      {
        workspaceDir: workspace,
        sessionId: "s",
        contextPins: [
          {
            pinKind: "file",
            root: "workspace",
            relPath: "cases/m1/materials/证据包",
            kind: "directory",
          },
        ],
      },
      "cases/m1/materials/证据包",
      { recursive: true },
    );
    expect(listing.ok).toBe(true);
    if (!listing.ok) {
      return;
    }
    expect(listing.entries.map((e) => e.path)).toEqual(
      expect.arrayContaining([
        "cases/m1/materials/证据包/合同.docx",
        "cases/m1/materials/证据包/往来",
        "cases/m1/materials/证据包/往来/函.md",
      ]),
    );
    const block = formatDirectoryListingBlock(listing);
    expect(block).toContain("合同.docx");
    expect(block).toContain("往来/函.md");
  });

  it("lists a project directory that is outside the workspace", () => {
    const workspace = tmp("lm-list-ws2-");
    const project = tmp("lm-list-proj-");
    fs.mkdirSync(path.join(project, "notes"), { recursive: true });
    fs.writeFileSync(path.join(project, "notes", "memo.md"), "memo");
    const listing = resolveAndListDirectory(
      {
        workspaceDir: workspace,
        projectDir: project,
        sessionId: "s",
      },
      ".",
      { recursive: true },
    );
    expect(listing.ok).toBe(true);
    if (!listing.ok) {
      return;
    }
    expect(listing.rootKind).toBe("project");
    expect(listing.entries.some((e) => e.path === "notes/memo.md")).toBe(true);
  });

  it("lists the pinned directory when path is omitted", () => {
    const workspace = tmp("lm-list-ws3-");
    const nested = path.join(workspace, "materials", "证据包");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "主合同.docx"), "x");
    const listing = resolveAndListDirectory(
      {
        workspaceDir: workspace,
        sessionId: "s",
        contextPins: [
          {
            pinKind: "file",
            root: "workspace",
            relPath: "materials/证据包",
            kind: "directory",
          },
        ],
      },
      "",
      { recursive: true },
    );
    expect(listing.ok).toBe(true);
    if (!listing.ok) {
      return;
    }
    expect(listing.listedPath).toBe("materials/证据包");
    expect(listing.entries.some((e) => e.path === "materials/证据包/主合同.docx")).toBe(true);
  });
});

describe("resolveLawyerLocalDir", () => {
  it("resolves a nested workspace directory", () => {
    const ws = tmp("lm-loc-dir-");
    const rel = "contracts/2026";
    fs.mkdirSync(path.join(ws, rel), { recursive: true });
    const found = resolveLawyerLocalDir({
      workspaceDir: ws,
      raw: rel,
    });
    expect(found?.rel).toBe(rel);
    expect(found?.root).toBe("workspace");
  });
});
