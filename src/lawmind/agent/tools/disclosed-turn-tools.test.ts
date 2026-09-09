import { describe, expect, it } from "vitest";
import { mergeTurnDisclosedToolNames, pinsIncludeXlsx } from "./disclosed-turn-tools.js";

describe("disclosed-turn-tools", () => {
  it("auto-discloses spreadsheet tools when an xlsx is pinned", () => {
    const pins = [
      {
        pinKind: "file" as const,
        root: "workspace" as const,
        relPath: "费用.xlsx",
        kind: "file" as const,
      },
    ];
    expect(pinsIncludeXlsx(pins)).toBe(true);
    const names = mergeTurnDisclosedToolNames({
      session: {},
      workspaceDir: "/tmp/does-not-need-skills",
      pins,
    });
    expect(names).toContain("analyze_spreadsheet");
    expect(names).toContain("write_spreadsheet");
    expect(names).toContain("render_chart");
  });

  it("does not let a skill disclose outbound tools", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { signSkillBody, skillSignatureSecret, writeSkillEnabled } =
      await import("../../skills/skill-runtime.js");
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-deny-"));
    const dir = path.join(ws, "lawmind", "skills", "evil");
    fs.mkdirSync(dir, { recursive: true });
    const body = `---
id: evil
name: evil
version: 1
tools: send_email, analyze_spreadsheet
---
x
`;
    fs.writeFileSync(path.join(dir, "SKILL.md"), body, "utf8");
    fs.writeFileSync(
      path.join(dir, "SKILL.sig"),
      `${signSkillBody(body, skillSignatureSecret(ws))}\n`,
      "utf8",
    );
    writeSkillEnabled(ws, "evil", true);
    const names = mergeTurnDisclosedToolNames({ session: {}, workspaceDir: ws });
    expect(names).toContain("analyze_spreadsheet");
    expect(names).not.toContain("send_email");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("discloses calculate for labor calc and case law for research", async () => {
    const { extraToolsForInstruction } = await import("./disclosed-turn-tools.js");
    expect(extraToolsForInstruction("计算违法解除的经济补偿")).toContain("calculate");
    expect(extraToolsForInstruction("查一下民法典违约责任")).toContain("search_case_law");
    expect(extraToolsForInstruction("整理这些进项发票")).toEqual(
      expect.arrayContaining(["calculate", "analyze_spreadsheet"]),
    );
    expect(extraToolsForInstruction("把法院短信里的开庭时间整理出来")).toContain("calculate");
    expect(extraToolsForInstruction("这份专利侵权材料怎么主张")).toContain("search_case_law");
    expect(extraToolsForInstruction("做一份股权收购尽调提纲")).toContain("search_case_law");
    expect(extraToolsForInstruction("这份离婚诉讼材料怎么主张抚养权")).toEqual(
      expect.arrayContaining(["search_case_law", "calculate"]),
    );
    expect(extraToolsForInstruction("核对招股说明书信息披露备忘")).toContain("search_case_law");
    expect(extraToolsForInstruction("起草这份董事会决议")).toContain("search_case_law");
    expect(extraToolsForInstruction("出一份广告合规备忘")).toContain("search_case_law");
    expect(extraToolsForInstruction("请审查这份采购合同")).toContain("search_case_law");
    expect(extraToolsForInstruction("修改合同")).not.toContain("calculate");
    expect(extraToolsForInstruction("【邮件合同审阅改稿 · 短路径】\nmatterId=`m1`")).not.toContain(
      "calculate",
    );
    expect(
      extraToolsForInstruction(
        [
          "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
          "- [项目 · 路径引用] `合作协议.docx`",
          "修改合同",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
