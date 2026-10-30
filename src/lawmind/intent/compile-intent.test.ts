import { describe, expect, it } from "vitest";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { formatCapabilityCatalogIndex } from "./catalog.js";
import { compileIntent, compiledIntentPlanItems, extractIntentSignals } from "./compile-intent.js";

describe("compileIntent", () => {
  it("nails mail short path and explicit lock over keywords", () => {
    expect(
      compileIntent({
        instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\n审查合同",
      }).capabilityId,
    ).toBe("mail.contract");
    expect(
      compileIntent({
        instruction: "【办件】能力：litigation.draft\n请审查这份采购合同",
      }).capabilityId,
    ).toBe("litigation.draft");
  });

  it("uses file genre when the lawyer only says 帮我看看", () => {
    const compiled = compileIntent({
      instruction: "帮我看看",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "买卖合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("medium");
    expect(compiled.lawyerSummary).toContain("合同审查");
    expect(compiled.lawyerSummary).toContain("本轮初步判断");
  });

  it("does not treat a complaint that quotes a contract as contract review", () => {
    const compiled = compileIntent({
      instruction: "帮我看看",
      documents: [
        {
          relPath: "起诉材料.docx",
          peekText: "民事起诉状\n原告：张三\n被告：李四\n诉讼请求：解除合同。",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
  });

  it("treats review words on a complaint file as litigation without asking the lawyer", () => {
    const compiled = compileIntent({
      instruction: "请审查这份采购合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "民事起诉状.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
    expect(compiled.softAsk).toBeUndefined();
    expect(compiled.alternatives).toEqual([]);
  });

  it("prefers the contract file when mixed papers meet an explicit review instruction", () => {
    const compiled = compileIntent({
      instruction: "请审查这份采购合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
        {
          pinKind: "file",
          root: "project",
          relPath: "民事起诉状.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.softAsk).toBeUndefined();
  });

  it("binds Word 改稿 on a pleading to litigation, not contract review", () => {
    const compiled = compileIntent({
      instruction: "帮我改一下",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "民事起诉状.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
    expect(compiled.source).toBe("word_revision");
    expect(compiled.pipelineOverride).toBe("tracked_redline");
    expect(compiled.skillIdsOverride).toEqual([
      "complaint-elements-fill",
      "evidence-argument-chain",
    ]);
  });

  it("keeps the instruction's document when a Word revision has other material pinned (P1-e)", () => {
    // 「修改这份起诉状」 + 开庭传票 used to fall through `dominantGenre` =
    // court_notice and land on contract.review, so the tracked-redline turn
    // loaded contract skills for a pleading.
    const compiled = compileIntent({
      instruction: "修改这份起诉状，导出带修订 Word",
      pins: [
        { pinKind: "file", root: "project", relPath: "民事起诉状.docx", kind: "file" },
        { pinKind: "file", root: "workspace", relPath: "开庭传票.pdf", kind: "file" },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
    expect(compiled.source).toBe("word_revision");
    expect(compiled.pipelineOverride).toBe("tracked_redline");
    expect(compiled.deliverableType).toBe("document.general");

    const letter = compileIntent({
      instruction: "修改这份律师函，导出带修订 Word",
      pins: [
        { pinKind: "file", root: "project", relPath: "律师函.docx", kind: "file" },
        { pinKind: "file", root: "workspace", relPath: "开庭传票.pdf", kind: "file" },
      ],
    });
    expect(letter.capabilityId).toBe("letter.draft");
    expect(letter.deliverableType).toBe("letter.counsel");

    // Several named documents = ambiguous; the rule must not pick one of them.
    // 律师函 stays the genre reading (letter is the sticky genre).
    const ambiguous = compileIntent({
      instruction: "修改这份律师函，合同条款也一并核对，导出带修订 Word",
      pins: [
        { pinKind: "file", root: "project", relPath: "律师函.docx", kind: "file" },
        { pinKind: "file", root: "workspace", relPath: "采购合同.docx", kind: "file" },
      ],
    });
    expect(ambiguous.capabilityId).toBe("letter.draft");
  });

  it("reads a vague Word redraft from the Word baseline, not the PDF pile (P2)", () => {
    // Only the .docx can be the thing being edited; a pinned summons must not
    // send the redraft to contract.review (dominantGenre = court_notice).
    const compiled = compileIntent({
      instruction: "帮我改一下",
      pins: [
        { pinKind: "file", root: "project", relPath: "民事起诉状.docx", kind: "file" },
        { pinKind: "file", root: "workspace", relPath: "开庭传票.pdf", kind: "file" },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
    expect(compiled.pipelineOverride).toBe("tracked_redline");
    expect(compiled.skillIdsOverride).toEqual([
      "complaint-elements-fill",
      "evidence-argument-chain",
    ]);
  });

  it("keeps contract.review but does not lock tracked redline for an opinion sidecar", () => {
    const compiled = compileIntent({
      instruction: "请根据这个合同去给我一些审查意见放到桌面，不要在源文件上修改",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.pipelineOverride).toBeUndefined();
    expect(compiled.delivery.artifactShape).toBe("opinion_memo");
    expect(compiled.delivery.placeRequested).toBe(true);
    expect(compiled.delivery.mutateSource).toBe("forbid");
  });

  it("does not freeze 5-minute 合同审查意见 into opinion-only when a Word is pinned", () => {
    const compiled = compileIntent({
      instruction: [
        "【交办】5 分钟合同审查",
        "交付物类型：合同审查意见",
        "- 己方立场：中立",
        "- 审查重点：管辖",
      ].join("\n"),
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.delivery.artifactShape).toBe("unspecified");
  });

  it("does not lock tracked redline for 立场/导出 when a Word is pinned", () => {
    const compiled = compileIntent({
      instruction: "立场甲方，导出",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.pipelineOverride).toBeUndefined();
  });

  it("does not sticky-continue after a correction utterance", () => {
    const corrected = compileIntent({
      instruction: "不对",
      previousCapabilityId: "contract.review",
    });
    expect(corrected.capabilityId).toBeUndefined();
    expect(
      compileIntent({
        instruction: "继续",
        previousCapabilityId: undefined,
      }).capabilityId,
    ).toBeUndefined();
  });

  it("does not bind contract.review when the lawyer rejects 合同审核 and asks to check a 律师函", () => {
    const compiled = compileIntent({
      instruction:
        "我要你做的不是合同审核，是根据【河南堃云顿数据科技有限公司】文件夹里的信息帮我看我起草的律师函内容是否有误",
      previousCapabilityId: "contract.review",
    });
    expect(compiled.capabilityId).toBe("letter.draft");
    expect(compiled.source).toBe("keyword");
    expect(compiled.lawyerSummary).toContain("核对已起草律师函");
    expect(compiled.lawyerSummary).toContain("本轮初步判断");
    expect(compiled.lawyerSummary).toContain("以律师本轮原话为准");
    expect(compiled.lawyerSummary).toContain("勿续上轮合同审查");
    expect(compiled.pipelineOverride).toBeUndefined();
  });

  it("keeps 函件 QA plus a pinned letter as a soft hypothesis, not a Skill dump", () => {
    const compiled = compileIntent({
      instruction: "核对我起草的律师函是否有误",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "律师函.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("letter.draft");
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("medium");
    expect(compiled.lawyerSummary).toContain("核对已起草律师函");
    expect(compiled.lawyerSummary).toContain("本轮初步判断");
  });

  it("does not auto-seed a checklist from a keyword-only bind", () => {
    const compiled = compileIntent({
      instruction: "审查这份合同并写催告函",
    });
    expect(compiled.source).toBe("keyword");
    expect(compiled.chain.length).toBeGreaterThanOrEqual(2);
    expect(compiledIntentPlanItems(compiled)).toEqual([]);
  });

  it("keeps explicit 审查 plus a contract file as review even when the line also asks for a 催告函", () => {
    const compiled = compileIntent({
      instruction: "审查这份合同并写催告函",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.chain).toContain("letter.draft");
    expect(compiledIntentPlanItems(compiled)).toEqual(["合同审查", "函件起草"]);
  });

  it("keeps a labor figure as the primary step and still lists the complaint", () => {
    const compiled = compileIntent({
      instruction: "计算违法解除的经济补偿，并写起诉状",
    });
    expect(compiled.capabilityId).toBe("labor.calc");
    expect(compiled.source).toBe("specialized");
    expect(compiled.confidence).toBe("high");
    expect(compiled.chain).toEqual(["labor.calc", "litigation.draft"]);
    expect(compiledIntentPlanItems(compiled)).toEqual(["劳动计算", "诉讼文书"]);
  });

  it("routes a named invoice spreadsheet to invoice ops, not a generic table", () => {
    const compiled = compileIntent({
      instruction: "整理一下",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "进项发票.xlsx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("ops.invoice");
  });

  it("extracts mixed signals for a pinned word plus vague text", () => {
    const signals = extractIntentSignals({
      instruction: "看看这个",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "服务合同.docx",
          kind: "file",
        },
      ],
    });
    expect(signals.dominantGenre).toBe("contract");
    expect(signals.hasMaterials).toBe(true);
  });

  it("keeps contract review joint/high when unrelated attachments are pinned (P1-a)", () => {
    const pins: ComposeContextPin[] = [
      { pinKind: "file", root: "project", relPath: "采购合同.docx", kind: "file" },
      { pinKind: "file", root: "workspace", relPath: "设备采购合同.docx", kind: "file" },
      ...Array.from({ length: 10 }, (_, index) => ({
        pinKind: "file" as const,
        root: "workspace" as const,
        relPath: `materials/论文-${String(index + 1).padStart(2, "0")}.pdf`,
        kind: "file" as const,
      })),
    ];
    const signals = extractIntentSignals({
      instruction: "请审查这份采购合同的违约责任与付款条款",
      pins,
    });
    // Untyped attachments carry no genre evidence; two agreeing contracts do.
    expect(signals.dominantGenre).toBe("contract");

    const compiled = compileIntent({
      instruction: "请审查这份采购合同的违约责任与付款条款",
      pins,
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("high");
  });

  it("keeps the file-genre bind when untyped scans outnumber a lone contract", () => {
    // Same unanimity rule for a vague utterance: 「帮我看看」 must still read as
    // contract review (medium), not fall to unbound just because ten scans
    // could not be classified.
    const compiled = compileIntent({
      instruction: "帮我看看",
      pins: [
        { pinKind: "file", root: "project", relPath: "采购合同.docx", kind: "file" },
        ...Array.from({ length: 10 }, (_, index) => ({
          pinKind: "file" as const,
          root: "workspace" as const,
          relPath: `materials/扫描件-${String(index + 1).padStart(2, "0")}.pdf`,
          kind: "file" as const,
        })),
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("medium");
  });

  it("does not invent a genre when typed attachments disagree", () => {
    // A contract plus a pleadings pile stays on the old mixed-paper path; the
    // P1-a rule must not promote either side by counting.
    const pins: ComposeContextPin[] = [
      { pinKind: "file", root: "project", relPath: "采购合同.docx", kind: "file" },
      { pinKind: "file", root: "workspace", relPath: "起诉状.docx", kind: "file" },
      ...Array.from({ length: 10 }, (_, index) => ({
        pinKind: "file" as const,
        root: "workspace" as const,
        relPath: `materials/扫描件-${String(index + 1).padStart(2, "0")}.pdf`,
        kind: "file" as const,
      })),
    ];
    const compiled = compileIntent({
      instruction: "请审查这份采购合同的违约责任与付款条款",
      pins,
    });
    // Fatal pair: the contract is preferred but only at medium confidence.
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.confidence).toBe("medium");
  });

  it("lets an explicit contract-review instruction beat typed attachment piles (P1-e)", () => {
    const contractPin: ComposeContextPin = {
      pinKind: "file",
      root: "project",
      relPath: "采购合同.docx",
      kind: "file",
    };
    const piles: Array<{ label: string; pins: ComposeContextPin[] }> = [
      {
        label: "证据清单",
        pins: Array.from({ length: 5 }, (_, index) => ({
          pinKind: "file" as const,
          root: "workspace" as const,
          relPath: `materials/证据清单-${index + 1}.pdf`,
          kind: "file" as const,
        })),
      },
      {
        label: "传票",
        pins: Array.from({ length: 5 }, (_, index) => ({
          pinKind: "file" as const,
          root: "workspace" as const,
          relPath: `materials/传票-${index + 1}.pdf`,
          kind: "file" as const,
        })),
      },
      {
        label: "表格",
        pins: Array.from({ length: 5 }, (_, index) => ({
          pinKind: "file" as const,
          root: "workspace" as const,
          relPath: `materials/明细-${index + 1}.xlsx`,
          kind: "file" as const,
        })),
      },
      {
        label: "发票",
        pins: Array.from({ length: 5 }, (_, index) => ({
          pinKind: "file" as const,
          root: "workspace" as const,
          relPath: `materials/进项发票-${index + 1}.pdf`,
          kind: "file" as const,
        })),
      },
    ];
    for (const pile of piles) {
      const compiled = compileIntent({
        instruction: "请审查这份采购合同的违约责任与付款条款",
        pins: [contractPin, ...pile.pins],
      });
      expect(compiled.capabilityId, pile.label).toBe("contract.review");
      expect(compiled.source, pile.label).toBe("joint");
      expect(compiled.confidence, pile.label).toBe("high");
    }
  });

  it("lets an explicit pleading instruction beat a summons pile (P1-e)", () => {
    const compiled = compileIntent({
      instruction: "根据这些材料写一份答辩状",
      pins: [
        { pinKind: "file", root: "project", relPath: "民事起诉状.docx", kind: "file" },
        ...Array.from({ length: 5 }, (_, index) => ({
          pinKind: "file" as const,
          root: "workspace" as const,
          relPath: `materials/传票-${index + 1}.pdf`,
          kind: "file" as const,
        })),
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("high");
  });

  it("lets an explicit letter request beat an invoice pile (P1-e)", () => {
    const compiled = compileIntent({
      instruction: "写一份催款函",
      pins: [{ pinKind: "file", root: "project", relPath: "进项发票.pdf", kind: "file" }],
    });
    expect(compiled.capabilityId).toBe("letter.draft");
    expect(compiled.source).toBe("joint");
    expect(compiled.deliverableType).toBe("letter.demand");
  });

  it("lets an explicit timeline request beat a typed material pile (P3)", () => {
    const evidence = compileIntent({
      instruction: "把这些证据做成时间线",
      pins: [
        { pinKind: "file", root: "project", relPath: "证据清单.pdf", kind: "file" },
        { pinKind: "file", root: "workspace", relPath: "借条.jpg", kind: "file" },
      ],
    });
    expect(evidence.capabilityId).toBe("chronology.timeline");
    expect(evidence.source).toBe("joint");
    expect(evidence.confidence).toBe("high");
    expect(evidence.deliverableType).toBe("matter.timeline");

    const judgment = compileIntent({
      instruction: "把这份判决书整理成时间线",
      pins: [{ pinKind: "file", root: "project", relPath: "民事判决书.pdf", kind: "file" }],
    });
    expect(judgment.capabilityId).toBe("chronology.timeline");
    expect(judgment.deliverableType).toBe("matter.timeline");

    // A named pleading is still the deliverable when a timeline is a side ask.
    const complaint = compileIntent({
      instruction: "写起诉状，附时间线",
      pins: [{ pinKind: "file", root: "project", relPath: "民事起诉状.docx", kind: "file" }],
    });
    expect(complaint.capabilityId).toBe("litigation.draft");
  });

  it("keeps a named research memo when the pinned material is not research (P3)", () => {
    const memo = compileIntent({
      instruction: "就违约金条款写一份检索备忘录",
      pins: [{ pinKind: "file", root: "project", relPath: "证据清单.pdf", kind: "file" }],
    });
    expect(memo.capabilityId).toBe("research.memo");
    expect(memo.source).toBe("joint");
    expect(memo.confidence).toBe("high");

    // A bare 检索 without a named memo deliverable still reads the material.
    const review = compileIntent({
      instruction: "查一下这份合同有没有问题",
      pins: [{ pinKind: "file", root: "project", relPath: "采购合同.docx", kind: "file" }],
    });
    expect(review.capabilityId).toBe("contract.review");
  });

  it("routes the prompt's own 收进案件 wording to intake instead of review (P3)", () => {
    const compiled = compileIntent({
      instruction: "把这些材料收进案件",
      pins: [{ pinKind: "file", root: "project", relPath: "采购合同.docx", kind: "file" }],
    });
    expect(compiled.capabilityId).toBe("matter.intake");
    expect(compiled.source).toBe("specialized");
    expect(compiled.confidence).toBe("high");
  });

  it("keeps genre routing when the instruction names no object (P1-e scope)", () => {
    // The rule requires an explicit 合同/起诉状 in the utterance. A vague
    // 「帮我看看」 still binds off the material, so summons/invoice turns keep
    // their operations route.
    expect(
      compileIntent({
        instruction: "帮我看看",
        pins: [{ pinKind: "file", root: "project", relPath: "开庭传票.pdf", kind: "file" }],
      }).capabilityId,
    ).toBe("ops.court_sms");
    expect(
      compileIntent({
        instruction: "整理一下",
        pins: [{ pinKind: "file", root: "project", relPath: "进项发票.pdf", kind: "file" }],
      }).capabilityId,
    ).toBe("ops.invoice");
  });

  it("keeps the Codex catalog under the character budget", () => {
    const block = formatCapabilityCatalogIndex();
    expect(block).toContain("render_document");
    expect(block).toContain("read_skill");
    expect(block).toContain("`contract-playbook-review`：标准/可接受回退/永不接受三档");
    expect(block).toContain("`delivery-language`");
    expect(block).not.toContain("mail.contract");
    expect(block).not.toContain("contract.review");
    expect(block).not.toContain("可用能力");
    expect(block.length).toBeLessThanOrEqual(8000);
  });
});
