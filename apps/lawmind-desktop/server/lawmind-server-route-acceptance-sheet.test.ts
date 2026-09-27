import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, saveSession } from "../../../src/lawmind/agent/session.js";
import { persistResearchSnapshot } from "../../../src/lawmind/drafts/research-snapshot.js";
import type { ResearchBundle } from "../../../src/lawmind/types.js";
import { acceptanceClaimId } from "../../../src/lawmind/acceptance-sheet/model.js";
import { handleAcceptanceSheetRoutes } from "./lawmind-server-route-acceptance-sheet.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(nextStatus: number) {
      status = nextStatus;
      return this;
    },
    end(chunk?: string | Buffer) {
      body += chunk ? chunk.toString() : "";
      return this;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    json() {
      return JSON.parse(body) as { ok?: boolean; error?: string; sheet?: { claims?: Array<{ mark?: string }> } };
    },
  };
}

function createJsonRequest(method: string, body?: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data" && body !== undefined) {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

function writeSimplePdf(filePath: string, text: string): void {
  const streamText = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET`;
  const streamLen = Buffer.byteLength(streamText, "utf8");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamText}\nendstream\nendobj\n`,
  ];
  const header = "%PDF-1.4\n";
  let body = "";
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "utf8");
  for (const obj of objects) {
    offsets.push(cursor);
    body += obj;
    cursor += Buffer.byteLength(obj, "utf8");
  }
  const xrefRows = offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n `).join("\n");
  const trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`;
  fs.writeFileSync(filePath, header + body + trailer, "binary");
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctxFor(dir: string): LawmindDispatchContext {
  return {
    workspaceDir: dir,
    envFile: undefined,
    userEnvPath: path.join(dir, "x.env"),
    policy: { loaded: false },
  };
}

