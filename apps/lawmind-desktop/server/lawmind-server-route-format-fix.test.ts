import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { handleFormatFixRoutes } from "./lawmind-server-route-format-audit.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type ResBody = {
  ok?: boolean;
  error?: string;
  detail?: string;
  outputPath?: string;
  appliedParagraphs?: number;
  revisions?: { verified: boolean; beforeCount: number; afterCount: number };
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

function reqWith(body: unknown): http.IncomingMessage {
  const req = { method: "POST", headers: {} } as http.IncomingMessage;
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
  const run = (text: string, font: string, half: number) =>
    `<w:r><w:rPr><w:rFonts w:eastAsia="${font}" w:ascii="${font}"/><w:sz w:val="${half}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const xml =
    `<w:document xmlns:w="${W}"><w:body>` +
    `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>` +
    `<w:ins w:id="11" w:author="对方律师" w:date="2026-10-01T00:00:00Z">${run(
      "本合同自双方签字之日起生效，任何变更须以书面形式确认并送达。",
      "SimSun",
      24,
    )}</w:ins></w:p>` +
    `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>${run(
      "乙方应在收到货物后十日内完成验收，并书面通知甲方验收结果。",
      "SimSun",
      24,
    )}</w:p>` +
    `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>${run(
      "甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。",
      "FangSong_GB2312",
      32,
    )}</w:p>` +
    `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file("word/styles.xml", `<w:styles xmlns:w="${W}"></w:styles>`);
  const abs = path.join(workspaceDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("format fix route", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function workspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-format-fix-route-"));
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

  it("writes a sibling copy with format revisions and keeps the original untouched", async () => {
    const workspaceDir = await workspace();
    await writeDocx(workspaceDir, "材料/回稿.docx");
    const before = await fs.readFile(path.join(workspaceDir, "材料/回稿.docx"));
    const res = mockRes();
    const handled = await handleFormatFixRoutes({
      ctx: ctxFor(workspaceDir),
      req: reqWith({
        root: "workspace",
        path: "材料/回稿.docx",
        mode: "imported",
        lawmindParagraphs: [2],
      }),
      res,
      url: new URL("http://127.0.0.1/api/documents/format-fix"),
      pathname: "/api/documents/format-fix",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.outputPath).toBe("材料/回稿_格式修订.docx");
    expect(res.body?.appliedParagraphs).toBe(1);
    expect(res.body?.revisions?.verified).toBe(true);
    // 原文件字节不变
    expect((await fs.readFile(path.join(workspaceDir, "材料/回稿.docx"))).equals(before)).toBe(true);
  });

  it("refuses in-place and non-docx", async () => {
    const workspaceDir = await workspace();
    await writeDocx(workspaceDir, "回稿.docx");

    const inPlace = mockRes();
    await handleFormatFixRoutes({
      ctx: ctxFor(workspaceDir),
      req: reqWith({
        root: "workspace",
        path: "回稿.docx",
        outputPath: "回稿.docx",
      }),
      res: inPlace,
      url: new URL("http://127.0.0.1/api/documents/format-fix"),
      pathname: "/api/documents/format-fix",
      c: {},
    });
    expect(inPlace.status).toBe(400);
    expect(inPlace.body?.error).toBe("in_place_refused");

    const wrong = mockRes();
    await handleFormatFixRoutes({
      ctx: ctxFor(workspaceDir),
      req: reqWith({ root: "workspace", path: "旧稿.doc" }),
      res: wrong,
      url: new URL("http://127.0.0.1/api/documents/format-fix"),
      pathname: "/api/documents/format-fix",
      c: {},
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body?.error).toBe("unsupported_file_type");
  });
});
