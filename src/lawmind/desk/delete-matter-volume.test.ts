import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCaseTemplate } from "../memory/templates.js";
import { deleteMatterVolume } from "./delete-matter-volume.js";

const temps: string[] = [];

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-del-vol-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("deleteMatterVolume", () => {
  it("removes both the case folder and the matter record, and leaves policy alone", async () => {
    const ws = await tmp();
    const id = "empty-shell";
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");
    await fs.writeFile(path.join(ws, "matters", id, "queue.jsonl"), "{}\n");
    await fs.writeFile(path.join(ws, "lawmind.policy.json"), "{}\n");
    await fs.mkdir(path.join(ws, "matters", "keep"), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", "keep", "matter.json"), "{}\n");

    const result = await deleteMatterVolume(ws, id, { requireEmpty: true });
    expect(result.ok).toBe(true);
    await expect(fs.access(path.join(ws, "matters", id))).rejects.toBeDefined();
    expect(await fs.readFile(path.join(ws, "lawmind.policy.json"), "utf8")).toBe("{}\n");
    expect(await fs.readFile(path.join(ws, "matters", "keep", "matter.json"), "utf8")).toBe("{}\n");
  });

  it("refuses to delete a volume that still has materials unless asked", async () => {
    const ws = await tmp();
    const id = "kept-2";
    await fs.mkdir(path.join(ws, "cases", id, "materials"), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", id, "materials", "常法合同.docx"), "x");
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");

    const refused = await deleteMatterVolume(ws, id, { requireEmpty: true });
    expect(refused.ok).toBe(false);
    await expect(
      fs.access(path.join(ws, "cases", id, "materials", "常法合同.docx")),
    ).resolves.toBeUndefined();

    const removed = await deleteMatterVolume(ws, id);
    expect(removed.ok).toBe(true);
    await expect(fs.access(path.join(ws, "cases", id))).rejects.toBeDefined();
    await expect(fs.access(path.join(ws, "matters", id))).rejects.toBeDefined();
  });

  it("treats an untouched CASE template as empty, and a written dossier as content", async () => {
    const ws = await tmp();
    const id = "shell";
    await fs.mkdir(path.join(ws, "cases", id), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", id, "CASE.md"), defaultCaseTemplate(id));
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");

    const empty = await deleteMatterVolume(ws, id, { requireEmpty: true });
    expect(empty.ok).toBe(true);

    const written = "written";
    await fs.mkdir(path.join(ws, "cases", written), { recursive: true });
    await fs.writeFile(
      path.join(ws, "cases", written, "CASE.md"),
      `${defaultCaseTemplate(written)}\n律师补了一句事实。\n`,
    );
    await fs.mkdir(path.join(ws, "matters", written), { recursive: true });
    const refused = await deleteMatterVolume(ws, written, { requireEmpty: true });
    expect(refused.ok).toBe(false);
    await expect(fs.access(path.join(ws, "cases", written, "CASE.md"))).resolves.toBeUndefined();
  });

  it("refuses a case directory that is a symlink to another matter", async () => {
    const ws = await tmp();
    await fs.mkdir(path.join(ws, "cases", "kept", "materials"), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", "kept", "materials", "合同.docx"), "x");
    await fs.mkdir(path.join(ws, "matters", "alias"), { recursive: true });
    await fs.symlink(path.join(ws, "cases", "kept"), path.join(ws, "cases", "alias"));

    const result = await deleteMatterVolume(ws, "alias");
    expect(result.ok).toBe(false);
    await expect(
      fs.access(path.join(ws, "cases", "kept", "materials", "合同.docx")),
    ).resolves.toBeUndefined();
  });
});
