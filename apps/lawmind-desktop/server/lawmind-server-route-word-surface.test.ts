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
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>`,
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
    const mtime = (res.body as { fileMtimeMs?: number }).fileMtimeMs;
    expect(mtime).toEqual(expect.any(Number));
    const again = mockRes();
    const skipped = await handleWordSurfaceRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: again,
      url: new URL(
        `http://127.0.0.1/api/word-surface?root=workspace&path=${encodeURIComponent("合同.docx")}&fileMtime=${mtime}&proposalAt=`,
      ),
      pathname: "/api/word-surface",
      c: {},
    });
    expect(skipped).toBe(true);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true, unchanged: true });
  });
});
