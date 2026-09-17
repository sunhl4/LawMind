import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListDirEntry } from "../runtime/list-dir.js";
import {
  FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS,
  parseExploreModelText,
  rankExploreCandidates,
  runFolderExplorer,
} from "./explore-folder-worker.js";

vi.mock("./runtime-model-call.js", () => ({
  ModelCallUserAbortError: class ModelCallUserAbortError extends Error {
    override name = "ModelCallUserAbortError";
  },
  callModelWithRetry: vi.fn(),
}));

import { callModelWithRetry } from "./runtime-model-call.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-explore-"));
}

const model = {
  provider: "openai-compatible" as const,
  model: "test-model",
  apiKey: "k",
  baseUrl: "http://localhost",
  contextTokens: 128_000,
};

describe("explore-folder-worker", () => {
  let dir = "";

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
    vi.mocked(callModelWithRetry).mockReset();
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
    expect(vi.mocked(callModelWithRetry)).not.toHaveBeenCalled();
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

  it("parses explore JSON payloads", () => {
    const parsed = parseExploreModelText(
      JSON.stringify({
        candidates: ["催告函.txt"],
        peeks: [{ path: "催告函.txt", excerpt: "催告付款" }],
        summary: "找到催告函",
      }),
    );
    expect(parsed?.candidates).toEqual(["催告函.txt"]);
    expect(parsed?.summary).toBe("找到催告函");
  });

  it("runs a read-only sidecar when chatModel is present", async () => {
    dir = tmpDir();
    const folder = path.join(dir, "客户夹");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "律师函.txt"), "关于催告贵司支付服务费一事。", "utf8");
    vi.mocked(callModelWithRetry).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidates: ["律师函.txt"],
              peeks: [{ path: "律师函.txt", excerpt: "关于催告贵司支付服务费一事。" }],
              summary: "目录内催告函可核对",
            }),
          },
        },
      ],
    });
    const result = await runFolderExplorer(
      {
        workspaceDir: dir,
        sessionId: "s1",
        projectDir: dir,
        chatModel: model,
      },
      {
        goal: "根据文件夹核对接律师函是否有误",
        notGoal: "合同审查",
        path: "客户夹",
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(vi.mocked(callModelWithRetry)).toHaveBeenCalled();
    expect(result.data.summary).toBe("目录内催告函可核对");
    const advertised = vi.mocked(callModelWithRetry).mock.calls[0]?.[2] as Array<{
      function?: { name?: string };
    }>;
    expect(advertised.map((row) => row.function?.name)).toEqual(
      expect.arrayContaining(["list_dir", "analyze_document"]),
    );
    expect(advertised.map((row) => row.function?.name)).not.toContain("explore_folder");
    expect(advertised.map((row) => row.function?.name)).not.toContain("draft_document");
  });

  it("stays deterministic when already inside a readonly worker loop", async () => {
    dir = tmpDir();
    const folder = path.join(dir, "客户夹");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "律师函.txt"), "催告付款", "utf8");
    const result = await runFolderExplorer(
      {
        workspaceDir: dir,
        sessionId: "s1",
        projectDir: dir,
        chatModel: model,
        inReadonlyWorkerLoop: true,
      },
      {
        goal: "根据文件夹核对接律师函是否有误",
        notGoal: "合同审查",
        path: "客户夹",
      },
    );
    expect(result.ok).toBe(true);
    expect(vi.mocked(callModelWithRetry)).not.toHaveBeenCalled();
  });
});
