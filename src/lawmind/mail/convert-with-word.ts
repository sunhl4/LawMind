/**
 * Legacy `.doc` → `.docx` through the lawyer's own Microsoft Word.
 *
 * Why the staging dance: Word for macOS is sandboxed. When AppleScript asks it to
 * open a path outside the directories Word has been granted, macOS raises
 * 「授予文件访问权限」 and the conversion stalls. Files staged **inside Word's own
 * container** (`~/Library/Containers/com.microsoft.Word/Data/Documents`) are
 * already accessible, so the dialog never appears.
 *
 * That makes this a real "Save As": headers, footers, tables, images, numbering
 * geometry and existing tracked changes (authors, dates, insert/delete) all come
 * across. No LibreOffice, no extra install — the lawyer already has Word.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { buildMinimalChildEnv, runSafeCommand } from "../platform/safe-command.js";
import { RESOURCE_LEASE_WORD, withResourceLease } from "../runtime/turn-admission.js";

const WORD_BUNDLE = "/Applications/Microsoft Word.app";
const WINWORD_CANDIDATES = [
  "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
  "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
  "C:\\Program Files\\Microsoft Office\\Office16\\WINWORD.EXE",
  "C:\\Program Files (x86)\\Microsoft Office\\Office16\\WINWORD.EXE",
];
/** Word 打开一个已存在的文档通常 1–3 秒；超时值只是兜底。 */
const OPEN_AND_SAVE_SECONDS = 60;
const POLL_INTERVAL_MS = 200;

