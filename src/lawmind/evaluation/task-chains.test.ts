/**
 * W11 三条任务链收口（cassette + 真实工具，不重写产品流程）。
 *
 * 每条链固定回答五件事：
 *   1. 入口条件（入口判据成立才会走到这条链）；
 *   2. 默认工具集（下一请求体里到底广告了什么）；
 *   3. 产物登记（磁盘上真的落了什么，能不能打开）；
 *   4. 缺口表达（哪一格/哪一节被标成待补，而不是猜一个值）；
 *   5. 失败可恢复点（引擎拒绝/收窄一次之后，同一回合能不能接着办完）。
 *
 * 断言对象是下一请求体、工具结果与磁盘产物，不断言提示词措辞。
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { cassetteAssistant, cassetteToolCall, withTestLawMind } from "../agent/testkit/index.js";
import type { TestLawMind } from "../agent/testkit/test-lawmind.js";
import { stableReviewRowId } from "../deliverables/review-table-extract.js";
import { readReviewTable } from "../deliverables/review-table.js";
import { persistDraft, readDraft } from "../drafts/index.js";

/** 最小可读 docx：几段正文，够 splice 与 tracked render 用。 */
async function writeMinimalDocx(absPath: string, body: string): Promise<void> {
  const paragraphs = body
    .split("\n")
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join("");
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    paragraphs +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>` +
    `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );
  await fs.promises.writeFile(absPath, await zip.generateAsync({ type: "nodebuffer" }));
}

async function readDocxDocumentXml(absPath: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(absPath));
  return (await zip.file("word/document.xml")?.async("string")) ?? "";
}

function toolResults(h: TestLawMind): Array<{
  name: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}> {
  return (h.session()?.conversationHistory ?? []).flatMap((message) =>
    (message.toolCallResponses ?? []).map((row) => ({
      name: row.name,
      ok: row.result?.ok,
      ...(row.result?.error ? { error: row.result.error } : {}),
      ...(row.result?.data !== undefined ? { data: row.result.data } : {}),
    })),
  );
}

