import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStanceItems } from "../stance/index.js";
import {
  contractRevisionsRootDir,
  finalizeContractRevisionPack,
  listContractRevisionPacks,
  resolvePathStrictlyUnderWorkspace,
} from "./contract-revision-pack.js";

describe("contract-revision-pack", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs) {
      await fs.rm(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function mkWorkspace(): Promise<string> {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "lm-cr-"));
    tmpDirs.push(d);
    return d;
  }

  it("resolvePathStrictlyUnderWorkspace rejects escape", async () => {
    const ws = await mkWorkspace();
    expect(() => resolvePathStrictlyUnderWorkspace(ws, "../outside")).toThrow(
      "path_outside_workspace",
    );
  });

  it("finalizeContractRevisionPack copies files and writes manifest", async () => {
    const ws = await mkWorkspace();
    const initial = path.join(ws, "a.docx");
    const final = path.join(ws, "b.docx");
    await fs.writeFile(initial, "v0", "utf8");
    await fs.writeFile(final, "v1-final", "utf8");

    const { revisionId, packDir, manifest } = await finalizeContractRevisionPack({
      workspaceDir: ws,
      initialSourcePath: "a.docx",
      finalSourcePath: "b.docx",
      keyModifications: [" 将付款周期改为月结 ", "管辖改为提交北京仲裁委员会仲裁"],
      title: "采购合同修订",
      requirementsSummary: "按客户要求收紧违约责任。",
      matterId: "m1",
      assistantId: "default",
    });

    expect(revisionId.startsWith("cr_")).toBe(true);
    expect(manifest.title).toBe("采购合同修订");
    expect(manifest.matterId).toBe("m1");
    expect(manifest.initial.byteSize).toBeGreaterThan(0);
    expect(manifest.final.sha256).toHaveLength(64);

    const keyPath = path.join(packDir, "KEY_MODIFICATIONS.md");
    const keyRaw = await fs.readFile(keyPath, "utf8");
    expect(keyRaw).toContain("采购合同修订");
    expect(keyRaw).toContain("将付款周期改为月结");

    const manRaw = await fs.readFile(path.join(packDir, "manifest.json"), "utf8");
    expect(JSON.parse(manRaw).revisionId).toBe(revisionId);

    const initialCopy = await fs.readFile(path.join(packDir, "initial", "a.docx"), "utf8");
    const finalCopy = await fs.readFile(path.join(packDir, "final", "b.docx"), "utf8");
    expect(initialCopy).toBe("v0");
    expect(finalCopy).toBe("v1-final");
    expect(
      readStanceItems(ws).some((it) => it.source === "revision_pack" && it.clauseType === "管辖"),
    ).toBe(true);
  });

  it("finalize writes stableDocumentKey index", async () => {
    const ws = await mkWorkspace();
    await fs.writeFile(path.join(ws, "i2.docx"), "i", "utf8");
    await fs.writeFile(path.join(ws, "f2.docx"), "f", "utf8");
    const r1 = await finalizeContractRevisionPack({
      workspaceDir: ws,
      initialSourcePath: "i2.docx",
      finalSourcePath: "f2.docx",
      keyModifications: ["一"],
      stableDocumentKey: "MSA-2024-001",
    });
    const r2 = await finalizeContractRevisionPack({
      workspaceDir: ws,
      initialSourcePath: "i2.docx",
      finalSourcePath: "f2.docx",
      keyModifications: ["二"],
      stableDocumentKey: "MSA-2024-001",
    });
    expect(r1.revisionId).not.toBe(r2.revisionId);
    const idxPath = path.join(
      ws,
      "learning",
      "contract-revisions",
      "_index",
      "by-key",
      "MSA-2024-001.json",
    );
    const idx = JSON.parse(await fs.readFile(idxPath, "utf8")) as {
      latestRevisionId: string;
      history: string[];
    };
    expect(idx.latestRevisionId).toBe(r2.revisionId);
    expect(idx.history).toContain(r1.revisionId);
    expect(idx.history).toContain(r2.revisionId);
  });

  it("listContractRevisionPacks returns finalized packs", async () => {
    const ws = await mkWorkspace();
    await fs.writeFile(path.join(ws, "i.md"), "i", "utf8");
    await fs.writeFile(path.join(ws, "f.md"), "f", "utf8");
    await finalizeContractRevisionPack({
      workspaceDir: ws,
      initialSourcePath: "i.md",
      finalSourcePath: "f.md",
      keyModifications: ["x"],
      title: "T1",
    });
    const list = await listContractRevisionPacks(ws, 10);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe("T1");
    expect(contractRevisionsRootDir(ws)).toBe(path.join(ws, "learning", "contract-revisions"));
  });
});