export function microsoftWordInstalled(home = os.homedir()): boolean {
  if (process.platform === "win32") {
    return WINWORD_CANDIDATES.some((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
  }
  return (
    process.platform === "darwin" &&
    (fs.existsSync(WORD_BUNDLE) ||
      fs.existsSync(path.join(home, "Applications/Microsoft Word.app")))
  );
}

/**
 * Word's own container: files here need no macOS file-access grant.
 * `Documents` is preferred; `tmp` is the fallback for older container layouts.
 */
export function resolveWordSandboxDir(home = os.homedir()): string | undefined {
  const data = path.join(home, "Library", "Containers", "com.microsoft.Word", "Data");
  for (const dir of [path.join(data, "Documents"), path.join(data, "tmp")]) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

async function isValidDocxPackage(abs: string): Promise<boolean> {
  try {
    if (fs.statSync(abs).size === 0) {
      return false;
    }
    const fd = fs.openSync(abs, "r");
    const magic = Buffer.alloc(2);
    fs.readSync(fd, magic, 0, 2, 0);
    fs.closeSync(fd);
    if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
      return false;
    }
    const zip = await JSZip.loadAsync(await fs.promises.readFile(abs));
    return Object.hasOwn(zip.files, "word/document.xml");
  } catch {
    return false;
  }
}

/**
 * 打开时关掉转换确认、修复和最近文件。`display alerts` 压住「发现无法读取的内容」
 * 这类必须点一下才会继续的框；结束前把原来的 alerts 设回去。
 */
export function buildWordConvertAppleScript(
  stagedIn: string,
  stagedOut: string,
  fileName: string,
): string {
  const q = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return [
    `set inPath to ${q(stagedIn)}`,
    `set outPath to ${q(stagedOut)}`,
    `set targetName to ${q(fileName)}`,
    `set outName to "lm-output.docx"`,
    `with timeout of ${OPEN_AND_SAVE_SECONDS} seconds`,
    `  tell application "Microsoft Word"`,
    // 不 activate：不抢焦点，律师可能正在别处打字。
    `    set previousAlerts to display alerts`,
    `    set display alerts to alerts none`,
    `    try`,
    `      open file name inPath confirm conversions false repair false add to recent files false`,
    // Word 的 `documents` 不支持直接迭代（every document 不响应 count），只能按下标找。
    `      set docCount to count of documents`,
    `      set targetIndex to 0`,
    `      repeat with i from 1 to docCount`,
    `        if (name of document i) is targetName then set targetIndex to i`,
    `      end repeat`,
    `      if targetIndex is 0 then error "word_open_failed"`,
    `      save as document targetIndex file name outPath file format format document`,
    // 另存后文档名会变成 lm-output.docx，且下标可能变；倒序按名字关，
    // 绝不 close by index（会关到律师自己的文档）。
    `      set closeCount to count of documents`,
    `      repeat with i from closeCount to 1 by -1`,
    `        try`,
    `          set nm to name of document i`,
    `          if nm is targetName or nm is outName then close document i saving no`,
    `        end try`,
    `      end repeat`,
    `      set display alerts to previousAlerts`,
    `    on error errMsg`,
    `      try`,
    `        set display alerts to previousAlerts`,
    `      end try`,
    `      error errMsg`,
    `    end try`,
    `  end tell`,
    `end timeout`,
    `return "ok"`,
  ].join("\n");
}

/**
 * Windows：cscript 调本机 Word COM。不 Quit 律师已经开着的 Word；
 * 只有这次是我们 CreateObject 起来的实例才退出。DisplayAlerts = 0 避免修复框。
 * wdFormatXMLDocument = 12。
 */
export function buildWordConvertVbscript(): string {
  return [
    "Option Explicit",
    "Dim inPath, outPath, word, started, doc, prevAlerts",
    "If WScript.Arguments.Count < 2 Then WScript.Quit 2",
    "inPath = WScript.Arguments(0)",
    "outPath = WScript.Arguments(1)",
    "started = False",
    "On Error Resume Next",
    'Set word = GetObject(, "Word.Application")',
    "If Err.Number <> 0 Then",
    "  Err.Clear",
    '  Set word = CreateObject("Word.Application")',
    "  If Err.Number <> 0 Then WScript.Quit 3",
    "  started = True",
    "  word.Visible = False",
    "End If",
    "prevAlerts = word.DisplayAlerts",
    "word.DisplayAlerts = 0",
    "Err.Clear",
    "Set doc = word.Documents.Open(inPath, False, False, False, , , , , , , , False, False, , True)",
    "If Err.Number <> 0 Or doc Is Nothing Then",
    "  word.DisplayAlerts = prevAlerts",
    "  If started Then word.Quit",
    "  WScript.Quit 4",
    "End If",
    "Err.Clear",
    "doc.SaveAs2 outPath, 12",
    "If Err.Number <> 0 Then",
    "  doc.Close False",
    "  word.DisplayAlerts = prevAlerts",
    "  If started Then word.Quit",
    "  WScript.Quit 5",
    "End If",
    "doc.Close False",
    "word.DisplayAlerts = prevAlerts",
    "If started Then word.Quit",
    "WScript.Quit 0",
  ].join("\r\n");
}

/** 兜底：只关掉本次 workDir 里的残留文档，任何别人的文档都不碰。 */
async function closeStagedDocuments(workDir: string): Promise<void> {
  const q = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const folder = path.basename(workDir);
  const script = [
    `set marker to ${q(folder)}`,
    `with timeout of 20 seconds`,
    `  tell application "Microsoft Word"`,
    `    set previousAlerts to display alerts`,
    `    set display alerts to alerts none`,
    `    set n to count of documents`,
    `    repeat with i from n to 1 by -1`,
    `      try`,
    `        set p to path of document i as text`,
    `        if p contains marker then close document i saving no`,
    `      end try`,
    `    end repeat`,
    `    set display alerts to previousAlerts`,
    `  end tell`,
    `end timeout`,
    `return "ok"`,
  ].join("\n");
  const scriptPath = path.join(
    os.tmpdir(),
    `lm-word-close-${randomUUID().slice(0, 8)}.applescript`,
  );
  try {
    fs.writeFileSync(scriptPath, script, "utf8");
    await runSafeCommand({
      command: "osascript",
      args: [scriptPath],
      env: buildMinimalChildEnv(),
      timeoutMs: 30_000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "ignore", "pipe"],
      maxStderrBytes: 2_000,
    }).catch(() => null);
  } catch {
    /* best effort */
  } finally {
    try {
      fs.rmSync(scriptPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

async function waitForOutput(abs: string, deadlineMs: number): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    if (await isValidDocxPackage(abs)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return isValidDocxPackage(abs);
}

/** 超时杀掉 osascript 时，Word 可能停在 alerts none。只在 Word 已在跑时改回默认。 */
async function restoreWordDisplayAlerts(): Promise<void> {
  const running = await runSafeCommand({
    command: "pgrep",
    args: ["-x", "Microsoft Word"],
    env: buildMinimalChildEnv(),
    timeoutMs: 5_000,
    killSignal: "SIGKILL",
    stdio: ["ignore", "ignore", "pipe"],
    maxStderrBytes: 200,
  }).catch(() => null);
  if (!running || running.exitCode !== 0) {
    return;
  }
  const scriptPath = path.join(
    os.tmpdir(),
    `lm-word-alerts-${randomUUID().slice(0, 8)}.applescript`,
  );
  const script = [
    "with timeout of 15 seconds",
    '  tell application "Microsoft Word"',
    "    set display alerts to alerts all",
    "  end tell",
    "end timeout",
  ].join("\n");
  try {
    fs.writeFileSync(scriptPath, script, "utf8");
    await runSafeCommand({
      command: "osascript",
      args: [scriptPath],
      env: buildMinimalChildEnv(),
      timeoutMs: 20_000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "ignore", "pipe"],
      maxStderrBytes: 2_000,
    }).catch(() => null);
  } catch {
    /* best effort */
  } finally {
    try {
      fs.rmSync(scriptPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

async function convertDocToDocxWithWordWindows(
  absIn: string,
  absOut: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<boolean> {
  if (/[\r\n]/.test(absIn) || /[\r\n]/.test(absOut)) {
    return false;
  }
  const cscript = "C:\\Windows\\System32\\cscript.exe";
  if (!fs.existsSync(cscript)) {
    return false;
  }
  return withResourceLease(RESOURCE_LEASE_WORD, async () => {
    const scriptPath = path.join(os.tmpdir(), `lm-word-${randomUUID().slice(0, 8)}.vbs`);
    try {
      fs.writeFileSync(scriptPath, buildWordConvertVbscript(), "utf8");
      fs.mkdirSync(path.dirname(absOut), { recursive: true });
      const result = await runSafeCommand({
        command: cscript,
        args: ["//Nologo", "//B", scriptPath, absIn, absOut],
        env: buildMinimalChildEnv(),
        timeoutMs: opts?.timeoutMs ?? (OPEN_AND_SAVE_SECONDS + 30) * 1_000,
        signal: opts?.signal,
        killSignal: "SIGKILL",
        stdio: ["ignore", "ignore", "pipe"],
        maxStderrBytes: 4_000,
      }).catch(() => null);
      if (!result || result.exitCode !== 0 || !(await isValidDocxPackage(absOut))) {
        try {
          fs.rmSync(absOut, { force: true });
        } catch {
          /* ignore */
        }
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      try {
        fs.rmSync(scriptPath, { force: true });
      } catch {
        /* ignore */
      }
    }
  });
}

/**
 * Convert via Word. Returns false when Word is absent, the container is missing,
 * the automation fails, or the produced package is invalid. Never leaves a partial
 * file at `absOut`.
 */
export async function convertDocToDocxWithWord(
  absIn: string,
  absOut: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<boolean> {
  if (!microsoftWordInstalled()) {
    return false;
  }
  if (process.platform === "win32") {
    return convertDocToDocxWithWordWindows(absIn, absOut, opts);
  }
  const sandbox = resolveWordSandboxDir();
  if (!sandbox || /[\r\n]/.test(absIn)) {
    return false;
  }
  return withResourceLease(RESOURCE_LEASE_WORD, async () => {
    const workDir = path.join(sandbox, `lm-convert-${randomUUID().slice(0, 8)}`);
    // Word 的 AppleScript 在非 ASCII 文件名上不稳定；暂存名一律用 ASCII。
    const stagedName = `lm-input-${randomUUID().slice(0, 8)}.doc`;
    const stagedIn = path.join(workDir, stagedName);
    const stagedOut = path.join(workDir, "lm-output.docx");
    let scriptFinished = false;
    try {
      fs.mkdirSync(workDir, { recursive: true });
      fs.copyFileSync(absIn, stagedIn);
      const scriptPath = path.join(workDir, "convert.applescript");
      fs.writeFileSync(
        scriptPath,
        buildWordConvertAppleScript(stagedIn, stagedOut, stagedName),
        "utf8",
      );
      const timeoutMs = opts?.timeoutMs ?? (OPEN_AND_SAVE_SECONDS + 30) * 1_000;
      const scriptResult = await runSafeCommand({
        command: "osascript",
        args: [scriptPath],
        env: buildMinimalChildEnv(),
        timeoutMs,
        signal: opts?.signal,
        killSignal: "SIGKILL",
        stdio: ["ignore", "ignore", "pipe"],
        maxStderrBytes: 4_000,
      }).catch(() => null);
      scriptFinished = scriptResult?.exitCode === 0;
      if (!(await waitForOutput(stagedOut, Date.now() + 15_000))) {
        return false;
      }
      fs.mkdirSync(path.dirname(absOut), { recursive: true });
      fs.copyFileSync(stagedOut, absOut);
      return await isValidDocxPackage(absOut);
    } catch {
      return false;
    } finally {
      // 脚本被超时杀掉时，alerts 可能停在 none；成功路径自己会还原。
      if (!scriptFinished) {
        await restoreWordDisplayAlerts();
      }
      // 先关掉本次暂存目录里的残留文档，再删目录；
      // 只按 workDir 名匹配，绝不碰律师自己打开的文件。
      await closeStagedDocuments(workDir);
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
}
