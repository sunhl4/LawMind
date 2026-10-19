import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWordConvertAppleScript,
  buildWordConvertVbscript,
  microsoftWordInstalled,
  resolveWordSandboxDir,
} from "./convert-with-word.js";

describe("convert-with-word: automation scripts", () => {
  it("opens without conversion, repair, or recent-file prompts and restores alerts", () => {
    const script = buildWordConvertAppleScript("/tmp/in.doc", "/tmp/out.docx", "lm-input.doc");
    expect(script).toContain("set display alerts to alerts none");
    expect(script).toContain("set display alerts to previousAlerts");
    expect(script).toContain("confirm conversions false repair false add to recent files false");
    expect(script).not.toContain("activate");
  });

  it.skipIf(process.platform !== "darwin" || !microsoftWordInstalled())(
    "the generated AppleScript compiles against this Mac's Word",
    () => {
      const script = buildWordConvertAppleScript("/tmp/in.doc", "/tmp/out.docx", "lm-input.doc");
      const file = path.join(os.tmpdir(), `lm-word-syntax-${process.pid}.applescript`);
      fs.writeFileSync(file, script);
      try {
        execFileSync("osacompile", ["-o", `${file}.scpt`, file], { stdio: "pipe" });
      } finally {
        fs.rmSync(file, { force: true });
        fs.rmSync(`${file}.scpt`, { force: true });
      }
    },
  );

  it("windows script suppresses alerts and only quits a Word instance it started", () => {
    const script = buildWordConvertVbscript();
    expect(script).toContain("word.DisplayAlerts = 0");
    expect(script).toContain("doc.SaveAs2 outPath, 12");
    expect(script).toContain("If started Then word.Quit");
    expect(script).not.toMatch(/^word\.Quit/m);
  });
});

describe("convert-with-word: sandbox staging", () => {
  it("detects Word only on macOS with the app bundle present", () => {
    const installed = microsoftWordInstalled();
    if (process.platform !== "darwin") {
      expect(installed).toBe(false);
    } else {
      expect(typeof installed).toBe("boolean");
    }
  });

  it("resolves a staging dir inside Word's own container when it exists", () => {
    const dir = resolveWordSandboxDir();
    if (!dir) {
      // 没装 Word / 没跑过 Word 的机器：不该硬编一个不存在的路径。
      expect(dir).toBeUndefined();
      return;
    }
    // 关键：暂存目录必须在 Word 容器里，否则 macOS 会弹「授予文件访问权限」。
    expect(dir).toContain(path.join("Library", "Containers", "com.microsoft.Word", "Data"));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("does not report the sandbox when Word was never containerised", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "lm-nohome-"));
    try {
      expect(resolveWordSandboxDir(fakeHome)).toBeUndefined();
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
