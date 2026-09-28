import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
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
});
