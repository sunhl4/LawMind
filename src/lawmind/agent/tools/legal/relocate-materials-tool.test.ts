/**
 * 归位材料：跨案搬移/复制的围栏、撤销与提示。
 *
 * 安全边界测试（对齐 SECURITY.md 的信任模型）：工作区围栏、真相源保护、
 * 符号链接不跟、撤销按工作区根反向回放。真实事故对应「材料被收进上一案的
 * materials/，律师在对话里要求挪回正确的案」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { revertDeskWrite } from "../../../desk/desk-apply.js";
import type { AgentContext } from "../../types.js";
import { relocateMatterMaterials } from "./relocate-materials-tool.js";

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

function seedMatter(workspaceDir: string, matterId: string, caseMd = ""): void {
  const dir = path.join(workspaceDir, "cases", matterId, "materials");
  fs.mkdirSync(dir, { recursive: true });
  if (caseMd) {
    fs.writeFileSync(path.join(workspaceDir, "cases", matterId, "CASE.md"), caseMd, "utf8");
  }
}

function ctx(workspaceDir: string, matterId?: string): AgentContext {
  return {
    workspaceDir,
    sessionId: "sess-1",
    matterId,
    actorId: "tester",
  } as AgentContext;
}

function writeMatter(workspaceDir: string, matterId: string, name: string, body = "x"): string {
  const rel = `cases/${matterId}/materials/${name}`;
  const abs = path.join(workspaceDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  return rel;
}

describe("relocate_matter_materials 跨案归位", () => {
  it("把放错案的材料挪回正确的案（真实事故）", async () => {
    const workspaceDir = tmp("lm-reloc-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    // 事故形状：`乙案` 的整包材料被收进了 `甲案/materials/` 下。
    fs.mkdirSync(path.join(workspaceDir, "cases", "甲案", "materials", "乙案材料"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "甲案", "materials", "乙案材料", "起诉状.txt"),
      "诉请",
      "utf8",
    );

    const result = await relocateMatterMaterials.execute(
      {
        ops: [
          {
            from: "cases/甲案/materials/乙案材料",
            to: "cases/乙案/materials/乙案材料",
            reason: "放错案",
          },
        ],
        goal: "把放错的材料挪回乙案",
      },
      ctx(workspaceDir, "乙案"),
    );

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(
      fs.readFileSync(
        path.join(workspaceDir, "cases", "乙案", "materials", "乙案材料", "起诉状.txt"),
        "utf8",
      ),
    ).toBe("诉请");
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "乙案材料"))).toBe(
      false,
    );
    // 撤销日志按工作区根记录，且落在目标案上。
    const data = result.data as { writeId: string; matterId: string };
    expect(data.matterId).toBe("乙案");
    // 撤销日志落在目标案的存储目录（matters/<id>/），revert_desk_write 据此回放。
    const journal = path.join(workspaceDir, "matters", "乙案", "desk-writes.jsonl");
    expect(fs.readFileSync(journal, "utf8")).toContain(data.writeId);
  });

  it("撤销按工作区根反向回放，材料回到原位", async () => {
    const workspaceDir = tmp("lm-reloc-undo-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    writeMatter(workspaceDir, "甲案", "误收.txt", "body");

    const result = await relocateMatterMaterials.execute(
      {
        ops: [{ from: "cases/甲案/materials/误收.txt", to: "cases/乙案/materials/误收.txt" }],
      },
      ctx(workspaceDir, "乙案"),
    );
    expect(result.ok).toBe(true);
    const writeId = (result.data as { writeId: string }).writeId;
    expect(fs.existsSync(path.join(workspaceDir, "cases", "乙案", "materials", "误收.txt"))).toBe(
      true,
    );

    const reverted = await revertDeskWrite(workspaceDir, "乙案", writeId);
    expect(reverted.ok, JSON.stringify(reverted)).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "误收.txt"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(workspaceDir, "cases", "乙案", "materials", "误收.txt"))).toBe(
      false,
    );
  });

  it("copy=true 是复制：源文件留在原处，撤销删掉复制件", async () => {
    const workspaceDir = tmp("lm-reloc-copy-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    writeMatter(workspaceDir, "甲案", "合同.pdf", "pdf-bytes");

    const result = await relocateMatterMaterials.execute(
      {
        ops: [
          {
            from: "cases/甲案/materials/合同.pdf",
            to: "cases/乙案/materials/合同.pdf",
            copy: true,
          },
        ],
      },
      ctx(workspaceDir, "乙案"),
    );
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "合同.pdf"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(workspaceDir, "cases", "乙案", "materials", "合同.pdf"))).toBe(
      true,
    );

    const writeId = (result.data as { writeId: string }).writeId;
    await revertDeskWrite(workspaceDir, "乙案", writeId);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "合同.pdf"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(workspaceDir, "cases", "乙案", "materials", "合同.pdf"))).toBe(
      false,
    );
  });

  it("复制件被律师改过时不静默删除", async () => {
    const workspaceDir = tmp("lm-reloc-edited-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    writeMatter(workspaceDir, "甲案", "证据.txt", "orig");

    const result = await relocateMatterMaterials.execute(
      {
        ops: [
          {
            from: "cases/甲案/materials/证据.txt",
            to: "cases/乙案/materials/证据.txt",
            copy: true,
          },
        ],
      },
      ctx(workspaceDir, "乙案"),
    );
    const writeId = (result.data as { writeId: string }).writeId;
    // 律师在复制件上批注过 → 撤销不能删掉他的批注。
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "乙案", "materials", "证据.txt"),
      "orig + 律师批注",
      "utf8",
    );
    const reverted = await revertDeskWrite(workspaceDir, "乙案", writeId);
    expect(reverted.ok).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "乙案", "materials", "证据.txt"))).toBe(
      true,
    );
  });
});

describe("relocate_matter_materials 围栏", () => {
  it("拒绝搬移案件真相源文件", async () => {
    const workspaceDir = tmp("lm-reloc-prot-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    fs.writeFileSync(path.join(workspaceDir, "cases", "甲案", "CASE.md"), "# 甲案", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "cases", "甲案", "materials", "x.txt"), "x", "utf8");

    for (const from of [
      "cases/甲案/CASE.md",
      "cases/甲案/deadlines.jsonl",
      "cases/甲案/desk-writes.jsonl",
      "cases/甲案",
    ]) {
      const result = await relocateMatterMaterials.execute(
        { ops: [{ from, to: "cases/乙案/materials/x.txt" }] },
        ctx(workspaceDir, "乙案"),
      );
      expect(result.ok, `${from} 不应被允许搬移`).toBe(false);
    }
  });

  it("拒绝越出工作区与治理目录", async () => {
    const workspaceDir = tmp("lm-reloc-escape-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    fs.mkdirSync(path.join(workspaceDir, "lawmind"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "lawmind", "policy.json"), "{}", "utf8");
    writeMatter(workspaceDir, "甲案", "a.txt");

    for (const to of [
      "../outside.txt",
      "/etc/passwd",
      "lawmind/policy.json",
      "audit/x.jsonl",
      "notes/x.md",
    ]) {
      const result = await relocateMatterMaterials.execute(
        { ops: [{ from: "cases/甲案/materials/a.txt", to }] },
        ctx(workspaceDir, "乙案"),
      );
      expect(result.ok, `${to} 不应被允许作为目标`).toBe(false);
    }
  });

  it("目标案件不存在时拒绝（不用搬移造幽灵案件）", async () => {
    const workspaceDir = tmp("lm-reloc-nomatter-");
    seedMatter(workspaceDir, "甲案");
    writeMatter(workspaceDir, "甲案", "a.txt");

    const result = await relocateMatterMaterials.execute(
      { ops: [{ from: "cases/甲案/materials/a.txt", to: "cases/不存在的案/materials/a.txt" }] },
      ctx(workspaceDir, "甲案"),
    );
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "不存在的案"))).toBe(false);
  });

  it("目标已存在时拒绝，不覆盖律师已有材料", async () => {
    const workspaceDir = tmp("lm-reloc-collide-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    writeMatter(workspaceDir, "甲案", "同名.txt", "from-a");
    writeMatter(workspaceDir, "乙案", "同名.txt", "from-b");

    const result = await relocateMatterMaterials.execute(
      { ops: [{ from: "cases/甲案/materials/同名.txt", to: "cases/乙案/materials/同名.txt" }] },
      ctx(workspaceDir, "乙案"),
    );
    expect(result.ok).toBe(false);
    expect(
      fs.readFileSync(path.join(workspaceDir, "cases", "乙案", "materials", "同名.txt"), "utf8"),
    ).toBe("from-b");
  });

  it("把收件区 uploads/ 的材料收进本案", async () => {
    const workspaceDir = tmp("lm-reloc-uploads-");
    seedMatter(workspaceDir, "甲案");
    const abs = path.join(workspaceDir, "uploads", "拖进来的.pdf");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "bytes", "utf8");

    const result = await relocateMatterMaterials.execute(
      {
        ops: [{ from: "uploads/拖进来的.pdf", to: "cases/甲案/materials/拖进来的.pdf" }],
      },
      ctx(workspaceDir, "甲案"),
    );
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceDir, "cases", "甲案", "materials", "拖进来的.pdf")),
    ).toBe(true);
  });

  it("符号链接不搬移", async () => {
    const workspaceDir = tmp("lm-reloc-symlink-");
    seedMatter(workspaceDir, "甲案");
    seedMatter(workspaceDir, "乙案");
    const outside = tmp("lm-reloc-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(workspaceDir, "cases", "甲案", "materials", "link.txt"),
    );

    const result = await relocateMatterMaterials.execute(
      { ops: [{ from: "cases/甲案/materials/link.txt", to: "cases/乙案/materials/link.txt" }] },
      ctx(workspaceDir, "乙案"),
    );
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "cases", "乙案", "materials", "link.txt"))).toBe(
      false,
    );
  });

  it("当事人对立时不禁办，但在结果里提示核对利益冲突", async () => {
    const workspaceDir = tmp("lm-reloc-conflict-");
    fs.mkdirSync(path.join(workspaceDir, "cases", "甲案", "materials"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "甲案", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 刘学江\n- 对方当事人: 岚江公司\n\n## 2. 其他\n",
      "utf8",
    );
    fs.mkdirSync(path.join(workspaceDir, "cases", "岚江公司案", "materials"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "岚江公司案", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 岚江公司\n- 对方当事人: 刘学江\n\n## 2. 其他\n",
      "utf8",
    );
    writeMatter(workspaceDir, "甲案", "放错的.txt");

    const result = await relocateMatterMaterials.execute(
      {
        ops: [
          { from: "cases/甲案/materials/放错的.txt", to: "cases/岚江公司案/materials/放错的.txt" },
        ],
      },
      ctx(workspaceDir, "岚江公司案"),
    );
    // 材料本来就已经放错：拒绝只会把错误留在原处，所以照办。
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const advisories = (result.data as { advisories?: string[] }).advisories ?? [];
    expect(advisories.join("")).toContain("利益冲突");
  });

  it("没有 matterId 时给出可选案件的结构化提示", async () => {
    const workspaceDir = tmp("lm-reloc-nomatterid-");
    seedMatter(workspaceDir, "甲案");
    writeMatter(workspaceDir, "甲案", "a.txt");

    const result = await relocateMatterMaterials.execute(
      { ops: [{ from: "cases/甲案/materials/a.txt", to: "cases/甲案/materials/b.txt" }] },
      ctx(workspaceDir, undefined),
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ needsMatter: true });
  });
});
