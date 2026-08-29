import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMatterReviewedWordFilename,
  matterIdFromWorkspaceRelativePath,
  resolveMatterWorkspaceDir,
  safeDeliveryStem,
} from "./matter-word-delivery.js";

describe("matter-word-delivery", () => {
  it("keeps original stem and appends date", () => {
    const name = buildMatterReviewedWordFilename(
      "国浩审-20260730-合作协议（普华小华）20260625 (sx004).doc",
      new Date("2026-07-31T12:00:00"),
    );
    expect(name).toBe("国浩审-20260730-合作协议（普华小华）20260625 (sx004)_20260731_01.docx");
  });

  it("increments version when same-day file already exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-deliv-"));
    const at = new Date("2026-07-31T15:04:05");
    const primary = buildMatterReviewedWordFilename("nda.docx", at, { dirForUniqueness: dir });
    expect(primary).toBe("nda_20260731_01.docx");
    fs.writeFileSync(path.join(dir, primary), "x");
    const second = buildMatterReviewedWordFilename("nda.docx", at, { dirForUniqueness: dir });
    expect(second).toBe("nda_20260731_02.docx");
  });

  it("resolves matter dir and id from baseline path", () => {
    expect(matterIdFromWorkspaceRelativePath("cases/临时讨论/mail/attachments/a/x.doc")).toBe(
      "临时讨论",
    );
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ws-"));
    expect(resolveMatterWorkspaceDir(ws, "临时讨论")).toBe(path.join(ws, "cases", "临时讨论"));
  });

  it("sanitizes unsafe stem characters", () => {
    expect(safeDeliveryStem("合同:修订*.doc")).toBe("合同_修订");
  });
});
