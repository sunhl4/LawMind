import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  familyIdFromLabel,
  formatWordRevisionChecklistBlock,
  loadWordRevisionPack,
  parseChecklistMarkdown,
  resolveWordRevisionChecklist,
  serializeChecklistMarkdown,
  upsertWordRevisionMarkers,
  WORD_REVISION_FAMILY_LABEL,
  WORD_REVISION_PACK_VERSION,
} from "./word-revision-checklist.js";
import { PROCUREMENT_WORD_REVISION_PACK } from "./word-revision-packs.js";

describe("word-revision-checklist", () => {
  it("parses explicit type and stance markers", () => {
    const r = resolveWordRevisionChecklist({
      instruction: "【Word 改稿】\n改稿类型：采购供货\n己方立场：甲方\n改合同",
    });
    expect(r.family).toBe("procurement");
    expect(r.familySource).toBe("explicit");
    expect(
      formatWordRevisionChecklistBlock({
        instruction: "改稿类型：股权融资\n己方立场：甲方\n改合同",
      }),
    ).toContain("《九民纪要》第5条");
    expect(r.stance).toBe("甲方");
    expect(r.stanceSource).toBe("explicit");
  });

  it("hints a unique family from the filename and stance from 代表甲方", () => {
    const r = resolveWordRevisionChecklist({
      instruction: "改合同，代表甲方森亿，导出带修订 Word",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "设备采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(r.family).toBe("procurement");
    expect(r.familySource).toBe("hint");
    expect(r.stance).toBe("甲方");
    expect(r.stanceSource).toBe("hint");
  });

  it("does not hint a family from ASCII substrings or generic words", () => {
    const pin = (relPath: string) => ({
      pinKind: "file" as const,
      root: "project" as const,
      relPath,
      kind: "file" as const,
    });
    expect(
      resolveWordRevisionChecklist({ instruction: "修改合同", pins: [pin("SHANGHAI_NDA.docx")] })
        .family,
    ).toBeUndefined();
    expect(
      resolveWordRevisionChecklist({
        instruction: "修改合同",
        pins: [pin("disparate-services.docx")],
      }).family,
    ).toBeUndefined();
    expect(
      resolveWordRevisionChecklist({ instruction: "修改合同", pins: [pin("员工持股计划.docx")] })
        .family,
    ).toBe("equity");
  });

  it("carries 2024–2025 authorities in the packs", () => {
    const eq = formatWordRevisionChecklistBlock({
      instruction: "改稿类型：股权融资\n己方立场：甲方\n改合同",
    });
    expect(eq).toContain("法答网");
    expect(eq).toContain("第88条");
    expect(eq).toContain("第57条");
    expect(eq).toContain("第89条");
    const pr = formatWordRevisionChecklistBlock({
      instruction: "改稿类型：采购供货\n己方立场：乙方\n改合同",
    });
    expect(pr).toContain("背靠背");
    expect(pr).toContain("法释〔2024〕11号");
    const em = formatWordRevisionChecklistBlock({
      instruction: "改稿类型：人事用工\n己方立场：甲方\n改劳动合同",
    });
    expect(em).toContain("特殊待遇");
    expect(em).toContain("第12条");
    expect(em).toContain("第40条第1、2项");
  });

  it("resolves the six new families and carries their key authorities", () => {
    const cases: Array<[string, string, string]> = [
      ["股权转让协议.docx", "ma", "第84条"],
      ["借款合同.docx", "loan", "一般保证"],
      ["建设工程施工合同.docx", "construction", "优先受偿权"],
      ["厂房租赁合同.docx", "lease", "第705条"],
      ["软件开发合同.docx", "tech", "第859条"],
      ["公司章程修正案.docx", "charter", "审计委员会"],
    ];
    for (const [file, family, needle] of cases) {
      const r = resolveWordRevisionChecklist({
        instruction: "修改合同",
        pins: [{ pinKind: "file", root: "project", relPath: file, kind: "file" }],
      });
      expect(r.family).toBe(family);
      const block = formatWordRevisionChecklistBlock({
        instruction: `改稿类型：${WORD_REVISION_FAMILY_LABEL[family as keyof typeof WORD_REVISION_FAMILY_LABEL]}\n己方立场：甲方\n改合同`,
      });
      expect(block).toContain(needle);
    }
  });

  it("does not force a family on a generic 战略合作框架 Word", () => {
    const r = resolveWordRevisionChecklist({
      instruction: "修改合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "战略合作框架协议.docx",
          kind: "file",
        },
      ],
    });
    expect(r.family).toBeUndefined();
    expect(r.familySource).toBe("none");
  });

  it("hints 技术与许可 from 人工智能 in the filename", () => {
    const r = resolveWordRevisionChecklist({
      instruction: "修改合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "泰国医疗人工智能战略合作框架协.docx",
          kind: "file",
        },
      ],
    });
    expect(r.family).toBe("tech");
    expect(r.familySource).toBe("hint");
  });

  it("infers a family from contract body when the filename is generic", () => {
    const r = resolveWordRevisionChecklist({
      instruction: "修改合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "战略合作框架协议.docx",
          kind: "file",
        },
      ],
      documentText: "甲方委托乙方进行软件开发，并授予技术许可与许可使用范围。",
    });
    expect(r.family).toBe("tech");
    expect(r.familySource).toBe("inferred");
    expect(
      formatWordRevisionChecklistBlock({
        instruction: "修改合同",
        documentText: "甲方委托乙方进行软件开发，并授予技术许可与许可使用范围。",
      }),
    ).toContain("正文更像「技术与许可」");
  });

  it("does not apply a filename guess as a checklist", () => {
    const block = formatWordRevisionChecklistBlock({
      instruction: "修改合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "《聘用合同》（劳务合同）.docx",
          kind: "file",
        },
      ],
    });
    expect(block).toContain("不要按文件名套用类型清单");
    expect(block).not.toContain("已套该类要点");
    expect(block).not.toContain("### em.");
  });

  it("lets the contract body beat a conflicting filename", () => {
    const r = resolveWordRevisionChecklist({
      instruction: "修改合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "设备采购合同.docx",
          kind: "file",
        },
      ],
      documentText: "甲方委托乙方进行软件开发，并授予技术许可与许可使用范围。",
    });
    expect(r.family).toBe("tech");
    expect(r.familySource).toBe("inferred");
  });

  it("formats confirmed 甲方 items without the other side's 改", () => {
    const block = formatWordRevisionChecklistBlock({
      instruction: "改稿类型：人事用工\n己方立场：甲方\n改劳动合同",
    });
    expect(block).toContain("律师选定「人事用工」");
    expect(block).toContain("甲方侧按用人单位常见诉求写");
    expect(block).toContain("己方立场：甲方");
    expect(block).toContain("不得约定超过法定上限的试用期");
    expect(block).toContain("《劳动合同法》第19条");
    expect(block).toContain("劳动争议司法解释（二）");
    expect(block).toContain("制定法与司法解释优先");
    expect(block).not.toContain("改·乙方：");
    expect(block).toContain("检查单不是必须全改");
  });

  it("keeps unspecified type from applying any pack", () => {
    const block = formatWordRevisionChecklistBlock({
      instruction: "【Word 改稿】\n修改合同",
    });
    expect(block).toContain("未识别合同类型");
    expect(block).not.toContain("### pr.pay");
    expect(block).not.toContain("### eq.price");
  });

  it("frames inferred points as review对照 when purpose is review", () => {
    const block = formatWordRevisionChecklistBlock({
      instruction: "【交办】5 分钟合同审查",
      documentText: "委托开发软件，约定技术许可。",
      purpose: "review",
    });
    expect(block).toContain("## 审查对照要点");
    expect(block).toContain("用于对照写意见");
    expect(block).toContain("### tech.scope");
  });

  it("upserts and clears marker lines", () => {
    const added = upsertWordRevisionMarkers("请改合同", { family: "equity", stance: "乙方" });
    expect(added).toMatch(/^改稿类型：股权融资\n己方立场：乙方\n请改合同$/);
    const cleared = upsertWordRevisionMarkers(added, { family: "", stance: "" });
    expect(cleared).toBe("请改合同");
  });

  it("round-trips markdown overlay from the workspace", () => {
    const md = serializeChecklistMarkdown(PROCUREMENT_WORD_REVISION_PACK);
    const parsed = parseChecklistMarkdown(md, "procurement");
    expect(parsed.items.length).toBe(PROCUREMENT_WORD_REVISION_PACK.items.length);
    expect(parsed.items[0]?.look).toBe(PROCUREMENT_WORD_REVISION_PACK.items[0]?.look);
    expect(familyIdFromLabel("采购供货")).toBe("procurement");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wr-"));
    fs.mkdirSync(path.join(dir, "playbooks", "word-revision"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "playbooks", "word-revision", "procurement.md"),
      [
        "# 采购供货",
        `<!-- word-revision-pack:v${WORD_REVISION_PACK_VERSION} -->`,
        "",
        "## pr.custom 自定义",
        "- 看：只看开票",
        "- 改·甲方：先票后款",
        "- 改·乙方：先款后票",
        "- 停：税率",
        "- 透：增值税",
      ].join("\n"),
      "utf8",
    );
    const loaded = loadWordRevisionPack("procurement", dir);
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]?.id).toBe("pr.custom");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("merges new builtin items into a stale overlay", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wr-stale-"));
    fs.mkdirSync(path.join(dir, "playbooks", "word-revision"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "playbooks", "word-revision", "procurement.md"),
      [
        "# 采购供货",
        "<!-- word-revision-pack:v1 -->",
        "",
        "## pr.custom 自定义",
        "- 看：只看开票",
        "- 改·甲方：先票后款",
        "- 改·乙方：先款后票",
        "- 停：税率",
        "- 透：增值税",
      ].join("\n"),
      "utf8",
    );
    const loaded = loadWordRevisionPack("procurement", dir);
    expect(loaded.items[0]?.id).toBe("pr.custom");
    expect(loaded.items.length).toBe(PROCUREMENT_WORD_REVISION_PACK.items.length + 1);
    expect(loaded.items.some((it) => it.id === "pr.pay")).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not treat boilerplate words as the contract type", () => {
    const cleaning = resolveWordRevisionChecklist({
      instruction: "修改合同",
      documentText:
        "保洁服务委托合同\n甲方（采购方）委托乙方（供应商）提供保洁服务。不涉及供货与订货。",
    });
    expect(cleaning.family).toBeUndefined();
    expect(
      formatWordRevisionChecklistBlock({
        instruction: "修改合同",
        documentText:
          "保洁服务委托合同\n甲方（采购方）委托乙方（供应商）提供保洁服务。不涉及供货与订货。",
      }),
    ).toContain("未识别合同类型");

    const integrity = resolveWordRevisionChecklist({
      instruction: "修改合同",
      documentText: "廉洁合规协议书\n乙方不得对外借款、抵押、质押，不得签订担保合同。",
    });
    expect(integrity.family).toBeUndefined();

    const dispatch = resolveWordRevisionChecklist({
      instruction: "修改合同",
      documentText:
        "驾驶员劳务派遣协议\n乙方应与被派遣劳动者签订劳动合同，并遵守《劳动合同法》。双方约定竞业限制。",
    });
    expect(dispatch.family).toBeUndefined();

    const nda = resolveWordRevisionChecklist({
      instruction: "修改合同",
      documentText: "保密协议\n双方对商业秘密承担保密义务，并约定竞业限制。",
    });
    expect(nda.family).toBeUndefined();
  });

  it("still infers a real procurement or loan contract from its own name", () => {
    expect(
      resolveWordRevisionChecklist({
        instruction: "修改合同",
        documentText: "采购合同\n供应商按订单供货，价款见附件。",
      }).family,
    ).toBe("procurement");
    expect(
      resolveWordRevisionChecklist({
        instruction: "修改合同",
        documentText: "借款合同\n甲乙双方签订借款合同，出借人向借款人出借资金。",
      }).family,
    ).toBe("loan");
    expect(familyIdFromLabel("借款")).toBe("loan");
    expect(familyIdFromLabel("供应商")).toBe("procurement");
  });
});
