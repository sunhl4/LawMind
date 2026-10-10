import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { handleFilesystemRoute } from "./lawmind-server-route-fs.js";
import { MOUNT_WRITE_REFUSAL } from "../../../src/lawmind/host-access/access-broker.js";
import { PROTECTED_WORKSPACE_WRITE_REFUSAL } from "../../../src/lawmind/runtime/protected-workspace-rels.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & { body?: unknown; status?: number } {
  const res = {
    status: 200,
    body: undefined as unknown,
    writeHead(code: number) {
      this.status = code;
    },
    end(payload?: string | Buffer) {
      if (typeof payload === "string") {
        this.body = JSON.parse(payload);
      }
    },
  } as http.ServerResponse & { body?: unknown; status?: number };
  return res;
}

describe("lawmind-server-route-fs", () => {
  let workspaceDir: string;
  let hostAccessFile: string;
  let mountDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-fs-route-")));
    await fs.mkdir(path.join(workspaceDir, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "artifacts", "demo.txt"), "hello", "utf8");
    mountDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-fs-mount-")));
    hostAccessFile = path.join(workspaceDir, "host-access.json");
    await fs.writeFile(
      hostAccessFile,
      JSON.stringify({ schemaVersion: 1, mounts: [{ id: "m1", absPath: mountDir }] }),
      "utf8",
    );
    process.env.LAWMIND_HOST_ACCESS_FILE = hostAccessFile;
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    delete process.env.LAWMIND_HOST_ACCESS_FILE;
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(mountDir, { recursive: true, force: true });
  });

  it("streams /api/fs/raw for pdf with Range support", async () => {
    const pdfPath = path.join(workspaceDir, "judgment.pdf");
    const bytes = Buffer.from("%PDF-1.4 mock-bytes-0123456789");
    await fs.writeFile(pdfPath, bytes);
    const chunks: Buffer[] = [];
    let status = 0;
    let headers: Record<string, string> = {};
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    }) as Writable & {
      writeHead: (code: number, h?: Record<string, string>) => void;
      end: (payload?: string | Buffer) => void;
    };
    res.writeHead = (code, h) => {
      status = code;
      headers = { ...h };
    };
    res.end = (payload?: string | Buffer) => {
      if (typeof payload === "string") {
        try {
          headers["__json"] = payload;
        } catch {
          /* ignore */
        }
      } else if (payload) {
        chunks.push(Buffer.from(payload));
      }
    };
    const handled = await handleFilesystemRoute({
      ctx,
      req: { method: "GET", headers: { range: "bytes=0-7" } } as http.IncomingMessage,
      res: res as unknown as http.ServerResponse,
      url: new URL("http://127.0.0.1/api/fs/raw?root=workspace&path=judgment.pdf"),
      pathname: "/api/fs/raw",
      c: {},
    });
    expect(handled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect({ status, headers, body: headers["__json"] ?? Buffer.concat(chunks).toString("utf8") }).toEqual(
      expect.objectContaining({ status: 206 }),
    );
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-range"]).toBe(`bytes 0-7/${bytes.length}`);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("%PDF-1.4");
  });

  it("rejects non-pdf on /api/fs/pdf-preview", async () => {
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: { method: "GET", headers: {} } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/fs/pdf-preview?root=workspace&path=artifacts/demo.txt"),
      pathname: "/api/fs/pdf-preview",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ ok: false, error: "not_pdf" });
  });

  it("returns sheet tables for /api/fs/xlsx-preview", async () => {
    const { writeXlsxWorkbook } = await import(
      "../../../src/lawmind/agent/tools/legal/xlsx-workbook.js"
    );
    const xlsxPath = path.join(workspaceDir, "ledger.xlsx");
    await writeXlsxWorkbook(xlsxPath, [
      {
        name: "费用",
        rows: [
          ["科目", "金额"],
          ["律师费", 12000],
        ],
      },
    ]);
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: { method: "GET", headers: {} } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/fs/xlsx-preview?root=workspace&path=ledger.xlsx"),
      pathname: "/api/fs/xlsx-preview",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      truncatedSheets: false,
    });
    expect(typeof (res.body as { mtimeMs?: unknown }).mtimeMs).toBe("number");
    const sheets = (res.body as { sheets: Array<{ name: string; cells: Array<Array<{ v: unknown } | null>> }> })
      .sheets;
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe("费用");
    expect(sheets[0]?.cells[0]?.[0]?.v).toBe("科目");
    expect(sheets[0]?.cells[0]?.[1]?.v).toBe("金额");
    expect(sheets[0]?.cells[1]?.[0]?.v).toBe("律师费");
    expect(sheets[0]?.cells[1]?.[1]?.v).toBe(12000);
  });

  it("lists zip entries for /api/fs/zip-listing", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("a/判决书.pdf", "%PDF");
    zip.folder("a/附件");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(workspaceDir, "证据.zip"), buf);
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: { method: "GET", headers: {} } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/fs/zip-listing?root=workspace&path=证据.zip"),
      pathname: "/api/fs/zip-listing",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, truncated: false });
    const entries = (res.body as { entries: Array<{ path: string }> }).entries;
    expect(entries.some((e) => e.path.includes("判决书.pdf"))).toBe(true);
  });

  it("converts misnamed OOXML .doc via /api/fs/convert-doc", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>旧稿</w:t></w:r></w:p></w:body></w:document>`,
    );
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(workspaceDir, "旧稿.doc"), buf);
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: mockJsonRequest("POST", { root: "workspace", path: "旧稿.doc" }),
      res,
      url: new URL("http://127.0.0.1/api/fs/convert-doc"),
      pathname: "/api/fs/convert-doc",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      relativePath: "旧稿.converted.docx",
      converted: true,
      tool: "zip-copy",
    });
    await expect(fs.stat(path.join(workspaceDir, "旧稿.converted.docx"))).resolves.toBeTruthy();
  });

  it("rejects /api/fs/xlsx-preview for non-xlsx", async () => {
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: { method: "GET", headers: {} } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/fs/xlsx-preview?root=workspace&path=notes.txt"),
      pathname: "/api/fs/xlsx-preview",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ ok: false, error: "not_xlsx" });
  });

  it("saves cell edits via /api/fs/xlsx-save", async () => {
    const { writeXlsxWorkbook } = await import(
      "../../../src/lawmind/agent/tools/legal/xlsx-workbook.js"
    );
    const { loadXlsxUiPreview } = await import(
      "../../../src/lawmind/agent/tools/legal/xlsx-preview.js"
    );
    const xlsxPath = path.join(workspaceDir, "ledger.xlsx");
    await writeXlsxWorkbook(xlsxPath, [{ name: "费用", rows: [["旧", 1]] }]);
    const st = await fs.stat(xlsxPath);
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: mockJsonRequest("POST", {
        root: "workspace",
        path: "ledger.xlsx",
        expectedMtimeMs: st.mtimeMs,
        edits: [{ sheet: "费用", row: 1, col: 1, value: "新" }],
      }),
      res,
      url: new URL("http://127.0.0.1/api/fs/xlsx-save"),
      pathname: "/api/fs/xlsx-save",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, applied: 1 });
    const loaded = await loadXlsxUiPreview(xlsxPath);
    expect(loaded.sheets[0]?.cells[0]?.[0]?.v).toBe("新");
  });

  it("rejects /api/fs/raw for non-whitelisted mime", async () => {
    await fs.writeFile(path.join(workspaceDir, "notes.bin"), "MZ");
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: { method: "GET", headers: {} } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/fs/raw?root=workspace&path=notes.bin"),
      pathname: "/api/fs/raw",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.body).toMatchObject({ ok: false, error: "mime_not_allowed" });
    expect(res.status).toBe(415);
  });

  it("returns 404 for missing artifact", async () => {
    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req,
      res,
      url: new URL("http://127.0.0.1/api/artifact?path=missing.txt"),
      pathname: "/api/artifact",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(404);
  });

  function mockJsonRequest(method: string, body: Record<string, unknown>): http.IncomingMessage {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const req = {
      method,
      on(event: string, cb: (...args: unknown[]) => void) {
        const list = listeners.get(event) ?? [];
        list.push(cb);
        listeners.set(event, list);
        return req;
      },
      destroy() {},
    } as unknown as http.IncomingMessage;
    queueMicrotask(() => {
      const payload = JSON.stringify(body);
      for (const cb of listeners.get("data") ?? []) {
        cb(Buffer.from(payload, "utf8"));
      }
      for (const cb of listeners.get("end") ?? []) {
        cb();
      }
    });
    return req;
  }

  async function postFsWrite(body: Record<string, unknown>) {
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: mockJsonRequest("POST", body),
      res,
      url: new URL("http://127.0.0.1/api/fs/write"),
      pathname: "/api/fs/write",
      c: {},
    });
    return { handled, res };
  }

  it("refuses writes into a host mount (mount:<id> is read-only)", async () => {
    const { handled, res } = await postFsWrite({
      root: "mount:m1",
      path: "evil.txt",
      content: "should not land",
    });

    expect(handled).toBe(true);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      ok: false,
      code: "root_not_writable",
      error: MOUNT_WRITE_REFUSAL,
    });
    await expect(fs.readFile(path.join(mountDir, "evil.txt"), "utf8")).rejects.toThrow();
  });

  it("refuses any root outside the writable allowlist", async () => {
    const { res } = await postFsWrite({ root: "grant:g1", path: "x.txt", content: "no" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ ok: false, code: "root_not_writable" });
  });

  it("still allows writes inside the workspace", async () => {
    const { res } = await postFsWrite({
      root: "workspace",
      path: "notes/keep.md",
      content: "ok",
    });

    expect(res.status).toBe(200);
    await expect(fs.readFile(path.join(workspaceDir, "notes", "keep.md"), "utf8")).resolves.toBe(
      "ok",
    );
  });

  it("still refuses protected governance paths inside the workspace", async () => {
    const { res } = await postFsWrite({
      root: "workspace",
      path: "lawmind.policy.json",
      content: "{}",
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      ok: false,
      code: "protected_workspace_path",
      error: PROTECTED_WORKSPACE_WRITE_REFUSAL,
    });
  });
});
