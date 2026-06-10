import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  createSession,
  loadSession,
  listSessions,
  appendTurn,
  loadTurns,
  compactHistory,
} from "./session.js";
import { buildSystemPrompt, LAWMIND_AGENT_BEHAVIOR_EPOCH } from "./system-prompt.js";
import { createLegalToolRegistry } from "./tools/legal-tools.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentMessage, AgentTurn } from "./types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-agent-test-"));
}

function createSimplePdfWithText(filePath: string, text: string): void {
  const escapePdfText = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const streamText = `BT\n/F1 12 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`;
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
  const xrefStart = cursor;
  const xrefRows = offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n `).join("\n");
  const trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  fs.writeFileSync(filePath, header + body + trailer, "binary");
}

async function createSimpleDocxWithText(filePath: string, text: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(filePath, buffer);
}

async function createSimpleXlsxWithCell(filePath: string, cellValue: string): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([cellValue]);
  ws.addRow(["second-row"]);
  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync(filePath, Buffer.from(buf));
}

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "test_tool",
        description: "A test tool",
        category: "system",
        parameters: { query: { type: "string", description: "test", required: true } },
      },
      async execute() {
        return { ok: true, data: { result: "ok" } };
      },
    });

    expect(registry.size()).toBe(1);
    expect(registry.get("test_tool")).toBeDefined();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("prevents duplicate registration", () => {
    const registry = new ToolRegistry();
    const tool = {
      definition: {
        name: "dup",
        description: "duplicate",
        category: "system" as const,
        parameters: {},
      },
      async execute() {
        return { ok: true };
      },
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow("already registered");
  });

  it("lists by category", () => {
    const registry = createLegalToolRegistry();
    const searchTools = registry.listByCategory("search");
    expect(searchTools.length).toBeGreaterThanOrEqual(2);
    expect(searchTools.every((t) => t.category === "search")).toBe(true);
  });

  it("converts to OpenAI tools format", () => {
    const registry = createLegalToolRegistry();
    const openAITools = registry.toOpenAITools();
    expect(openAITools.length).toBe(registry.size());

    for (const tool of openAITools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
    }
  });
});

describe("Legal Tool Registry", () => {
  it("contains expected tools", () => {
    const registry = createLegalToolRegistry();
    const names = registry.listDefinitions().map((t) => t.name);

    expect(names).toContain("search_matter");
    expect(names).toContain("search_workspace");
    expect(names).toContain("read_project_file");
    expect(names).toContain("get_matter_summary");
    expect(names).toContain("list_matters");
    expect(names).toContain("read_case_file");
    expect(names).toContain("add_case_note");
    expect(names).toContain("analyze_document");
    expect(names).toContain("write_document");
    expect(names).toContain("list_tasks");
    expect(names).toContain("list_drafts");
    expect(names).toContain("get_audit_trail");
  });

  it("can execute list_matters tool", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("list_matters")!;

    const result = await tool.execute(
      {},
      {
        workspaceDir: ws,
        sessionId: "test-session",
        actorId: "test",
      },
    );

    expect(result.ok).toBe(true);
    expect((result.data as { matters: string[] }).matters).toEqual([]);
  });

  it("search_matter returns error without matterId", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("search_matter")!;

    const result = await tool.execute(
      { query: "test" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("未指定案件 ID");
  });

  it("analyze_document blocks reads outside workspace", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("analyze_document")!;

    const result = await tool.execute(
      { file_path: "../../../etc/passwd" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("工作区外");
  });

  it("analyze_document reads PDF text in workspace", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("analyze_document")!;
    const pdfPath = path.join(ws, "sample.pdf");
    createSimplePdfWithText(pdfPath, "LawMind PDF Evidence");

    const result = await tool.execute(
      { file_path: "sample.pdf" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toContain("LawMind PDF Evidence");
  });

  it("analyze_document reads DOCX text in workspace", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("analyze_document")!;
    const docxPath = path.join(ws, "sample.docx");
    await createSimpleDocxWithText(docxPath, "LawMind DOCX Evidence");

    const result = await tool.execute(
      { file_path: "sample.docx" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toContain("LawMind DOCX Evidence");
  });

  it("analyze_document reads XLSX text in workspace", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("analyze_document")!;
    const xlsxPath = path.join(ws, "sample.xlsx");
    await createSimpleXlsxWithCell(xlsxPath, "LawMind XLSX Cell");

    const result = await tool.execute(
      { file_path: "sample.xlsx" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(true);
    expect((result.data as { sourceType?: string }).sourceType).toBe("xlsx");
    expect((result.data as { content: string }).content).toContain("LawMind XLSX Cell");
  });

  it("analyze_document rejects legacy .doc with clear message", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("analyze_document")!;
    fs.writeFileSync(path.join(ws, "legacy.doc"), "placeholder", "utf8");

    const result = await tool.execute(
      { file_path: "legacy.doc" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("另存为");
  });

  it("read_project_file reads XLSX under projectDir", async () => {
    const ws = tmpDir();
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-proj-xlsx-"));
    const xlsxPath = path.join(proj, "book.xlsx");
    await createSimpleXlsxWithCell(xlsxPath, "Project XLSX Summary");
    const registry = createLegalToolRegistry();
    const tool = registry.get("read_project_file")!;
    const result = await tool.execute(
      { relative_path: "book.xlsx" },
      { workspaceDir: ws, sessionId: "s", actorId: "a", projectDir: proj },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { sourceType?: string }).sourceType).toBe("xlsx");
    expect((result.data as { content: string }).content).toContain("Project XLSX Summary");
  });

  it("read_project_file requires projectDir", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("read_project_file")!;
    const result = await tool.execute(
      { relative_path: "a.md" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/项目目录/);
  });

  it("read_project_file reads under projectDir", async () => {
    const ws = tmpDir();
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-proj-"));
    fs.writeFileSync(path.join(proj, "note.txt"), "hello project", "utf8");
    const registry = createLegalToolRegistry();
    const tool = registry.get("read_project_file")!;
    const result = await tool.execute(
      { relative_path: "note.txt" },
      { workspaceDir: ws, sessionId: "s", actorId: "a", projectDir: proj },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toContain("hello project");
  });

  it("read_project_file reads PDF under projectDir", async () => {
    const ws = tmpDir();
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-proj-"));
    const pdfPath = path.join(proj, "project-note.pdf");
    createSimplePdfWithText(pdfPath, "Project PDF Summary");
    const registry = createLegalToolRegistry();
    const tool = registry.get("read_project_file")!;
    const result = await tool.execute(
      { relative_path: "project-note.pdf" },
      { workspaceDir: ws, sessionId: "s", actorId: "a", projectDir: proj },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toContain("Project PDF Summary");
  });

  it("read_project_file reads DOCX under projectDir", async () => {
    const ws = tmpDir();
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-proj-"));
    const docxPath = path.join(proj, "project-note.docx");
    await createSimpleDocxWithText(docxPath, "Project DOCX Summary");
    const registry = createLegalToolRegistry();
    const tool = registry.get("read_project_file")!;
    const result = await tool.execute(
      { relative_path: "project-note.docx" },
      { workspaceDir: ws, sessionId: "s", actorId: "a", projectDir: proj },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toContain("Project DOCX Summary");
  });
});

describe("Session Management", () => {
  it("creates and loads a session", () => {
    const ws = tmpDir();
    const session = createSession({ workspaceDir: ws, matterId: "m-001", actorId: "lawyer" });

    expect(session.sessionId).toBeTruthy();
    expect(session.matterId).toBe("m-001");
    expect(session.title).toBe("New Chat");

    const loaded = loadSession(ws, session.sessionId);
    expect(loaded).toBeDefined();
    expect(loaded!.sessionId).toBe(session.sessionId);
  });

  it("lists sessions sorted by updatedAt", () => {
    const ws = tmpDir();
    const s1 = createSession({ workspaceDir: ws, actorId: "a" });
    const s2 = createSession({ workspaceDir: ws, actorId: "a" });

    // Write files directly with distinct timestamps to avoid saveSession overwriting
    const sessDir = path.join(ws, "sessions");
    s1.updatedAt = "2026-01-01T00:00:00.000Z";
    s2.updatedAt = "2026-01-02T00:00:00.000Z";
    fs.writeFileSync(path.join(sessDir, `${s1.sessionId}.json`), JSON.stringify(s1), "utf8");
    fs.writeFileSync(path.join(sessDir, `${s2.sessionId}.json`), JSON.stringify(s2), "utf8");

    const sessions = listSessions(ws);
    expect(sessions.length).toBe(2);
    expect(sessions[0].sessionId).toBe(s2.sessionId);
    expect(sessions[1].sessionId).toBe(s1.sessionId);
  });

  it("appends and loads turns", () => {
    const ws = tmpDir();
    const session = createSession({ workspaceDir: ws, actorId: "a" });

    const turn: AgentTurn = {
      turnId: "t-1",
      sessionId: session.sessionId,
      instruction: "test",
      messages: [],
      toolCallsExecuted: 0,
      status: "completed",
      result: "done",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    appendTurn(ws, turn);
    appendTurn(ws, { ...turn, turnId: "t-2" });

    const turns = loadTurns(ws, session.sessionId);
    expect(turns.length).toBe(2);
    expect(turns[0].turnId).toBe("t-1");
  });
});

describe("compactHistory", () => {
  it("keeps all messages when under limit", () => {
    const msgs: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: "" },
      { role: "user", content: "hi", timestamp: "" },
      { role: "assistant", content: "hello", timestamp: "" },
    ];
    expect(compactHistory(msgs, 10)).toHaveLength(3);
  });

  it("trims old non-system messages when over limit", () => {
    const msgs: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: "" },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
        timestamp: "",
      })),
    ];
    const compact = compactHistory(msgs, 5);
    expect(compact.length).toBe(5);
    expect(compact[0].role).toBe("system");
    expect(compact[1].content).toBe("msg-6");
  });
});

describe("System Prompt", () => {
  it("builds prompt with tools and context", () => {
    const prompt = buildSystemPrompt({
      lawyerName: "张律师",
      lawyerProfile: "专注于公司法和合同纠纷",
      availableTools: [
        {
          name: "search_matter",
          description: "搜索案件",
          category: "search",
          parameters: { query: { type: "string", description: "关键词", required: true } },
        },
      ],
    });

    expect(prompt).toContain("LawMind");
    expect(prompt).toContain("张律师");
    expect(prompt).toContain("search_matter");
    expect(prompt).toContain("准确性第一");
    expect(prompt).toContain("安全边界");
  });

  it("includes matter context when provided", () => {
    const prompt = buildSystemPrompt({
      matterContext: "合同纠纷案件",
      matterId: "m-001",
      availableTools: [],
    });

    expect(prompt).toContain("m-001");
    expect(prompt).toContain("合同纠纷案件");
  });

  it("includes role section when roleDirective is set", () => {
    const prompt = buildSystemPrompt({
      availableTools: [],
      roleTitle: "合同审查",
      roleIntroduction: "侧重交易文件",
      roleDirective: "输出区分必须修改与建议优化。",
    });

    expect(prompt).toContain("当前岗位与职责");
    expect(prompt).toContain("合同审查");
    expect(prompt).toContain("侧重交易文件");
    expect(prompt).toContain("必须修改与建议优化");
  });

  it("mentions web_search when allowWebSearch is true", () => {
    const prompt = buildSystemPrompt({
      availableTools: [],
      allowWebSearch: true,
    });
    expect(prompt).toContain("联网检索");
    expect(prompt).toContain("web_search");
  });

  it("includes workspace mandatory rules when agentMandatoryRules is set", () => {
    const prompt = buildSystemPrompt({
      availableTools: [],
      agentMandatoryRules: "不得向客户承诺胜诉。",
    });
    expect(prompt).toContain("工作区强制规则");
    expect(prompt).toContain("不得向客户承诺胜诉");
  });

  it("includes assistant profile and project dir when set", () => {
    const prompt = buildSystemPrompt({
      availableTools: [],
      assistantProfileMarkdown: "岗位偏好：使用表格列风险。",
      projectDirectoryHint: "/tmp/client-matter",
    });
    expect(prompt).toContain("本助手专属偏好");
    expect(prompt).toContain("岗位偏好：使用表格列风险");
    expect(prompt).toContain("当前项目目录");
    expect(prompt).toContain("/tmp/client-matter");
    expect(prompt).toContain("read_project_file");
  });

  it("includes team meeting mode section when teamMeetingMode is true", () => {
    const prompt = buildSystemPrompt({
      availableTools: [],
      teamMeetingMode: true,
    });
    expect(prompt).toContain("团队会议室模式");
    expect(prompt).toContain("delegate_task");
  });

  it("includes linked draft task id when linkedTaskId is set", () => {
    const prompt = buildSystemPrompt({
      availableTools: [],
      linkedTaskId: "task-draft-abc",
    });
    expect(prompt).toContain("工作台关联草稿");
    expect(prompt).toContain("task-draft-abc");
    expect(prompt).toContain("execute_workflow");
  });

  it("requires clear draft vs post-review delivery wording in system prompt", () => {
    const prompt = buildSystemPrompt({ availableTools: [] });
    expect(prompt).toContain("律师审核与交付闭环（对用户可见话术强制）");
    expect(prompt).toContain("禁止的表述");
    expect(prompt).toContain("EMS");
  });

  it("exports a stable lawmind behavior epoch for health and support", () => {
    expect(LAWMIND_AGENT_BEHAVIOR_EPOCH).toMatch(/^\d{4}-\d{2}-/);
  });

  it("includes runtime model identity for honest model disclosure", () => {
    const prompt = buildSystemPrompt({
      availableTools: [],
      runtimeModel: {
        catalogLabel: "通义千问 Max",
        providerLabel: "阿里云 DashScope / 通义",
        upstreamModel: "qwen-max",
        catalogId: "builtin:qwen-max",
      },
    });
    expect(prompt).toContain("当前推理模型");
    expect(prompt).toContain("通义千问 Max");
    expect(prompt).toContain("`qwen-max`");
    expect(prompt).toContain("不得");
    expect(prompt).toContain("API Key");
  });
});
