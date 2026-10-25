import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentContext } from "../../types.js";

/**
 * 回归：工具层**不做字符数截断**，长标准按 `##` 分节、按名取用。
 *
 * 为什么要 mock：真实内置标准最长 1,770 字符，用真数据证明不了「没有上限」。
 * 这里注入一份 30k 的合成标准，才能钉住「删掉硬上限」这件事本身。
 */
const SYNTHETIC_LONG_ID = "synthetic-long";
const SYNTHETIC_FLAT_ID = "synthetic-flat";
const SYNTHETIC_DUP_ID = "synthetic-dup";

function syntheticSkill(): string {
  const filler = "甲".repeat(2_000);
  return [
    "---",
    `id: ${SYNTHETIC_LONG_ID}`,
    "name: 合成长标准",
    "---",
    "",
    "# Skill · 合成长标准",
    "",
    "导语：这一段在分节读取时也必须带上。",
    "",
    ...Array.from({ length: 10 }, (_, index) => {
      return [`## 第${index + 1}节`, "", `${filler}-${index}`, ""].join("\n");
    }),
  ].join("\n");
}

function syntheticFlatSkill(): string {
  return [
    "---",
    `id: ${SYNTHETIC_FLAT_ID}`,
    "name: 合成无分节标准",
    "---",
    "",
    "# Skill · 合成无分节标准",
    "",
    "整篇就是一段，没有二级标题。",
  ].join("\n");
}

vi.mock("../../../skills/lawyer-capabilities.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../skills/lawyer-capabilities.js")>();
  return {
    ...actual,
    readBuiltinSkillMarkdown: (id: string) => {
      if (id === SYNTHETIC_LONG_ID) {
        return syntheticSkill();
      }
      if (id === SYNTHETIC_FLAT_ID) {
        return syntheticFlatSkill();
      }
      if (id === SYNTHETIC_DUP_ID) {
        return "# T\n\n## 交件\n\n第一节正文\n\n## 交件\n\n第二节正文\n";
      }
      return actual.readBuiltinSkillMarkdown(id);
    },
  };
});

const { readSkillTool, splitSkillSections } = await import("./read-skill-tool.js");
const { readBuiltinSkillMarkdown, readSkillPromptBodies } =
  await import("../../../skills/lawyer-capabilities.js");

function ctx(): AgentContext {
  return {
    workspaceDir: "/tmp/lawmind-read-skill",
    sessionId: "s1",
    actorId: "lawyer",
    projectDir: undefined,
    allowWebSearch: false,
    collaborationEnabled: false,
    clarificationBlockingHeavyTools: false,
    strictDangerousToolApproval: false,
  } as AgentContext;
}

type ReadSkillData = {
  body?: string;
  outline?: string[];
  section?: string;
  remainingSections?: string[];
  totalChars?: number;
  kind?: string;
  catalog?: string[];
  externalIndex?: string[];
  message?: string;
};

describe("read_skill external index", () => {
  it("returns externalIndex metadata when skill_id is omitted", async () => {
    const r = await readSkillTool.execute({}, ctx());
    expect(r.ok).toBe(true);
    const data = r.data as ReadSkillData;
    expect(Array.isArray(data.catalog)).toBe(true);
    expect(Array.isArray(data.externalIndex)).toBe(true);
    expect(data.externalIndex!.length).toBeGreaterThan(0);
    expect(data.externalIndex![0]).toContain("规范库");
    expect(data.message).toMatch(/不装包/);
  });

  it("returns canonical_index without a body for design-corpus ids", async () => {
    const r = await readSkillTool.execute({ skill_id: "legal-research-cn" }, ctx());
    expect(r.ok).toBe(true);
    const data = r.data as ReadSkillData & { sourceRepo?: string };
    expect(data.kind).toBe("canonical_index");
    expect(data.body).toBeUndefined();
    expect(data.sourceRepo).toContain("Golden2002");
    expect(data.message).toMatch(/仅元数据/);
  });
});

