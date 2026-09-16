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
    expect(names).toContain("run_compute");
  });

  it("always discloses run_compute unless a lock path applies", () => {
    const names = mergeTurnDisclosedToolNames({
      session: {},
      workspaceDir: "/tmp/does-not-need-skills",
    });
    expect(names).toContain("run_compute");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("search_statute_web");
    expect(names).not.toContain("deep_research");
    expect(names).not.toContain("url_dossier");
    expect(names).toContain("list_dir");
    expect(names).toContain("explore_folder");
    expect(names).toContain("search_conversations");
    expect(names).toContain("read_conversation");
    expect(names).toContain("search_workspace");
    expect(names).toContain("list_mail_inbox");
    expect(names).toContain("read_skill");
    expect(names).toContain("search_company_registry");
  });

  it("does not auto-disclose deep_research for entertainment public-web facts", () => {
    const names = mergeTurnDisclosedToolNames({
      session: {},
      workspaceDir: "/tmp/does-not-need-skills",
      instruction: "查一下2026年新说唱总冠军",
    });
    expect(names).toContain("web_search");
    expect(names).not.toContain("deep_research");
  });

  it("discloses compute tools when the instruction needs tables or charts", async () => {
    const { extraToolsForInstruction } = await import("./disclosed-turn-tools.js");
    expect(extraToolsForInstruction("请分析这张费用表并出图")).toEqual(
      expect.arrayContaining(["run_compute", "render_chart", "write_spreadsheet"]),
    );
    expect(extraToolsForInstruction("修改合同")).not.toContain("run_compute");
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
    expect(extraToolsForInstruction("查一下民法典违约责任")).toContain("search_statute_web");
    expect(extraToolsForInstruction("用公开网页查一下开庭公告")).toEqual(
      expect.arrayContaining(["web_search", "search_statute_web"]),
    );
    expect(extraToolsForInstruction("查一下2026年新说唱总冠军")).toEqual(["web_search"]);
    expect(extraToolsForInstruction("查一下2026年新说唱总冠军")).not.toContain("search_case_law");
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
    expect(extraToolsForInstruction("请审查这份采购合同")).toEqual(
      expect.arrayContaining(["search_case_law", "calculate", "search_workspace"]),
    );
    expect(extraToolsForInstruction("请审查这份采购合同")).not.toContain("draft_document");
    expect(extraToolsForInstruction("请审查这份采购合同")).not.toContain("render_tracked_draft");
    expect(
      extraToolsForInstruction("请审查这份采购合同", {
        pins: [
          {
            pinKind: "file",
            root: "project",
            relPath: "采购合同.docx",
            kind: "file",
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "draft_document",
        "render_tracked_draft",
        "search_case_law",
        "calculate",
        "search_workspace",
      ]),
    );
    expect(extraToolsForInstruction("【邮件合同审阅改稿 · 短路径】\nmatterId=`m1`")).toContain(
      "search_workspace",
    );
    expect(extraToolsForInstruction("【邮件合同审阅改稿 · 短路径】\nmatterId=`m1`")).toContain(
      "render_tracked_draft",
    );
    expect(
      extraToolsForInstruction("帮我看看", {
        pins: [
          {
            pinKind: "file",
            root: "project",
            relPath: "买卖合同.docx",
            kind: "file",
          },
        ],
      }),
    ).not.toContain("render_tracked_draft");
    expect(
      extraToolsForInstruction("帮我看看", {
        pins: [
          {
            pinKind: "file",
            root: "project",
            relPath: "买卖合同.docx",
            kind: "file",
          },
        ],
      }),
    ).not.toContain("draft_document");
    expect(extraToolsForInstruction("他一直拖欠工资这算不算违法")).not.toContain("draft_document");
    expect(extraToolsForInstruction("计算违法解除的经济补偿")).not.toContain("draft_document");
    expect(
      extraToolsForInstruction("核对我起草的律师函是否有误", {
        pins: [
          {
            pinKind: "file",
            root: "project",
            relPath: "律师函.docx",
            kind: "file",
          },
        ],
      }),
    ).not.toContain("draft_document");
    expect(
      extraToolsForInstruction(
        [
          "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
          "- [项目 · 路径引用] `合作协议.docx`",
          "修改合同",
        ].join("\n"),
      ),
    ).toEqual(
      expect.arrayContaining(["draft_document", "render_tracked_draft", "search_workspace"]),
    );
  });

  it("does not auto-disclose MCP tools until list_more_tools names them", () => {
    const names = mergeTurnDisclosedToolNames({
      session: {},
      workspaceDir: "/tmp/does-not-need-skills",
      registry: {
        listDefinitions: () => [{ name: "mcp__mock__echo_note" }],
      } as never,
    });
    expect(names).not.toContain("mcp__mock__echo_note");
    const after = mergeTurnDisclosedToolNames({
      session: { disclosedToolNames: ["mcp__mock__echo_note"] },
      workspaceDir: "/tmp/does-not-need-skills",
      registry: {
        listDefinitions: () => [{ name: "mcp__mock__echo_note" }],
      } as never,
    });
    expect(after).toContain("mcp__mock__echo_note");
  });

  it("always discloses list_dir; directory pins also disclose host file tools", () => {
    const names = mergeTurnDisclosedToolNames({
      session: {},
      workspaceDir: "/tmp/does-not-need-skills",
      pins: [
        {
          pinKind: "file",
          root: "workspace",
          relPath: "materials/证据包",
          kind: "directory",
        },
      ],
    });
    expect(names).toContain("list_dir");
    expect(names).toContain("search_host");
    expect(names).toContain("read_host_file");
  });
});