describe("W11 task chains", () => {
  it("chain 1 · 改这份 Word：整句锚点被收窄后同一回合改完，产物保留原文并带审阅痕迹", async () => {
    // 独立审稿员是第二次模型调用，会吃掉 cassette 回合；本链只验改稿/导出链本身，
    // 审稿员另有单测覆盖。
    vi.stubEnv("LAWMIND_LEGAL_GUARDIAN", "0");
    try {
      await chain1();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  async function chain1(): Promise<void> {
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        const baselineRel = "技术服务合同.docx";
        await writeMinimalDocx(
          path.join(h.workspaceDir, baselineRel),
          ["技术服务合同", "甲方应于五日内付款。", "乙方应于收到款项后交付。"].join("\n"),
        );
        persistDraft(h.workspaceDir, {
          taskId: "t-word",
          title: "技术服务合同",
          summary: "",
          output: "docx",
          templateId: "word/legal-memo-default",
          deliverableType: "contract.review",
          sections: [],
          reviewNotes: [],
          reviewStatus: "pending",
          createdAt: new Date().toISOString(),
          contractEdit: { mode: "surgical", baselineRelativePath: baselineRel },
        });

        const instruction = [
          "【用户在 LawMind 文件页将下列路径标为“本回合重点”（路径引用，需助手读取）】",
          `- [项目 · 路径引用] \`${baselineRel}\``,
          "",
          "修改合同：把付款期限改成十个工作日。",
        ].join("\n");

        h.enqueue(
          // 第一次：整句 find —— 引擎按跨度门禁收窄，不改整句。
          cassetteToolCall("apply_surgical_edits", {
            task_id: "t-word",
            edits: [{ find: "甲方应于五日内付款。", replace: "甲方应于十个工作日内付款。" }],
            craft_check: { deferred: [] },
            contract_edit_baseline_path: baselineRel,
          }),
          // 第二次：最短锚点 —— 落改。
          cassetteToolCall("apply_surgical_edits", {
            task_id: "t-word",
            edits: [{ find: "五日", replace: "十个工作日" }],
            craft_check: { deferred: [] },
            contract_edit_baseline_path: baselineRel,
          }),
          cassetteToolCall("render_tracked_draft", { task_id: "t-word" }),
          cassetteAssistant("已按最短锚点改完并导出审阅稿。"),
          cassetteAssistant("审阅稿已导出。"),
          cassetteAssistant("已交件。"),
        );

        const result = await h.runTurn(instruction, {
          contextPins: [{ pinKind: "file", root: "workspace", relPath: baselineRel, kind: "file" }],
        });

        // 2. 默认工具集：改稿链在，外发不在。
        expect(h.request(0).hasAdvertisedTool("apply_surgical_edits")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("render_tracked_draft")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("prepare_outbound_mail")).toBe(false);

        // 5. 失败可恢复点：整句锚点被引擎收窄，而不是静默改整句/静默失败。
        const edits = toolResults(h).filter((row) => row.name === "apply_surgical_edits");
        expect(edits.length).toBe(2);
        expect(edits[0]?.ok).toBe(true);
        const applied = (edits[0]?.data as { applied?: Array<{ note?: string }> } | undefined)
          ?.applied;
        expect(applied?.[0]?.note).toContain("收窄");

        // 3. 产物登记：审阅稿落在源文件同目录，能作为 zip 打开。
        const outputs = fs
          .readdirSync(h.workspaceDir)
          .filter((name) => name.startsWith("技术服务合同_") && name.endsWith(".docx"));
        expect(outputs.length).toBeGreaterThan(0);
        const outAbs = path.join(h.workspaceDir, outputs[0]);

        // 4. 修订不丢、原文仍在：新措辞在 w:ins，原措辞在 w:del。
        const xml = await readDocxDocumentXml(outAbs);
        expect(xml).toContain("十个工作");
        expect(xml).toMatch(/<w:ins\b/);
        expect(xml).toMatch(/<w:del\b/);
        expect(xml).toContain("五");
        expect(xml).toContain("乙方应于收到款项后交付");
        expect(result.turn.status).toBe("completed");
      },
    );
  }

  it("chain 2 · 材料成稿：子工读材料、缺口如实落草稿、导出可打开", async () => {
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        const materialsDir = path.join(h.workspaceDir, "cases", "m-brief", "materials");
        fs.mkdirSync(materialsDir, { recursive: true });
        const source = "当事人张北县瑞霖乳制品有限公司。2026年3月10日交付设备，价款120万元。";
        fs.writeFileSync(path.join(materialsDir, "谈话记录.txt"), source, "utf8");
        persistDraft(h.workspaceDir, {
          taskId: "t-brief",
          matterId: "m-brief",
          title: "案情备忘",
          summary: "",
          output: "docx",
          templateId: "document-general-default",
          deliverableType: "document.general",
          sections: [
            { heading: "概述", body: "待整理。", citations: [] },
            { heading: "分析", body: "待整理。", citations: [] },
            { heading: "结论", body: "待整理。", citations: [] },
          ],
          reviewNotes: [],
          reviewStatus: "pending",
          createdAt: new Date().toISOString(),
        });

        h.enqueue(
          cassetteToolCall("draft_worker", {
            goal: "读谈话记录，整理交付时间与价款两项事实，缺的证据如实标缺口。",
            path: "cases/m-brief/materials/谈话记录.txt",
            section: "事实",
            role: "review",
          }),
          // 子工自己的模型回合：只读工具已跑完，交结论（≥40 字，出处落在材料原文）。
          cassetteAssistant(
            JSON.stringify({
              draft:
                "当事人为张北县瑞霖乳制品有限公司。2026年3月10日交付设备，价款120万元；验收单尚未提供，验收时间待补。",
              citations: ["2026年3月10日交付设备", "价款120万元"],
              gaps: ["未见到验收单，验收时间待补。"],
            }),
          ),
          cassetteToolCall("update_draft", {
            task_id: "t-brief",
            sections: [
              {
                heading: "概述",
                body: "本案为设备买卖价款争议的案情备忘。",
                citations: [],
              },
              {
                heading: "分析",
                body: "2026年3月10日交付设备，价款120万元。\n\n【缺口】未见到验收单，验收时间待补。",
                citations: ["2026年3月10日交付设备", "价款120万元"],
              },
              { heading: "结论", body: "价款与交付时间可核；验收时间待补。", citations: [] },
            ],
          }),
          cassetteToolCall("render_document", { task_id: "t-brief" }),
          cassetteAssistant("备忘已成稿，验收时间作为缺口留在正文。"),
        );

        const result = await h.runTurn("根据本案材料写一份案情备忘，缺的证据别猜。", {
          matterId: "m-brief",
          linkedTaskId: "t-brief",
        });

        // 1/2. 入口与默认工具集。
        expect(h.request(0).hasAdvertisedTool("draft_worker")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_draft")).toBe(true);

        // 5. 子工结论回到父回合：父回合下一次请求能看见子工交回的事实与缺口。
        const worker = toolResults(h).find((row) => row.name === "draft_worker");
        expect(worker?.ok).toBe(true);
        const afterWorker = h.requests.find((req) => req.allText().includes("验收时间待补"));
        expect(afterWorker).toBeTruthy();

        // 4. 缺口表达：草稿正文保留缺口，而不是编一个日期。
        const draft = readDraft(h.workspaceDir, "t-brief");
        const body = draft?.sections.find((s) => s.heading === "分析")?.body ?? "";
        expect(body).toContain("120万元");
        expect(body).toContain("【缺口】");
        expect(body).not.toMatch(/验收时间[:：]\s*2026/);

        // 3. 产物登记：导出的 docx 能打开且含关键事实。
        const emitted = toolResults(h).find((row) => row.name === "render_document");
        expect(emitted?.ok).toBe(true);
        // 交付物落在本案 artifacts/（未指定 output_path 时的解析规则），且能打开。
        const outputPath = (emitted?.data as { outputPath?: string } | undefined)?.outputPath;
        expect(outputPath).toBeTruthy();
        expect(fs.existsSync(outputPath!)).toBe(true);
        expect(outputPath!).toContain(path.join("cases", "m-brief", "artifacts"));
        const xml = await readDocxDocumentXml(outputPath!);
        expect(xml).toContain("120万元");
        expect(result.turn.status).toBe("completed");
      },
    );
  });

  it("chain 3 · 多份合同比较：多金额先报歧义，带原句指定后才入表，未指定格仍算缺口", async () => {
    await withTestLawMind(
      (b) => b.withLegalTools(),
      async (h) => {
        const materialsDir = path.join(h.workspaceDir, "cases", "m-compare", "materials");
        fs.mkdirSync(materialsDir, { recursive: true });
        const relA = "cases/m-compare/materials/合同甲.txt";
        const relB = "cases/m-compare/materials/合同乙.txt";
        fs.writeFileSync(
          path.join(h.workspaceDir, relA),
          "甲方注册资本100万元。合同总价款为人民币500万元，分两期支付。",
          "utf8",
        );
        fs.writeFileSync(
          path.join(h.workspaceDir, relB),
          "甲方注册资本200万元。合同总价款为人民币800万元，签约后一次付清。",
          "utf8",
        );
        persistDraft(h.workspaceDir, {
          taskId: "t-compare",
          matterId: "m-compare",
          title: "合同比较",
          summary: "",
          output: "docx",
          templateId: "document-general-default",
          deliverableType: "document.general",
          sections: [{ heading: "结论与说明", body: "见审查表明细。", citations: [] }],
          reviewNotes: [],
          reviewStatus: "pending",
          createdAt: new Date().toISOString(),
        });

        // 第一轮：披露审查表 → 建表 → 换成抽取型列 → 批量抽取（多金额应报歧义）。
        h.enqueue(
          cassetteToolCall("list_more_tools", { names: ["review_table_update"] }),
          cassetteToolCall("review_table_update", {
            task_id: "t-compare",
            action: "set_template",
            template: "due_diligence",
          }),
          cassetteToolCall("review_table_update", {
            task_id: "t-compare",
            action: "set_columns",
            columns: [
              { key: "document", label: "对应文件" },
              { key: "amount", label: "金额" },
              { key: "party", label: "主体" },
              { key: "source", label: "来源" },
            ],
          }),
          cassetteToolCall("review_table_update", {
            task_id: "t-compare",
            action: "extract_batch",
          }),
          cassetteAssistant("抽取完成：金额列出现多个候选，等您指定按合同总价款取值。"),
        );

        const first = await h.runTurn("比较这两份合同的金额条款，抽不动的别猜。", {
          matterId: "m-compare",
          linkedTaskId: "t-compare",
        });

        // 1/2. 入口：先披露再广告；披露后的请求体里有审查表工具。
        expect(h.request(0).hasAdvertisedTool("list_more_tools")).toBe(true);
        expect(h.request(1).hasAdvertisedTool("review_table_update")).toBe(true);

        // 4. 歧义表达：抽取结果把多个候选交回父回合，而不是直接填一个 high。
        const extract = toolResults(h).find(
          (row) =>
            row.ok &&
            (row.data as { ambiguousCells?: unknown[] } | undefined)?.ambiguousCells !== undefined,
        );
        expect(extract?.ok).toBe(true);
        const extractData = extract?.data as { ambiguousCells?: unknown[] } | undefined;
        expect(Array.isArray(extractData?.ambiguousCells)).toBe(true);
        expect((extractData?.ambiguousCells ?? []).length).toBeGreaterThan(0);
        const followUp = h.requests.find((req) => req.allText().includes("ambiguous"));
        expect(followUp).toBeTruthy();

        // 歧义未被静默填值：两张表的金额格都还是弃答。
        const beforeTable = readReviewTable(h.workspaceDir, "t-compare");
        const beforeRowA = beforeTable?.rows.find(
          (item) => item.cells["document"] === "合同甲.txt",
        );
        expect(beforeRowA?.cells["amount"]).toContain("无法判断");
        expect(beforeRowA?.cellMeta?.["amount"]?.basis).not.toBe("exact_quote");
        const rowA = beforeRowA?.id ?? "";
        expect(rowA).toBeTruthy();
        expect(stableReviewRowId(0, relA)).toBeTruthy();
        expect(stableReviewRowId(0, relB)).toBeTruthy();

        // 第二轮：律师/模型用原句明确指定甲合同的金额，然后推进文书。
        h.enqueue(
          cassetteToolCall("review_table_update", {
            task_id: "t-compare",
            action: "update_cells",
            updates: [
              {
                rowId: rowA,
                cells: { amount: "人民币500万元" },
                evidence: {
                  amount: {
                    quote: "甲方注册资本100万元。合同总价款为人民币500万元，分两期支付。",
                    reason: "该原句里的 500 万元明确写作合同总价款，与金额列的角色一致。",
                  },
                },
              },
            ],
          }),
          cassetteToolCall("review_table_update", { task_id: "t-compare", action: "to_draft" }),
          cassetteAssistant("甲合同金额已按原句核定；乙合同未指定，仍列缺口。"),
        );

        const second = await h.runTurn("按合同总价款把甲合同的金额定下来，其余保持缺口。", {
          matterId: "m-compare",
          linkedTaskId: "t-compare",
        });

        // 3. 关键事实正确：指定后金额按原句落到对应材料行。
        const table = readReviewTable(h.workspaceDir, "t-compare");
        expect(table).toBeTruthy();
        expect(table!.rows.length).toBe(2);
        const row = table!.rows.find((item) => item.id === rowA);
        expect(row?.cells["document"]).toBe("合同甲.txt");
        expect(row?.cells["amount"]).toContain("500");
        expect(row?.cellMeta?.["amount"]?.basis).toBe("exact_quote");

        // 未被指定的乙合同仍是缺口：不得凭模式命中当已核验。
        const rowB = table!.rows.find((item) => item.cells["document"] === "合同乙.txt");
        expect(rowB?.cells["amount"]).toContain("无法判断");
        expect(rowB?.cellMeta?.["amount"]?.basis).not.toBe("exact_quote");

        // 缺口表达：正文把未取得项列出来。
        const draft = readDraft(h.workspaceDir, "t-compare");
        const conclusions = draft?.sections.find((s) => s.heading === "审查结论")?.body ?? "";
        expect(conclusions.includes("未能取得") || conclusions.includes("缺口")).toBe(true);
        expect(first.turn.status).toBe("completed");
        expect(second.turn.status).toBe("completed");
      },
    );
  });
});
