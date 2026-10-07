import path from "node:path";
import { describe, expect, it } from "vitest";
import { wpsDeliverableHref } from "../sources/lawyer-chat-link.js";
import { appendDeliverableFileLinks, collectDeliverablePaths } from "./deliverable-chat-links.js";
import type { AgentMessage } from "./types.js";

const workspaceDir = "/tmp/lawmind-deliverable-links";

function toolReply(
  responses: NonNullable<AgentMessage["toolCallResponses"]>,
  extra: AgentMessage[] = [],
): AgentMessage[] {
  return [
    ...extra,
    {
      role: "tool",
      content: "",
      timestamp: "t",
      toolCallResponses: responses,
    },
  ];
}

describe("deliverable chat links", () => {
  it("lists office files written this turn and skips reads, notes, and failed exports", () => {
    const docx = path.join(workspaceDir, "cases/m/函.docx");
    const messages = toolReply(
      [
        {
          toolCallId: "1",
          name: "render_document",
          result: { ok: true, data: { outputPath: docx } },
        },
        {
          toolCallId: "2",
          name: "write_document",
          result: { ok: true, data: { filePath: "notes/纪要.md" } },
        },
        {
          toolCallId: "3",
          name: "render_tracked_draft",
          result: { ok: false, data: { outputRelativePath: "cases/m/坏稿.docx" } },
        },
        {
          toolCallId: "4",
          name: "search_workspace",
          result: { ok: true, data: { path: "cases/m/别人的.docx" } },
        },
        {
          toolCallId: "5",
          name: "write_spreadsheet",
          result: { ok: true, data: { path: "cases/m/费用.xlsx" } },
        },
        {
          toolCallId: "6",
          name: "apply_file_ops",
          result: {
            ok: true,
            data: { applied: ["cases/m/原.pdf → cases/m/证据/原.pdf"] },
          },
        },
        {
          toolCallId: "7",
          name: "run_compute",
          result: {
            ok: true,
            data: {
              tables: [{ path: "artifacts/out.xlsx" }],
              charts: [{ path: "artifacts/charts/ab.json" }],
            },
          },
        },
      ],
      [
        {
          role: "assistant",
          content: "",
          timestamp: "t",
          toolCalls: [
            {
              id: "8",
              name: "run_host_command",
              arguments: {
                command: "officecli",
                args: ["edit", "cases/m/合同.docx", "--note", "只读"],
              },
            },
          ],
        },
      ],
    );
    messages.push({
      role: "tool",
      content: "",
      timestamp: "t",
      toolCallResponses: [
        {
          toolCallId: "8",
          name: "run_host_command",
          result: { ok: true, data: { stdout: "ok" } },
        },
      ],
    });

    expect(collectDeliverablePaths(messages, workspaceDir)).toEqual([
      "cases/m/函.docx",
      "cases/m/费用.xlsx",
      "cases/m/证据/原.pdf",
      "artifacts/out.xlsx",
      "cases/m/合同.docx",
    ]);
  });

  it("appends a WPS link once, using the file name as the label", () => {
    const messages = toolReply([
      {
        toolCallId: "1",
        name: "render_tracked_draft",
        result: { ok: true, data: { outputRelativePath: "cases/m/派遣 协议.docx" } },
      },
    ]);
    const first = appendDeliverableFileLinks("稿已写好。", messages, workspaceDir);
    const href = wpsDeliverableHref("cases/m/派遣 协议.docx");
    expect(first).toBe(`稿已写好。\n\n交付文件\n- [派遣 协议.docx](${href})`);
    expect(appendDeliverableFileLinks(first, messages, workspaceDir)).toBe(first);
    expect(appendDeliverableFileLinks("没有文件。", [], workspaceDir)).toBe("没有文件。");
  });

  it("relativizes Word paths under projectDir and skips notes", () => {
    const projectDir = "/tmp/lawmind-case-yx";
    const docx = path.join(
      projectDir,
      "非技术相关/采购合同模板/外协外包类合同/小型施工合同_01.docx",
    );
    const messages = toolReply([
      {
        toolCallId: "1",
        name: "render_tracked_draft",
        result: {
          ok: true,
          data: { outputPath: docx, outputRelativePath: docx },
        },
      },
      {
        toolCallId: "2",
        name: "write_document",
        result: { ok: true, data: { filePath: "notes/合同群办理总表.md" } },
      },
    ]);
    expect(collectDeliverablePaths(messages, { workspaceDir, projectDir })).toEqual([
      "非技术相关/采购合同模板/外协外包类合同/小型施工合同_01.docx",
    ]);
    const linked = appendDeliverableFileLinks("已改完。", messages, { workspaceDir, projectDir });
    const href = wpsDeliverableHref("非技术相关/采购合同模板/外协外包类合同/小型施工合同_01.docx");
    expect(linked).toContain(`[小型施工合同_01.docx](${href})`);
    expect(linked).not.toContain("notes/");
  });
});
