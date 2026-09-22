import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listOpenContractReviewDrafts,
  readContractReviewDraft,
  saveContractReviewDraft,
  markContractReviewDraftAccepted,
} from "./contract-review-draft.js";

describe("contract-review-draft", () => {
  const tmp: string[] = [];
  afterEach(async () => {
    for (const d of tmp) {
      await fs.rm(d, { recursive: true, force: true });
    }
    tmp.length = 0;
  });

  it("save list read accept", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-crd-"));
    tmp.push(ws);
    await fs.writeFile(path.join(ws, "a.txt"), "a", "utf8");
    await fs.writeFile(path.join(ws, "b.txt"), "b", "utf8");
    const d = await saveContractReviewDraft(ws, {
      initialPath: "a.txt",
      revisedPath: "b.txt",
      lawyerAnnotations: "请收紧违约金。",
      keyModificationsDraft: ["违约金上限"],
    });
    const open = await listOpenContractReviewDrafts(ws);
    expect(open.some((x) => x.draftId === d.draftId)).toBe(true);
    const again = await readContractReviewDraft(ws, d.draftId);
    expect(again?.lawyerAnnotations).toContain("违约金");
    await markContractReviewDraftAccepted(ws, d.draftId);
    const closed = await readContractReviewDraft(ws, d.draftId);
    expect(closed?.status).toBe("accepted");
    expect((await listOpenContractReviewDrafts(ws)).every((x) => x.draftId !== d.draftId)).toBe(
      true,
    );
  });
});
