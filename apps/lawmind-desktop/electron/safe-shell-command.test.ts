import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { openPath, showItemInFolder, openExternal } = vi.hoisted(() => ({
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(() => undefined),
  openExternal: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  shell: { openPath, showItemInFolder, openExternal },
}));

import { safeOpenWithSystem, safeShowItemInFolder, safeOpenExternal, safeShellCommand } from "./safe-shell-command.mjs";

function parseJsonDetail(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-safe-shell-"));
}

describe("safe-shell-command", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = tmpDir();
    openPath.mockReset().mockResolvedValue("");
    showItemInFolder.mockReset().mockImplementation(() => undefined);
    openExternal.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("rejects relative paths", async () => {
    const res = await safeOpenWithSystem("relative/path.txt", workspaceDir);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/absolute/);
  });

  it("opens absolute file and audits safe_command", async () => {
    const file = path.join(workspaceDir, "test.docx");
    fs.writeFileSync(file, "x");
    const res = await safeOpenWithSystem(file, workspaceDir);
    expect(res.ok).toBe(true);
    expect(openPath).toHaveBeenCalledWith(file);
    const auditDir = path.join(workspaceDir, "audit");
    const files = fs.readdirSync(auditDir);
    expect(files.length).toBe(1);
    const lines = fs.readFileSync(path.join(auditDir, files[0]), "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    const event = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(event.kind).toBe("safe_command");
    expect(event.actor).toBe("system");
    const detail = parseJsonDetail(event.detail);
    expect(detail.command).toBe("open_with_system");
    expect(detail.exitCode).toBe(0);
  });

  it("shows item in folder and audits", async () => {
    const file = path.join(workspaceDir, "shown.txt");
    fs.writeFileSync(file, "x");
    const res = await safeShowItemInFolder(file, workspaceDir);
    expect(res.ok).toBe(true);
    expect(showItemInFolder).toHaveBeenCalledWith(file);
    const auditDir = path.join(workspaceDir, "audit");
    const files = fs.readdirSync(auditDir);
    expect(files.length).toBe(1);
  });

  it("opens external https URL and audits", async () => {
    const res = await safeOpenExternal("https://example.com", workspaceDir);
    expect(res.ok).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");
    const auditDir = path.join(workspaceDir, "audit");
    const files = fs.readdirSync(auditDir);
    expect(files.length).toBe(1);
  });

  it("rejects non-http external protocols", async () => {
    const res = await safeOpenExternal("file:///etc/passwd", workspaceDir);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("protocol_not_allowed");
  });

  it("rejects non-whitelist shell command", async () => {
    const res = await safeShellCommand({ command: "bash", args: ["/tmp/x"], workspaceDir });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not allowed/);
  });

  it("allows xdg-open on absolute path", async () => {
    const file = path.join(workspaceDir, "x.txt");
    fs.writeFileSync(file, "x");
    const res = await safeShellCommand({ command: "xdg-open", args: [file], workspaceDir });
    expect(res.ok).toBe(true);
  });
});
