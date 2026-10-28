import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_BACKUP_MANIFEST_NAME,
  createWorkspaceBackup,
  planWorkspaceBackup,
  restoreWorkspaceBackup,
} from "./workspace-backup.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-workspace-backup-"));
  dirs.push(dir);
  return dir;
}

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function seedWorkspace(root: string): void {
  write(root, "cases/m1/matter.json", "{}");
  write(root, "audit/2026-10-28.jsonl", "{}\n");
  write(root, "drafts/t1.json", "{}");
  write(root, "lawmind/search-index/segments/x", "index");
  write(root, "lawmind/lint/x.jsonl", "lint");
  write(root, "rounds/drill/x.json", "drill");
  write(root, ".env.lawmind", "SECRET=1");
  write(root, "lawmind/license.json", "{}");
  write(root, "lawmind/mail-secrets.json", "{}");
}

describe("workspace backup", () => {
  it("plans business files and excludes secrets and derived runtime state", () => {
    const root = workspace();
    seedWorkspace(root);
    const plan = planWorkspaceBackup(root);
    expect(plan.files.map((file) => file.path)).toEqual([
      "audit/2026-10-28.jsonl",
      "cases/m1/matter.json",
      "drafts/t1.json",
    ]);
    expect(plan.excluded).toContain(".env.lawmind");
    expect(plan.excluded).toContain("lawmind/license.json");
    expect(plan.excluded).toContain("lawmind/mail-secrets.json");
    expect(plan.excluded).toContain("lawmind/search-index/");
    expect(plan.excluded).toContain("lawmind/lint/");
    expect(plan.excluded).toContain("rounds/");
  });

  it("writes a zip with a manifest and the expected files", async () => {
    const root = workspace();
    seedWorkspace(root);
    const out = path.join(root, "backup.zip");
    const result = await createWorkspaceBackup({
      workspaceDir: root,
      outputPath: out,
      now: new Date("2026-10-28T00:00:00.000Z"),
    });
    expect(result.manifest.fileCount).toBe(3);
    expect(result.manifest.secretsIncluded).toBe(false);
    expect(fs.existsSync(out)).toBe(true);

    const zip = await JSZip.loadAsync(await fsp.readFile(out));
    expect(zip.file(WORKSPACE_BACKUP_MANIFEST_NAME)).toBeTruthy();
    expect(zip.file("cases/m1/matter.json")).toBeTruthy();
    expect(zip.file(".env.lawmind")).toBeNull();
    expect(zip.file("lawmind/search-index/segments/x")).toBeNull();
  });

  it("includes secrets only when explicitly requested", async () => {
    const root = workspace();
    seedWorkspace(root);
    const out = path.join(root, "backup.zip");
    const result = await createWorkspaceBackup({
      workspaceDir: root,
      outputPath: out,
      includeSecrets: true,
    });
    expect(result.manifest.secretsIncluded).toBe(true);
    const zip = await JSZip.loadAsync(await fsp.readFile(out));
    expect(zip.file(".env.lawmind")).toBeTruthy();
    expect(zip.file("lawmind/license.json")).toBeTruthy();
  });

  it("round-trips into an empty directory and keeps the manifest", async () => {
    const root = workspace();
    seedWorkspace(root);
    const out = path.join(root, "backup.zip");
    await createWorkspaceBackup({ workspaceDir: root, outputPath: out });
    const target = path.join(workspace(), "restored");
    const restored = await restoreWorkspaceBackup({ archivePath: out, targetDir: target });
    expect(restored.restoredFiles).toBe(3);
    expect(fs.readFileSync(path.join(target, "cases/m1/matter.json"), "utf8")).toBe("{}");
    expect(fs.existsSync(path.join(target, WORKSPACE_BACKUP_MANIFEST_NAME))).toBe(true);
    expect(fs.existsSync(path.join(target, ".env.lawmind"))).toBe(false);
  });

  it("refuses a non-empty target unless forced, and never deletes existing files", async () => {
    const root = workspace();
    seedWorkspace(root);
    const out = path.join(root, "backup.zip");
    await createWorkspaceBackup({ workspaceDir: root, outputPath: out });
    const target = workspace();
    write(target, "keep.txt", "keep");
    await expect(restoreWorkspaceBackup({ archivePath: out, targetDir: target })).rejects.toThrow(
      "restore_target_not_empty",
    );
    const restored = await restoreWorkspaceBackup({
      archivePath: out,
      targetDir: target,
      force: true,
    });
    expect(restored.restoredFiles).toBe(3);
    expect(fs.readFileSync(path.join(target, "keep.txt"), "utf8")).toBe("keep");
  });

  it("rejects absolute and backslash paths inside the archive", async () => {
    const root = workspace();
    const out = path.join(root, "bad.zip");
    const zip = new JSZip();
    zip.file(
      WORKSPACE_BACKUP_MANIFEST_NAME,
      JSON.stringify({
        schemaVersion: 1,
        createdAt: "2026-10-28T00:00:00.000Z",
        workspaceName: "bad",
        fileCount: 1,
        totalBytes: 1,
        includedRoots: [],
        excluded: [],
        secretsIncluded: false,
        warnings: [],
        files: [],
      }),
    );
    zip.file("/abs.txt", "bad");
    zip.file("..\\win.txt", "bad");
    await fsp.writeFile(out, await zip.generateAsync({ type: "nodebuffer" }));
    await expect(
      restoreWorkspaceBackup({ archivePath: out, targetDir: path.join(root, "target") }),
    ).rejects.toThrow("unsafe_backup_path");
  });

  it("skips oversize files and refuses an oversized total", async () => {
    const root = workspace();
    write(root, "small.json", "1234");
    write(root, "big.json", "1234567890");
    const plan = planWorkspaceBackup(root, { maxFileBytes: 5 });
    expect(plan.files.map((file) => file.path)).toEqual(["small.json"]);
    expect(plan.warnings.some((warning) => warning.includes("单文件超过上限"))).toBe(true);
    expect(() => planWorkspaceBackup(root, { maxTotalBytes: 1 })).toThrow(
      "workspace_backup_too_large",
    );
  });

  it("skips symlinks instead of following them out of the workspace", () => {
    const root = workspace();
    write(root, "cases/m1/matter.json", "{}");
    const outside = workspace();
    write(outside, "secret.txt", "secret");
    try {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    } catch {
      return; // Windows / restricted environments may not allow symlinks.
    }
    const plan = planWorkspaceBackup(root);
    expect(plan.files.map((file) => file.path)).toEqual(["cases/m1/matter.json"]);
    expect(plan.warnings.some((warning) => warning.includes("符号链接"))).toBe(true);
  });
});
