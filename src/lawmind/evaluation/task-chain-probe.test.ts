import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOfficeCliBin } from "../artifacts/officecli-bin.js";
import { persistDraft } from "../drafts/index.js";
import {
  listProbeMatters,
  pickAnchor,
  probeContractExtractionChain,
  probeDraftChainWithoutModel,
  probeWordRevisionChain,
} from "./task-chain-probe.js";

/**
 * 「改 Word」探针要真的调用 officecli 才能产出 w:ins / w:del。
 *
 * CI 不 vendor 二进制（`scripts/vendor-officecli.mjs --postinstall` 明确跳过），
 * 所以那条链在 CI 上只能走 plain_fallback → `insCount`/`delCount` 为 0、
 * 产物目录空，用例报 `expected 'failed' to be 'done'`。这里按仓库既有约定
 * （见 `agent/tools/legal/pptx-officecli.test.ts`）在有二进制时才跑，
 * 不在 CI 上假装跑过。
 */
const officecliBin = resolveOfficeCliBin();

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function writeDocx(absPath: string, lines: string[]): Promise<void> {
  const paragraphs = lines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join("");
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      paragraphs +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  );
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

function seedWorkspace(opts?: { docx?: boolean; contracts?: boolean }): string {
  const ws = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "lm-chain-probe-"));
  dirs.push(ws);
  const dir = path.join(ws, "cases", "m-probe", "materials");
  fs.mkdirSync(dir, { recursive: true });
  if (opts?.docx !== false) {
    fs.writeFileSync(path.join(ws, "cases", "m-probe", "CASE.md"), "# 探针案件\n", "utf8");
  }
  return ws;
}

describe("task chain probe", () => {
  it("picks a short unique anchor and skips when nothing is safe", () => {
    expect(pickAnchor("合同总价款为人民币500万元，分两期支付。")).toEqual({
      find: "500",
      replace: "600",
    });
    expect(pickAnchor("本文没有数字。")).toBeUndefined();
    // 数字出现两次 → 不唯一，不能当最短锚点。
    expect(pickAnchor("2024年签约，2024年交付。")?.find).toBeUndefined();
  });

  it.runIf(Boolean(officecliBin))(
    "runs the word chain on a real docx and leaves the original untouched",
    async () => {
      const ws = seedWorkspace();
      const materials = path.join(ws, "cases", "m-probe", "materials");
      const rel = "cases/m-probe/materials/合同原件.docx";
      await writeDocx(path.join(ws, rel), [
        "技术服务合同",
        "合同总价款为人民币500万元。",
        "乙方应于收到款项后交付。",
      ]);

      const report = await probeWordRevisionChain({
        workspaceDir: ws,
        matterId: "m-probe",
        keepArtifacts: true,
      });
      expect(report.status).toBe("done");
      expect(report.facts.anchor).toBe("500");
      expect(report.facts.insCount).toBeGreaterThanOrEqual(1);
      expect(report.facts.delCount).toBeGreaterThanOrEqual(1);
      expect(report.facts.baselineUnchanged).toBe(true);
      // 探针只在 lawmind/probe/ 下写副本，改稿产物也留在那里。
      expect(String(report.facts.baseline)).toContain("lawmind/probe/");
      expect(String(report.facts.outputPath)).toContain("合同原件_");
      expect(fs.existsSync(String(report.facts.outputPath))).toBe(true);
      expect(fs.readdirSync(materials)).toEqual(["合同原件.docx"]);
      expect(fs.readdirSync(materials).some((name) => name.includes(".lawmind-tmp"))).toBe(false);
    },
  );

  it("runs extraction on real material files and keeps every row traceable", async () => {
    const ws = seedWorkspace({ docx: false });
    const materials = path.join(ws, "cases", "m-probe", "materials");
    fs.writeFileSync(
      path.join(materials, "合同甲.txt"),
      "注册资本100万元。合同总价款500万元。",
      "utf8",
    );
    fs.writeFileSync(
      path.join(materials, "合同乙.txt"),
      "注册资本200万元。合同总价款800万元。",
      "utf8",
    );
    persistDraft(ws, {
      taskId: "unused",
      matterId: "m-probe",
      title: "占位",
      summary: "",
      output: "docx",
      templateId: "document-general-default",
      deliverableType: "document.general",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });

    const report = await probeContractExtractionChain({ workspaceDir: ws, matterId: "m-probe" });
    expect(report.status).toBe("done");
    expect(report.facts.rows).toBe(2);
    expect(report.facts.rowsWithSource).toBe(2);
    expect(report.facts.ambiguous).toBeGreaterThanOrEqual(1);
    expect(listProbeMatters(ws)[0]?.materials).toBe(2);
  });

  it("reports the draft chain as skipped instead of faking a model result", () => {
    const report = probeDraftChainWithoutModel();
    expect(report.status).toBe("skipped");
    expect(report.steps[0]?.detail).toContain("BYOK");
  });
});