describe("acceptance sheet route", () => {
  it("returns the sourced claim for the session and records 采信", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-route-"));
    tempDirs.push(dir);
    const session = createSession({ workspaceDir: dir, actorId: "lawyer" });
    const taskId = "task-route-1";
    const research: ResearchBundle = {
      taskId,
      query: "违约金",
      sources: [{ id: "src-1", title: "合同", kind: "contract", citation: "第 8 条", url: "cases/m/合同.pdf" }],
      claims: [
        { text: "违约金为百分之二十。", sourceIds: ["src-1"], confidence: 0.8, model: "legal" },
        { text: "没有出处的句子。", sourceIds: [], confidence: 0.99, model: "general" },
      ],
      riskFlags: [],
      missingItems: ["缺实际损失"],
      requiresReview: true,
      completedAt: "2026-09-27T00:00:00.000Z",
    };
    persistResearchSnapshot(dir, research);
    session.conversationHistory.push({
      role: "tool",
      content: "",
      timestamp: "2026-09-27T00:00:00.000Z",
      toolCallResponses: [
        { toolCallId: "c1", name: "research_task", result: { ok: true, data: { taskId } } },
      ],
    });
    saveSession(dir, session);

    const got = createResponseCapture();
    const pathname = `/api/sessions/${session.sessionId}/acceptance-sheet`;
    await handleAcceptanceSheetRoutes({
      ctx: ctxFor(dir),
      req: { method: "GET" } as http.IncomingMessage,
      res: got.res,
      url: new URL(`http://127.0.0.1${pathname}`),
      pathname,
      c: {},
    });
    expect(got.status).toBe(200);
    const body = got.json();
    expect(body.sheet?.claims).toHaveLength(1);
    expect(body.sheet?.claims?.[0]?.mark ?? null).toBeNull();

    const claimId = acceptanceClaimId("违约金为百分之二十。", ["src-1"]);
    const posted = createResponseCapture();
    await handleAcceptanceSheetRoutes({
      ctx: ctxFor(dir),
      req: createJsonRequest("POST", { claimId, mark: "accepted" }),
      res: posted.res,
      url: new URL(`http://127.0.0.1/api/drafts/${taskId}/acceptance-sheet`),
      pathname: `/api/drafts/${taskId}/acceptance-sheet`,
      c: {},
    });
    expect(posted.status).toBe(200);
    expect(posted.json().sheet?.claims?.[0]?.mark).toBe("accepted");
  });

  it("renders one PDF page and refuses a path that leaves the workspace", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-route-"));
    tempDirs.push(dir);
    const rel = "cases/m/合同.pdf";
    const abs = path.join(dir, "cases", "m", "合同.pdf");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeSimplePdf(abs, "page");

    let status = 0;
    let type = "";
    let raw = Buffer.alloc(0);
    const res = {
      writeHead(next: number, headers?: Record<string, string>) {
        status = next;
        type = headers?.["content-type"] ?? "";
        return this;
      },
      end(chunk?: string | Buffer) {
        raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? "");
        return this;
      },
    } as unknown as http.ServerResponse;
    const pathname = "/api/acceptance-sheet/page";
    const url = new URL(`http://127.0.0.1${pathname}?path=${encodeURIComponent(rel)}&page=1`);
    await handleAcceptanceSheetRoutes({
      ctx: ctxFor(dir),
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url,
      pathname,
      c: {},
    });
    expect(status).toBe(200);
    expect(type).toBe("image/png");
    expect(raw.subarray(0, 4).toString("hex")).toBe("89504e47");

    const denied = createResponseCapture();
    const bad = new URL("http://127.0.0.1/api/acceptance-sheet/page?path=../secret.pdf&page=1");
    await handleAcceptanceSheetRoutes({
      ctx: ctxFor(dir),
      req: { method: "GET" } as http.IncomingMessage,
      res: denied.res,
      url: bad,
      pathname: "/api/acceptance-sheet/page",
      c: {},
    });
    expect(denied.status).toBe(400);
  });

  it("rejects a session id that escapes the sessions directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-route-"));
    tempDirs.push(dir);
    const capture = createResponseCapture();
    await handleAcceptanceSheetRoutes({
      ctx: ctxFor(dir),
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/sessions/../acceptance-sheet"),
      pathname: "/api/sessions/../acceptance-sheet",
      c: {},
    });
    expect(capture.status).toBe(400);
  });

  it("does not guess when the same relative path exists in both folders", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-route-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-project-"));
    tempDirs.push(dir, project);
    const rel = "cases/m/合同.pdf";
    for (const root of [dir, project]) {
      const abs = path.join(root, "cases", "m", "合同.pdf");
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      writeSimplePdf(abs, "page");
    }
    const previous = process.env.LAWMIND_PROJECT_DIR;
    process.env.LAWMIND_PROJECT_DIR = project;
    try {
      const ambiguous = createResponseCapture();
      const pathname = "/api/acceptance-sheet/page";
      const query = `path=${encodeURIComponent(rel)}&page=1`;
      await handleAcceptanceSheetRoutes({
        ctx: ctxFor(dir),
        req: { method: "GET" } as http.IncomingMessage,
        res: ambiguous.res,
        url: new URL(`http://127.0.0.1${pathname}?${query}`),
        pathname,
        c: {},
      });
      expect(ambiguous.status).toBe(409);
      expect(ambiguous.json().error).toBe("ambiguous_root");

      let status = 0;
      const named = {
        writeHead(next: number) {
          status = next;
          return this;
        },
        end() {
          return this;
        },
      } as unknown as http.ServerResponse;
      await handleAcceptanceSheetRoutes({
        ctx: ctxFor(dir),
        req: { method: "GET" } as http.IncomingMessage,
        res: named,
        url: new URL(`http://127.0.0.1${pathname}?${query}&root=project`),
        pathname,
        c: {},
      });
      expect(status).toBe(200);

      const located = createResponseCapture();
      await handleAcceptanceSheetRoutes({
        ctx: ctxFor(dir),
        req: { method: "GET" } as http.IncomingMessage,
        res: located.res,
        url: new URL(`http://127.0.0.1/api/acceptance-sheet/locate?${query}`),
        pathname: "/api/acceptance-sheet/locate",
        c: {},
      });
      expect(located.status).toBe(409);
      expect(located.json().error).toBe("ambiguous_root");
    } finally {
      if (previous === undefined) {
        delete process.env.LAWMIND_PROJECT_DIR;
      } else {
        process.env.LAWMIND_PROJECT_DIR = previous;
      }
    }
  });

  it("refuses a pdf larger than 20MB", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-route-"));
    tempDirs.push(dir);
    const rel = "cases/m/大.pdf";
    const abs = path.join(dir, "cases", "m", "大.pdf");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const fd = fs.openSync(abs, "w");
    fs.ftruncateSync(fd, 20 * 1024 * 1024 + 1);
    fs.closeSync(fd);
    const capture = createResponseCapture();
    const pathname = "/api/acceptance-sheet/page";
    await handleAcceptanceSheetRoutes({
      ctx: ctxFor(dir),
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL(`http://127.0.0.1${pathname}?path=${encodeURIComponent(rel)}&page=1`),
      pathname,
      c: {},
    });
    expect(capture.status).toBe(413);
    expect(capture.json().error).toBe("pdf_too_large");
  });

  it("opens the only folder that contains the file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-route-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-project-"));
    tempDirs.push(dir, project);
    const rel = "cases/m/合同.docx";
    const abs = path.join(project, "cases", "m", "合同.docx");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "docx");
    const previous = process.env.LAWMIND_PROJECT_DIR;
    process.env.LAWMIND_PROJECT_DIR = project;
    try {
      const capture = createResponseCapture();
      const pathname = "/api/acceptance-sheet/locate";
      await handleAcceptanceSheetRoutes({
        ctx: ctxFor(dir),
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL(`http://127.0.0.1${pathname}?path=${encodeURIComponent(rel)}`),
        pathname,
        c: {},
      });
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({ ok: true, root: "project" });
    } finally {
      if (previous === undefined) {
        delete process.env.LAWMIND_PROJECT_DIR;
      } else {
        process.env.LAWMIND_PROJECT_DIR = previous;
      }
    }
  });
});
