import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileVersionOf } from "../runtime/file-version.js";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import {
  collectFileReferencesFromDraftBundle,
  lineRefFromPinAndUrl,
  validateDraftFileReferences,
} from "./citation-file-refs.js";
import { verifyDraftCitationEvidence } from "./citation-integrity.js";
import { citationViewBlocksExport } from "./mechanical-verdict.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-citation-file-refs-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const REL = "cases/m/materials/合同.txt";

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

function makeBundle(version: string, url = `${REL}#L2`): ResearchBundle {
  return {
    taskId: "t-1",
    query: "合同价款",
    sources: [
      {
        id: "s1",
        title: "合同",
        kind: "workspace",
        url,
        excerpt: "本合同总价款为人民币300万元",
        sourceVersion: version,
      },
    ],
    claims: [
      {
        text: "总价款为 300 万元",
        sourceIds: ["s1"],
        confidence: 0.9,
        model: "legal",
        pin: { quote: "本合同总价款为人民币300万元", page: "L2" },
      },
    ],
    riskFlags: [],
    missingItems: [],
  } as ResearchBundle;
}

describe("lineRefFromPinAndUrl", () => {
  it("prefers url hash, then pin page forms", () => {
    expect(lineRefFromPinAndUrl({ url: "a.txt#L4" })).toBe("L4");
    expect(lineRefFromPinAndUrl({ page: "12" })).toBe("P12");
    expect(lineRefFromPinAndUrl({ page: "第3页" })).toBe("P3");
    expect(lineRefFromPinAndUrl({ page: "S1!A1" })).toBe("S1!A1");
    expect(lineRefFromPinAndUrl({})).toBeNull();
  });
});

describe("validateDraftFileReferences wiring", () => {
  it("PASSES and does not block export when anchors match", () => {
    const ws = tmp();
    const abs = path.join(ws, REL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "前言\n本合同总价款为人民币300万元\n尾注\n", "utf8");
    const version = fileVersionOf(abs)!;
    const bundle = makeBundle(version);
    const collected = collectFileReferencesFromDraftBundle({
      draft: makeDraft(),
      bundle,
    });
    expect(collected?.references).toHaveLength(1);

    const gate = validateDraftFileReferences({
      rootDir: ws,
      draft: makeDraft(),
      bundle,
    });
    expect(gate?.status).toBe("PASSED");

    const view = verifyDraftCitationEvidence({
      rootDir: ws,
      draft: makeDraft(),
      bundle,
    });
    expect(view.ok).toBe(true);
    expect(view.fileReferences?.status).toBe("PASSED");
    expect(citationViewBlocksExport({ checked: true, ...view })).toBe(false);
  });

  it("FAILS and blocks export when the file was edited after citation", () => {
    const ws = tmp();
    const abs = path.join(ws, REL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "前言\n本合同总价款为人民币300万元\n尾注\n", "utf8");
    const version = fileVersionOf(abs)!;
    fs.writeFileSync(abs, "前言\n本合同总价款为人民币500万元\n尾注\n", "utf8");

    const view = verifyDraftCitationEvidence({
      rootDir: ws,
      draft: makeDraft(),
      bundle: makeBundle(version),
    });
    expect(view.ok).toBe(false);
    expect(view.fileReferences?.status).toBe("FAILED");
    expect(citationViewBlocksExport({ checked: true, ...view })).toBe(true);
  });

  it("skips the structured gate when there is no lineRef", () => {
    const ws = tmp();
    const abs = path.join(ws, REL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "本合同总价款为人民币300万元\n", "utf8");
    const version = fileVersionOf(abs)!;
    const bundle = makeBundle(version, REL);
    bundle.claims[0].pin = { quote: "本合同总价款为人民币300万元" };
    expect(collectFileReferencesFromDraftBundle({ draft: makeDraft(), bundle })).toBeNull();
  });
});