describe("read_skill progressive disclosure", () => {
  it("returns the whole body unchanged and lists an outline", async () => {
    const raw = readBuiltinSkillMarkdown("labor-compensation-calc");
    expect(raw).toBeTruthy();
    const r = await readSkillTool.execute({ skill_id: "labor-compensation-calc" }, ctx());
    expect(r.ok).toBe(true);
    const data = r.data as ReadSkillData;
    expect(data.body).toBe(raw!.trim());
    expect(data.body).not.toMatch(/…$/);
    expect(data.outline?.length).toBeGreaterThan(1);
    expect(data.outline?.join("")).toContain("经济补偿");
  });

  it("never slices a long body mid-text", async () => {
    const r = await readSkillTool.execute({ skill_id: SYNTHETIC_LONG_ID }, ctx());
    expect(r.ok).toBe(true);
    const data = r.data as ReadSkillData;
    const expected = syntheticSkill().trim();
    expect(data.body).toBe(expected);
    expect(data.body!.length).toBeGreaterThan(12_000);
    expect(data.totalChars).toBeGreaterThanOrEqual(expected.length);
    expect(data.outline).toHaveLength(10);
  });

  it("reads one section by title and names what was not read", async () => {
    const r = await readSkillTool.execute(
      { skill_id: "labor-compensation-calc", section: "经济补偿（劳动合同法）" },
      ctx(),
    );
    expect(r.ok).toBe(true);
    const data = r.data as ReadSkillData;
    expect(data.section).toBe("经济补偿（劳动合同法）");
    // 头部（标题与导语）在分节读取时仍要带上。
    expect(data.body).toContain("# Skill · 劳动补偿计算");
    expect(data.body).toContain("月工资：解除前十二个月平均应得工资");
    // 未读的节不能被带进来，但必须**具名**说明。
    expect(data.body).not.toContain("## 加班与双倍");
    expect(data.remainingSections).toContain("加班与双倍");
    expect(data.body).toMatch(/未读：.*加班与双倍/);
  });

  it("trims surrounding whitespace in the requested section", async () => {
    const r = await readSkillTool.execute(
      { skill_id: "contract-review-layers", section: "  每个风险点写清  " },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect((r.data as ReadSkillData).section).toBe("每个风险点写清");
  });

  it("fails with the available section titles when the section is unknown", async () => {
    const r = await readSkillTool.execute(
      { skill_id: "labor-compensation-calc", section: "不存在的节" },
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("经济补偿（劳动合同法）");
    expect(r.error).toContain("仲裁前置");
  });

  it("does not silently drop a section that shares a title with another", async () => {
    // 回归：`remaining` 曾按 id 过滤，同名节会**一起**被排除——第二个既不在正文里，
    // 也不在「未读」清单里，等于静默消失。改为按下标做身份。
    const r = await readSkillTool.execute({ skill_id: SYNTHETIC_DUP_ID, section: "交件" }, ctx());
    expect(r.ok).toBe(true);
    const data = r.data as ReadSkillData;
    expect(data.body).toContain("第一节正文");
    expect(data.body).not.toContain("第二节正文");
    expect(data.remainingSections).toEqual(["交件"]);
    expect(data.body).toMatch(/未读：交件/);
  });

  it("returns the whole body when a skill has no `##` sections", async () => {
    const r = await readSkillTool.execute(
      { skill_id: SYNTHETIC_FLAT_ID, section: "任意一节" },
      ctx(),
    );
    expect(r.ok).toBe(true);
    const data = r.data as ReadSkillData;
    expect(data.body).toBe(syntheticFlatSkill().trim());
    expect(data.outline).toHaveLength(0);
    expect(data.message).toMatch(/没有分节/);
  });
});

describe("splitSkillSections", () => {
  it("covers every non-blank line of the original", async () => {
    const raw = readBuiltinSkillMarkdown("labor-compensation-calc");
    const layout = splitSkillSections(raw!.replace(/\r\n/g, "\n"));
    // 逐行覆盖，而不是数长度：分隔空行与首尾 trim 会让「字符数相加」永远对不上。
    const assembled = [layout.head, ...layout.sections.map((s) => s.body)].join("\n");
    for (const line of raw!.replace(/\r\n/g, "\n").split("\n")) {
      if (!line.trim()) {
        continue;
      }
      expect(assembled).toContain(line);
    }
    expect(layout.head).toContain("# Skill · 劳动补偿计算");
  });

  it("keeps frontmatter inside head instead of parsing it separately", () => {
    const layout = splitSkillSections("---\nid: x\nname: 名\n---\n\n# T\n\n## 一\n\n内容");
    expect(layout.head).toContain("id: x");
    expect(layout.sections.map((s) => s.title)).toEqual(["一"]);
  });

  it("treats a body without `##` as a single head", () => {
    const layout = splitSkillSections("---\nid: x\n---\n\n# T\n\n正文");
    expect(layout.sections).toHaveLength(0);
    expect(layout.head).toContain("正文");
  });

  it("does not treat `###` as a section boundary", () => {
    const layout = splitSkillSections("# T\n\n## 一\n\n### 一·一\n\n内容\n\n## 二\n\n内容二");
    expect(layout.sections.map((s) => s.title)).toEqual(["一", "二"]);
    expect(layout.sections[0].body).toContain("### 一·一");
  });
});

describe("read_skill keeps every shipped skill whole", () => {
  it("returns each builtin body byte-for-byte with no truncation", async () => {
    const dir = pathToBuiltin();
    const ids = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3));
    expect(ids.length).toBeGreaterThan(30);
    for (const id of ids) {
      // 与工具同序解析：`readSkillPromptBodies` 优先（`contract-redline-craft`
      // 的正文在 TS 常量里，`.md` 只是元数据存根），再退回 `.md`。
      const expected = readSkillPromptBodies(undefined, [id])[0] ?? readBuiltinSkillMarkdown(id);
      expect(expected, `skill ${id} should resolve to a body`).toBeTruthy();
      const r = await readSkillTool.execute({ skill_id: id }, ctx());
      expect(r.ok, `skill ${id} should be readable`).toBe(true);
      expect((r.data as ReadSkillData).body, `skill ${id} body must be whole`).toBe(
        expected.trim(),
      );
      expect(r.data).not.toHaveProperty("truncated");
    }
  });
});

/** 与 `lawyer-capabilities.ts` 同一个内置目录（不为此再引一个导出）。 */
function pathToBuiltin(): string {
  return path.join(process.cwd(), "src/lawmind/skills/builtin");
}
