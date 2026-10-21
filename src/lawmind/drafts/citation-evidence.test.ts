/**
 * 出稿判定的两道新缺口：来源被改过、原句对不上。
 * 旧的 `citation` 只查「引用的 id 在不在 bundle 里」，这两类它抓不到。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import {
  validateDraftCitationsAgainstBundle,
  verifyDraftCitationEvidence,
} from "./citation-integrity.js";
import { resolveDraftCitationIntegrity } from "./citation-resolve.js";
import { fileVersionOf } from "./evidence-support.js";
import { citationViewBlocksExport, evaluateMechanicalVerdict } from "./mechanical-verdict.js";
import { persistResearchSnapshot } from "./research-snapshot.js";

const dirs: string[] = [];

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-citation-evidence-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const REL = "cases/m/materials/合同.txt";

function makeBundle(version?: string): ResearchBundle {
  return {
    taskId: "t-1",
    query: "合同价款",
    sources: [
      {
        id: "s1",
        title: "合同",
        kind: "workspace",
        url: REL,
        excerpt: "本合同总价款为人民币300万元",
        ...(version ? { sourceVersion: version } : {}),
      },
    ],
    claims: [
      {
        text: "总价款为 300 万元",
        sourceIds: ["s1"],
        confidence: 0.9,
        model: "legal",
        pin: { quote: "本合同总价款为人民币300万元" },
      },
    ],
    riskFlags: [],
    missingItems: [],
  } as ResearchBundle;
}

function makeDraft(): ArtifactDraft {
  return {
    taskId: "t-1",
    deliverableType: "memo.opinion",
    title: "意见",
    sections: [
      {
        heading: "价款",
        body: "本合同总价款为人民币300万元，据此计算违约金。",
        citations: ["s1"],
      },
    ],
    riskFlags: [],
    openQuestions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as ArtifactDraft;
}

function seedContract(ws: string, text: string): string {
  fs.mkdirSync(path.dirname(path.join(ws, REL)), { recursive: true });
  fs.writeFileSync(path.join(ws, REL), text, "utf8");
  return fileVersionOf(path.join(ws, REL))!;
}

describe("verifyDraftCitationEvidence", () => {
  it("passes when the source is unchanged and the quote is still there", () => {
    const ws = tmpWorkspace();
    const version = seedContract(ws, "本合同总价款为人民币300万元。\n");
    const result = verifyDraftCitationEvidence({
      draft: makeDraft(),
      bundle: makeBundle(version),
      rootDir: ws,
    });
    expect(result.ok).toBe(true);
    expect(result.staleSources ?? []).toEqual([]);
    expect(result.quoteMismatches ?? []).toEqual([]);
  });

  it("flags a source that was edited after the citation was recorded", () => {
    const ws = tmpWorkspace();
    const version = seedContract(ws, "本合同总价款为人民币300万元。\n");
    // 律师（或另一个进程）之后改了这份材料。
    fs.writeFileSync(path.join(ws, REL), "本合同总价款为人民币500万元。\n", "utf8");

    const result = verifyDraftCitationEvidence({
      draft: makeDraft(),
      bundle: makeBundle(version),
      rootDir: ws,
    });
    expect(result.staleSources?.map((s) => s.sourceId)).toEqual(["s1"]);
  });

  it("flags a quote that no longer exists in the source", () => {
    const ws = tmpWorkspace();
    seedContract(ws, "本合同总价款以补充协议为准。\n");
    const result = verifyDraftCitationEvidence({
      draft: makeDraft(),
      // 版本未知（历史数据）：不判 stale，但原句对不上。
      bundle: makeBundle(),
      rootDir: ws,
    });
    expect(result.quoteMismatches?.map((s) => s.sourceId)).toEqual(["s1"]);
  });

  it("the production export resolver rejects a stale persisted research snapshot", () => {
    const ws = tmpWorkspace();
    const version = seedContract(ws, "本合同总价款为人民币300万元。\n");
    persistResearchSnapshot(ws, makeBundle(version));
    seedContract(ws, "本合同总价款为人民币500万元。\n");
    const view = resolveDraftCitationIntegrity(ws, makeDraft());
    expect(citationViewBlocksExport(view)).toBe(true);
    expect(view).toMatchObject({ checked: true, ok: false });
  });

  it("checks every claim quote rather than passing after the first valid quote", () => {
    const ws = tmpWorkspace();
    seedContract(ws, "本合同总价款为人民币300万元。\n");
    const bundle = makeBundle();
    bundle.claims.push({
      text: "不存在的事实",
      sourceIds: ["s1"],
      confidence: 1,
      model: "legal",
      pin: { quote: "已付清所有价款" },
    });
    expect(verifyDraftCitationEvidence({ rootDir: ws, draft: makeDraft(), bundle })).toMatchObject({
      ok: false,
      quoteMismatches: [{ sourceId: "s1" }],
    });
  });

  it("unverifiable local sources block rather than silently passing", () => {
    const ws = tmpWorkspace();
    const bundle = makeBundle();
    bundle.sources[0].url = "unsupported.docx";
    fs.writeFileSync(path.join(ws, "unsupported.docx"), "not-plain-text");
    const view = verifyDraftCitationEvidence({ rootDir: ws, draft: makeDraft(), bundle });
    expect(view).toMatchObject({ ok: false, unverifiableSources: [{ sourceId: "s1" }] });
    expect(citationViewBlocksExport({ checked: true, ...view })).toBe(true);
  });

  it("keeps the pure bundle check independent of the filesystem", () => {
    const result = validateDraftCitationsAgainstBundle(makeDraft(), makeBundle());
    expect(result.ok).toBe(true);
    expect(result.staleSources).toBeUndefined();
    expect(result.quoteMismatches).toBeUndefined();
  });
});

describe("mechanical verdict blocks delivery on evidence gaps", () => {
  const base = {
    acceptanceReady: true,
    redlinePending: null,
  };

  it("blocks on stale sources", () => {
    const verdict = evaluateMechanicalVerdict({
      ...base,
      citation: {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
        staleSources: [{ sourceId: "s1", reasonZh: "被改过" }],
      },
    });
    expect(verdict.green).toBe(false);
    expect(verdict.blocks).toContain("citation_stale");
  });

  it("blocks on quote mismatch", () => {
    const verdict = evaluateMechanicalVerdict({
      ...base,
      citation: {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
        quoteMismatches: [{ sourceId: "s1", reasonZh: "原句找不到" }],
      },
    });
    expect(verdict.green).toBe(false);
    expect(verdict.blocks).toContain("citation_quote_mismatch");
    expect(
      citationViewBlocksExport({
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
        quoteMismatches: [{ sourceId: "s1", reasonZh: "原句找不到" }],
      }),
    ).toBe(true);
  });

  it("stays green when every check applies and passes", () => {
    const verdict = evaluateMechanicalVerdict({
      ...base,
      citation: {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
        staleSources: [],
        quoteMismatches: [],
      },
    });
    expect(verdict.green).toBe(true);
    expect(verdict.blocks).toEqual([]);
  });
});
