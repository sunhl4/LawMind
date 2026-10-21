import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { handleFormatAuditRoutes } from "./lawmind-server-route-format-audit.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type ResBody = {
  ok?: boolean;
  error?: string;
  text?: string;
  report?: {
    mode?: string;
    ok?: boolean;
    counts?: { error: number; warning: number };
    standard?: { id: string; provisional: boolean; noticeZh: string };
    profile?: { fontFamily?: string };
    unchecked?: string[];
  };
};

function mockRes(): http.ServerResponse & { body?: ResBody; status?: number } {
  return {
    status: 200,
    body: undefined as ResBody | undefined,
    writeHead(code: number) {
      this.status = code;
    },
    once() {},
    off() {},
    end(payload?: string) {
      if (payload) {
        this.body = JSON.parse(payload) as ResBody;
      }
    },
  } as http.ServerResponse & { body?: ResBody; status?: number };
}

function reqWith(body: unknown, method = "POST"): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(payload);
      }
      if (event === "end") {
        handler();
      }
      return req;
    },
  });
  return req;
}

async function writeDocx(workspaceDir: string, rel: string): Promise<void> {
  const xml =
    `<w:document xmlns:w="${W}"><w:body>` +
    `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:eastAsia="SimSun"/><w:sz w:val="24"/></w:rPr><w:t>本合同自双方签字之日起生效。</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:eastAsia="SimSun"/><w:sz w:val="24"/></w:rPr><w:t>乙方应在收到货物后十日内完成验收。</w:t></w:r></w:p>` +
    `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const abs = path.join(workspaceDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("format audit route", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function workspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-format-route-"));
    dirs.push(dir);
    return dir;
  }

  function ctxFor(workspaceDir: string): LawmindDispatchContext {
    return {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    } as LawmindDispatchContext;
  }

  it("defaults to following the file and returns the readable checklist", async () => {
    const workspaceDir = await workspace();
    await writeDocx(workspaceDir, "材料/合同.docx");
    const res = mockRes();
    const handled = await handleFormatAuditRoutes({
      ctx: ctxFor(workspaceDir),
      req: reqWith({ root: "workspace", path: "材料/合同.docx" }),
      res,
      url: new URL("http://127.0.0.1/api/documents/format-audit"),
      pathname: "/api/documents/format-audit",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.report?.mode).toBe("imported");
    expect(res.body?.report?.standard?.id).toBe("document-self");
    expect(res.body?.report?.profile?.fontFamily).toBe("宋体");
    expect(res.body?.text).toContain("跟随原文");
  });

  it("marks the GB standard as provisional in from-scratch mode", async () => {
    const workspaceDir = await workspace();
    await writeDocx(workspaceDir, "drafts/通知.docx");
    const res = mockRes();
    await handleFormatAuditRoutes({
      ctx: ctxFor(workspaceDir),
      req: reqWith({ root: "workspace", path: "drafts/通知.docx", mode: "from-scratch" }),
      res,
      url: new URL("http://127.0.0.1/api/documents/format-audit"),
      pathname: "/api/documents/format-audit",
      c: {},
    });
    expect(res.body?.report?.standard?.provisional).toBe(true);
    expect(res.body?.report?.standard?.noticeZh).toContain("待律师确认");
    expect(res.body?.report?.counts?.error).toBeGreaterThan(0);
    expect(res.body?.text).toContain("未检查");
  });

  it("refuses non-docx, missing files, and non-POST", async () => {
    const workspaceDir = await workspace();

    const wrongType = mockRes();
    await handleFormatAuditRoutes({
      ctx: ctxFor(workspaceDir),
      req: reqWith({ root: "workspace", path: "旧稿.doc" }),
      res: wrongType,
      url: new URL("http://127.0.0.1/api/documents/format-audit"),
      pathname: "/api/documents/format-audit",
      c: {},
    });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body?.error).toBe("unsupported_file_type");

    const missing = mockRes();
    await handleFormatAuditRoutes({
      ctx: ctxFor(workspaceDir),
      req: reqWith({ root: "workspace", path: "不存在.docx" }),
      res: missing,
      url: new URL("http://127.0.0.1/api/documents/format-audit"),
      pathname: "/api/documents/format-audit",
      c: {},
    });
    expect(missing.status).toBe(404);
    expect(missing.body?.error).toBe("not_found");

    const wrongMethod = mockRes();
    const handled = await handleFormatAuditRoutes({
      ctx: ctxFor(workspaceDir),
      req: { method: "GET" } as http.IncomingMessage,
      res: wrongMethod,
      url: new URL("http://127.0.0.1/api/documents/format-audit"),
      pathname: "/api/documents/format-audit",
      c: {},
    });
    expect(handled).toBe(true);
    expect(wrongMethod.status).toBe(405);
  });

  it("does not match other paths", async () => {
    const workspaceDir = await workspace();
    const handled = await handleFormatAuditRoutes({
      ctx: ctxFor(workspaceDir),
      req: { method: "POST" } as http.IncomingMessage,
      res: mockRes(),
      url: new URL("http://127.0.0.1/api/word-surface"),
      pathname: "/api/word-surface",
      c: {},
    });
    expect(handled).toBe(false);
  });
});
