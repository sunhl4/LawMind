import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { PassThrough } from "node:stream";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { handleWordSurfaceRoutes } from "./lawmind-server-route-word-surface.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & { body?: { ok?: boolean; fileName?: string; error?: string }; status?: number } {
  const res = {
    status: 200,
    body: undefined as { ok?: boolean; fileName?: string; error?: string } | undefined,
    writeHead(code: number) {
      this.status = code;
    },
    end(payload?: string) {
      if (payload) {
        this.body = JSON.parse(payload) as { ok?: boolean; fileName?: string; error?: string };
      }
    },
  };
  return res as http.ServerResponse & { body?: { ok?: boolean; fileName?: string }; status?: number };
}

describe("word surface route", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("GET returns the open docx page", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-route-"));
    dirs.push(workspaceDir);
    const abs = path.join(workspaceDir, "合同.docx");
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>` +
        `<w:p w14:paraId="036DE1E2"/>` +
        `<w:p w14:paraId="32ECBB3D"><w:r><w:t>保洁服务委托合同</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    );
    await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    } as LawmindDispatchContext;
    const res = mockRes();
    const handled = await handleWordSurfaceRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/word-surface?root=workspace&path=合同.docx"),
      pathname: "/api/word-surface",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.fileName).toBe("合同.docx");
    const page = res.body as {
      fileMtimeMs?: number;
      codeStamp?: string;
      paragraphs?: Array<{ segments: Array<{ kind: string; text?: string }> }>;
    };
    expect(page.fileMtimeMs).toEqual(expect.any(Number));
    expect(page.codeStamp).toEqual(expect.any(String));
    const visible = (page.paragraphs ?? [])
      .flatMap((paragraph) => paragraph.segments)
      .map((segment) => segment.text ?? "")
      .join("\n");
    expect(visible).toContain("保洁服务委托合同");
    expect(visible).not.toContain("paraId");
    const mtime = page.fileMtimeMs;
    const again = mockRes();
    await handleWordSurfaceRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: again,
      url: new URL(
        `http://127.0.0.1/api/word-surface?root=workspace&path=${encodeURIComponent("合同.docx")}&fileMtime=${mtime}&proposalAt=`,
      ),
      pathname: "/api/word-surface",
      c: {},
    });
    expect(again.status).toBe(200);
    expect((again.body as { unchanged?: boolean }).unchanged).not.toBe(true);
    expect(JSON.stringify(again.body)).not.toContain("paraId");
    const skipped = mockRes();
    await handleWordSurfaceRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: skipped,
      url: new URL(
        `http://127.0.0.1/api/word-surface?root=workspace&path=${encodeURIComponent("合同.docx")}&fileMtime=${mtime}&proposalAt=&codeStamp=${encodeURIComponent(page.codeStamp ?? "")}`,
      ),
      pathname: "/api/word-surface",
      c: {},
    });
    expect(skipped.status).toBe(200);
    expect(skipped.body).toEqual({ ok: true, unchanged: true, codeStamp: page.codeStamp });
  });

  it("GET paints native Word revisions, and POST accepts one into the file", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-track-"));
    dirs.push(workspaceDir);
    const abs = path.join(workspaceDir, "合同.docx");
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        `<w:p>` +
        `<w:r><w:t>甲方应于</w:t></w:r>` +
        `<w:del w:id="1" w:author="李律师"><w:r><w:delText>十日</w:delText></w:r></w:del>` +
        `<w:ins w:id="2" w:author="王律师"><w:r><w:t>五日</w:t></w:r></w:ins>` +
        `<w:r><w:t>内付款。</w:t></w:r>` +
        `</w:p>` +
        `</w:body></w:document>`,
    );
    await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    } as LawmindDispatchContext;
    const pageRes = mockRes();
    await handleWordSurfaceRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: pageRes,
      url: new URL("http://127.0.0.1/api/word-surface?root=workspace&path=合同.docx"),
      pathname: "/api/word-surface",
      c: {},
    });
    const page = pageRes.body as {
      tracked?: Array<{ revId: string; change: string; author: string; color: number }>;
      paragraphs?: Array<{ segments: Array<{ kind: string; text?: string; change?: string }> }>;
    };
    expect(page.tracked).toEqual([
      expect.objectContaining({ revId: "1", change: "del", author: "李律师", color: 0 }),
      expect.objectContaining({ revId: "2", change: "ins", author: "王律师", color: 1 }),
    ]);
    const kinds = (page.paragraphs ?? []).flatMap((paragraph) =>
      paragraph.segments.map((segment) => segment.kind),
    );
    expect(kinds).toContain("tracked");
    const stream = new PassThrough();
    stream.end(
      JSON.stringify({
        root: "workspace",
        path: "合同.docx",
        decision: "accept",
        revId: "2",
      }),
      "utf8",
    );
    const acceptRes = mockRes();
    await handleWordSurfaceRoutes({
      ctx,
      req: Object.assign(stream, { method: "POST" }) as http.IncomingMessage,
      res: acceptRes,
      url: new URL("http://127.0.0.1/api/word-surface/tracked"),
      pathname: "/api/word-surface/tracked",
      c: {},
    });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body?.ok).toBe(true);
    const after = await JSZip.loadAsync(await fs.readFile(abs));
    const xml = await after.file("word/document.xml")?.async("string");
    expect(xml).toContain("<w:t>五日</w:t>");
    expect(xml).not.toContain("<w:ins ");
    expect(xml).toContain("<w:del ");
  });

  it("POST save writes runs back into the open file, and export copies it", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-save-"));
    dirs.push(workspaceDir);
    const abs = path.join(workspaceDir, "合同.docx");
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        `<w:p><w:r><w:t>甲方应于五日付款。</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    );
    await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    } as LawmindDispatchContext;
    const saveStream = new PassThrough();
    saveStream.end(
      JSON.stringify({
        root: "workspace",
        path: "合同.docx",
        paragraphs: [
          [
            { text: "甲方应于" },
            { text: "五日", track: { kind: "ins", id: "2", author: "张律师" } },
            { text: "付款。" },
          ],
        ],
      }),
      "utf8",
    );
    const saveRes = mockRes();
    await handleWordSurfaceRoutes({
      ctx,
      req: Object.assign(saveStream, { method: "POST" }) as http.IncomingMessage,
      res: saveRes,
      url: new URL("http://127.0.0.1/api/word-surface/save"),
      pathname: "/api/word-surface/save",
      c: {},
    });
    expect(saveRes.status).toBe(200);
    const saved = await JSZip.loadAsync(await fs.readFile(abs));
    const savedXml = await saved.file("word/document.xml")?.async("string");
    expect(savedXml).toContain('w:author="张律师"');
    const exportStream = new PassThrough();
    exportStream.end(JSON.stringify({ root: "workspace", path: "合同.docx" }), "utf8");
    const exportRes = mockRes();
    await handleWordSurfaceRoutes({
      ctx,
      req: Object.assign(exportStream, { method: "POST" }) as http.IncomingMessage,
      res: exportRes,
      url: new URL("http://127.0.0.1/api/word-surface/export"),
      pathname: "/api/word-surface/export",
      c: {},
    });
    expect(exportRes.status).toBe(200);
    expect((exportRes.body as { mode?: string; outputFileName?: string }).mode).toBe("copy");
    expect((exportRes.body as { outputFileName?: string }).outputFileName).toBe("合同_审阅稿.docx");
    await fs.access(path.join(workspaceDir, "合同_审阅稿.docx"));
  });
});
