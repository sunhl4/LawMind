import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ListDirEntry } from "../runtime/list-dir.js";
import {
  FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS,
  rankExploreCandidates,
  runFolderExplorer,
} from "./explore-folder-worker.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-explore-"));
}

describe("explore-folder-worker", () => {
  let dir = "";

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("ranks 律师函 ahead of a generic txt", () => {
    const entries: ListDirEntry[] = [
      { path: "readme.txt", name: "readme.txt", kind: "file" },
      { path: "催告函.txt", name: "催告函.txt", kind: "file" },
      { path: "买卖合同.docx", name: "买卖合同.docx", kind: "file" },
    ];
    const ranked = rankExploreCandidates(entries, "合同审查");
    expect(ranked[0]?.name).toBe("催告函.txt");
  });

  it("demotes 合同 when notGoal rejects 合同审核 even without the 审查 substring", () => {
    const entries: ListDirEntry[] = [
      { path: "框架协议.docx", name: "框架协议.docx", kind: "file" },
      { path: "律师函.txt", name: "律师函.txt", kind: "file" },
    ];
    const ranked = rankExploreCandidates(entries, "不要审核合同", "核对接律师函");
    expect(ranked[0]?.name).toBe("律师函.txt");
  });

  it("walks a folder and peeks the letter when the brief is complete", async () => {
    dir = tmpDir();
    const folder = path.join(dir, "河南堃云顿数据科技有限公司");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "律师函.txt"), "关于催告贵司支付服务费一事。", "utf8");
    fs.writeFileSync(path.join(folder, "notes.md"), "内部备忘", "utf8");

    const result = await runFolderExplorer(
      {
        workspaceDir: dir,
        sessionId: "s1",
        projectDir: dir,
      },
      {
        goal: "根据文件夹核对接律师函是否有误",
        notGoal: "合同审查、审阅痕迹稿",
        path: "河南堃云顿数据科技有限公司",
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(String(result.data.instructions)).toContain("只读探查工");
    expect(FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS).toContain("禁止改稿");
    const peeks = result.data.peeks as Array<{ path: string; excerpt: string }>;
    expect(peeks.some((p) => p.excerpt.includes("催告"))).toBe(true);
  });

  it("rejects a vague brief", async () => {
    const result = await runFolderExplorer(
      { workspaceDir: tmpDir(), sessionId: "s1" },
      { goal: "帮我看看" },
    );
    expect(result.ok).toBe(false);
  });

  it("does not walk the workspace root when path is missing", async () => {
    const result = await runFolderExplorer(
      { workspaceDir: tmpDir(), sessionId: "s1" },
      {
        goal: "根据文件夹核对接律师函是否有误",
        notGoal: "合同审查",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/请提供 path/);
  });

  it("does not treat 【交办】 as the explore path", async () => {
    const result = await runFolderExplorer(
      { workspaceDir: tmpDir(), sessionId: "s1" },
      {
        goal: "【交办】根据文件夹核对接律师函是否有误",
        notGoal: "合同审查",
        materials: "【交办】：先 explore_folder",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/请提供 path/);
    expect(result.error).not.toMatch(/交办/);
  });
});
