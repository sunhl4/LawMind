/**
 * 一般文件操作（`apply_file_ops`）：工作区内的改名/搬移/复制。
 *
 * 这是模型缺的那只通用"手"：在它之前，模型能在工作区新建/覆盖文件，却改不了已有
 * 文件的位置和名字。测试重点是围栏与撤销（对齐 SECURITY.md 的信任模型）：
 * 真相源不可碰、越界拒绝、符号链接不跟、撤销按工作区根反向回放、复制件被改过不删。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { revertDeskWrite } from "../../../desk/desk-apply.js";
import type { AgentContext } from "../../types.js";
import { applyFileOps } from "./workspace-file-ops-tool.js";

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspaceDir: string, matterId?: string): AgentContext {
  return { workspaceDir, sessionId: "sess-1", matterId, actorId: "tester" } as AgentContext;
}

function writeRel(workspaceDir: string, rel: string, body = "x"): void {
  const abs = path.join(workspaceDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function seedMatter(workspaceDir: string, matterId: string): void {
  fs.mkdirSync(path.join(workspaceDir, "cases", matterId, "materials"), { recursive: true });
}

describe("apply_file_ops 改名/搬移/复制", () => {
  it("把材料改名（律师的归档系统）", async () => {
    const workspaceDir = tmp("lm-fops-rename-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/扫描件001.pdf", "pdf");

    const result = await applyFileOps.execute(
      {
        ops: [
          {
            from: "cases/甲案/materials/扫描件001.pdf",
            to: "cases/甲案/materials/2026-03-01 民事起诉状.pdf",
            reason: "按内容改名",
          },
        ],
        goal: "把扫描件按内容改名",
      },
      ctx(workspaceDir, "甲案"),
    );
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceDir, "cases", "甲案", "materials", "2026-03-01 民事起诉状.pdf"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "扫描件001.pdf")),
    ).toBe(false);
  });

  it("复制一份留作对照，源文件保留", async () => {
    const workspaceDir = tmp("lm-fops-copy-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/合同.docx", "docx-bytes");

    const result = await applyFileOps.execute(
      {
        ops: [
          {
            from: "cases/甲案/materials/合同.docx",
            to: "cases/甲案/materials/合同（对方回稿对照）.docx",
            copy: true,
          },
        ],
      },
      ctx(workspaceDir, "甲案"),
    );
    expect(result.ok).toBe(true);
    const data = result.data as { copiedCount: number; movedCount: number };
    expect(data.copiedCount).toBe(1);
    expect(data.movedCount).toBe(0);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "合同.docx"))).toBe(
      true,
    );
  });

  it("搬到新建的子目录（父目录按需创建）", async () => {
    const workspaceDir = tmp("lm-fops-nested-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/收据.pdf", "r");

    const result = await applyFileOps.execute(
      {
        ops: [
          { from: "cases/甲案/materials/收据.pdf", to: "cases/甲案/materials/证据/付款/收据.pdf" },
        ],
      },
      ctx(workspaceDir, "甲案"),
    );
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceDir, "cases", "甲案", "materials", "证据", "付款", "收据.pdf"),
      ),
    ).toBe(true);
  });

  it("撤销按工作区根反向回放（含改名与新建目录）", async () => {
    const workspaceDir = tmp("lm-fops-undo-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/乱名.txt", "body");

    const result = await applyFileOps.execute(
      {
        ops: [{ from: "cases/甲案/materials/乱名.txt", to: "cases/甲案/materials/证据/新名.txt" }],
      },
      ctx(workspaceDir, "甲案"),
    );
    const writeId = (result.data as { writeId: string }).writeId;
    expect(
      fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "证据", "新名.txt")),
    ).toBe(true);

    const reverted = await revertDeskWrite(workspaceDir, "甲案", writeId);
    expect(reverted.ok, JSON.stringify(reverted)).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "乱名.txt"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "证据", "新名.txt")),
    ).toBe(false);
  });

  it("复制件被律师改过时撤销不删除", async () => {
    const workspaceDir = tmp("lm-fops-copy-edited-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/原稿.txt", "orig");

    const result = await applyFileOps.execute(
      {
        ops: [
          {
            from: "cases/甲案/materials/原稿.txt",
            to: "cases/甲案/materials/副本.txt",
            copy: true,
          },
        ],
      },
      ctx(workspaceDir, "甲案"),
    );
    const writeId = (result.data as { writeId: string }).writeId;
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "甲案", "materials", "副本.txt"),
      "律师批注过的内容",
      "utf8",
    );

    const reverted = await revertDeskWrite(workspaceDir, "甲案", writeId);
    expect(reverted.ok).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "副本.txt"))).toBe(
      true,
    );
  });
});

describe("apply_file_ops 围栏", () => {
  it("治理目录与真相源一律拒绝", async () => {
    const workspaceDir = tmp("lm-fops-prot-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "lawmind/policy.json", "{}");
    writeRel(workspaceDir, "audit/a.jsonl", "{}\n");
    writeRel(workspaceDir, "cases/甲案/CASE.md", "# 甲案");
    writeRel(workspaceDir, "cases/甲案/materials/a.txt", "a");
    writeRel(workspaceDir, ".env", "SECRET=1");

    for (const from of [
      "lawmind/policy.json",
      "audit/a.jsonl",
      "cases/甲案/CASE.md",
      ".env",
      "cases/甲案/materials/a.txt",
    ]) {
      const result = await applyFileOps.execute(
        { ops: [{ from, to: `${from}.moved` }] },
        ctx(workspaceDir, "甲案"),
      );
      if (from === "cases/甲案/materials/a.txt") {
        // 唯一的合法条目应当成功。
        expect(result.ok, "案件材料应可搬移").toBe(true);
        continue;
      }
      expect(result.ok, `${from} 不应被允许操作`).toBe(false);
    }
  });

  it("drafts/ 与 artifacts/ 拒绝（路径被任务记录引用）", async () => {
    const workspaceDir = tmp("lm-fops-engine-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "drafts/t1.json", "{}");
    writeRel(workspaceDir, "artifacts/交付/意见书.docx", "docx");

    for (const from of ["drafts/t1.json", "artifacts/交付/意见书.docx"]) {
      const result = await applyFileOps.execute(
        { ops: [{ from, to: `${from}.bak` }] },
        ctx(workspaceDir, "甲案"),
      );
      expect(result.ok, `${from} 不应被允许操作`).toBe(false);
    }
  });

  it("越出工作区拒绝", async () => {
    const workspaceDir = tmp("lm-fops-escape-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/a.txt", "a");

    for (const to of ["../outside.txt", "/etc/passwd"]) {
      const result = await applyFileOps.execute(
        { ops: [{ from: "cases/甲案/materials/a.txt", to }] },
        ctx(workspaceDir, "甲案"),
      );
      expect(result.ok, `${to} 不应被允许`).toBe(false);
    }
  });

  it("符号链接不跟", async () => {
    const workspaceDir = tmp("lm-fops-symlink-");
    seedMatter(workspaceDir, "甲案");
    const outside = tmp("lm-fops-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(workspaceDir, "cases", "甲案", "materials", "link.txt"),
    );

    const result = await applyFileOps.execute(
      {
        ops: [
          {
            from: "cases/甲案/materials/link.txt",
            to: "cases/甲案/materials/copied.txt",
            copy: true,
          },
        ],
      },
      ctx(workspaceDir, "甲案"),
    );
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "copied.txt"))).toBe(
      false,
    );
  });

  it("目标已存在时不覆盖", async () => {
    const workspaceDir = tmp("lm-fops-collide-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/a.txt", "from-a");
    writeRel(workspaceDir, "cases/甲案/materials/b.txt", "from-b");

    const result = await applyFileOps.execute(
      { ops: [{ from: "cases/甲案/materials/a.txt", to: "cases/甲案/materials/b.txt" }] },
      ctx(workspaceDir, "甲案"),
    );
    expect(result.ok).toBe(false);
    expect(
      fs.readFileSync(path.join(workspaceDir, "cases", "甲案", "materials", "b.txt"), "utf8"),
    ).toBe("from-b");
  });

  it("没有 matterId 时给出可选案件的结构化提示", async () => {
    const workspaceDir = tmp("lm-fops-nomatter-");
    seedMatter(workspaceDir, "甲案");
    writeRel(workspaceDir, "cases/甲案/materials/a.txt", "a");

    const result = await applyFileOps.execute(
      { ops: [{ from: "cases/甲案/materials/a.txt", to: "cases/甲案/materials/b.txt" }] },
      ctx(workspaceDir, undefined),
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ needsMatter: true });
  });
});
