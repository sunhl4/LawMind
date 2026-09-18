import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPickerGrantedPath,
  rememberPickerPath,
  resetPickerPathGrants,
  resolveGrantedHostFolder,
  resolveGrantedProjectDir,
} from "./picker-path-grant.mjs";

describe("picker-path-grant", () => {
  const dirs: string[] = [];

  afterEach(() => {
    resetPickerPathGrants();
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-picker-"));
    dirs.push(dir);
    return dir;
  }

  it("rejects an unpicked directory for set-project-dir", () => {
    const dir = tmp();
    const denied = resolveGrantedProjectDir(dir);
    expect(denied.ok).toBe(false);
    if (denied.ok) {
      return;
    }
    expect(denied.error).toContain("系统对话框");
    expect(isPickerGrantedPath(dir)).toBe(false);
  });

  it("accepts a path remembered from the native picker", () => {
    const dir = tmp();
    rememberPickerPath(dir);
    const granted = resolveGrantedProjectDir(dir);
    expect(granted.ok).toBe(true);
    if (!granted.ok) {
      return;
    }
    expect(granted.abs).toBe(fs.realpathSync(dir));
  });

  it("allows clearing the project dir without a picker grant", () => {
    expect(resolveGrantedProjectDir(null)).toEqual({ ok: true, abs: null });
    expect(resolveGrantedProjectDir("  ")).toEqual({ ok: true, abs: null });
  });

  it("rejects add-host-folder until the lawyer picked that folder", () => {
    const dir = tmp();
    expect(resolveGrantedHostFolder(dir).ok).toBe(false);
    rememberPickerPath(dir);
    const granted = resolveGrantedHostFolder(dir);
    expect(granted.ok).toBe(true);
    if (!granted.ok) {
      return;
    }
    expect(granted.abs).toBe(fs.realpathSync(dir));
  });
});
