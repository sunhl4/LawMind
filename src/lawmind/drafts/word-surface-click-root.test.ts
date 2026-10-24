/**
 * 复现：对话交付链接的 root 猜错时的中栏 404。
 *
 * 链路：write_document / write_spreadsheet 把交付件写到 workspace 根的
 * `artifacts/`（default-output-location 的 workspace_artifacts 兜底，或
 * beside_source 落在 workspace 源文件旁）→ 聊天脚注发出 `lm-wps:` 相对路径 →
 * 点击侧 `openDeliverableInMiddleColumn` / `openMiddleColumnFile` 用
 * `path.startsWith("cases/") ? "workspace" : "project"` 猜根 → 非 cases/ 前缀
 * 一律猜 project → loadWordSurface 严格校验 found.root === root → 404 →
 * 中栏显示「读不到这份 Word。」
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { loadWordSurface } from "./word-surface.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function writeMinimalDocx(abs: string, text: string): Promise<void> {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );
  fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("chat deliverable link → middle column root", () => {
  it("workspace artifacts/ deliverable opens under workspace root (right guess)", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-click-root-ws-"));
    dirs.push(ws);
    await writeMinimalDocx(path.join(ws, "artifacts", "查询意见_20261022_01.docx"), "结论成立。");
    const ok = await loadWordSurface({
      workspaceDir: ws,
      root: "workspace",
      relPath: "artifacts/查询意见_20261022_01.docx",
    });
    expect(ok.ok).toBe(true);
  });

  it("the current cases/-prefix guess sends project root and 404s for a workspace-root deliverable", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-click-root-ws-"));
    dirs.push(ws);
    await writeMinimalDocx(path.join(ws, "artifacts", "查询意见_20261022_01.docx"), "结论成立。");
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-click-root-proj-"));
    dirs.push(project);
    const guessed = await loadWordSurface({
      workspaceDir: ws,
      projectDir: project,
      root: "project",
      relPath: "artifacts/查询意见_20261022_01.docx",
    });
    expect(guessed.ok).toBe(false);
    expect(guessed.error).toBe("not_found");
  });

  it("no project dir at all: project root request fails the same way", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-click-root-ws-"));
    dirs.push(ws);
    await writeMinimalDocx(path.join(ws, "artifacts", "查询意见_20261022_01.docx"), "结论成立。");
    const guessed = await loadWordSurface({
      workspaceDir: ws,
      root: "project",
      relPath: "artifacts/查询意见_20261022_01.docx",
    });
    expect(guessed.ok).toBe(false);
    expect(guessed.error).toBe("not_found");
  });

  it("beside_source deliverable next to a workspace source file hits the same wrong root", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-click-root-ws-"));
    dirs.push(ws);
    await writeMinimalDocx(path.join(ws, "材料", "合同_20261022_01.docx"), "补充条款。");
    const guessed = await loadWordSurface({
      workspaceDir: ws,
      root: "project",
      relPath: "材料/合同_20261022_01.docx",
    });
    expect(guessed.ok).toBe(false);
    expect(guessed.error).toBe("not_found");
  });
});
