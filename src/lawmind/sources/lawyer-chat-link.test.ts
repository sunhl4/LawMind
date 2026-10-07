import { describe, expect, it } from "vitest";
import {
  docxCellWithDirectory,
  publicWebUrl,
  statuteJumpUrl,
  tryConsumeBareChatTarget,
  tryConsumeLawyerChatLink,
  wpsDeliverableHref,
  wpsDeliverablePath,
  workspaceChatFile,
} from "./lawyer-chat-link.js";

describe("lawyer chat links", () => {
  it("opens a draft from its title", () => {
    const hit = tryConsumeLawyerChatLink("见 [驾驶员劳务派遣协议](lm-draft:task-1) 的稿。", 2);
    expect(hit?.link).toEqual({
      kind: "draft",
      label: "驾驶员劳务派遣协议",
      taskId: "task-1",
    });
  });

  it("opens a statute when the label names the article", () => {
    const href = "https://flk.npc.gov.cn/detail/labor-63";
    expect(statuteJumpUrl(href, "《劳动合同法》第63条")).toBe(href);
    const hit = tryConsumeLawyerChatLink(`[《劳动合同法》第63条](${href})`, 0);
    expect(hit?.link.kind).toBe("web");
    if (hit?.link.kind === "web") {
      expect(hit.link.url).toBe("https://flk.npc.gov.cn/detail/labor-63");
    }
  });

  it("opens a public web link and a workspace file, including a canvas", () => {
    expect(tryConsumeLawyerChatLink("[裁判文书](https://wenshu.court.gov.cn/a)", 0)?.link).toEqual({
      kind: "web",
      label: "裁判文书",
      url: "https://wenshu.court.gov.cn/a",
    });
    expect(tryConsumeLawyerChatLink("[费用核对](canvas/核对-task.canvas.tsx)", 0)?.link).toEqual({
      kind: "file",
      label: "费用核对",
      path: "canvas/核对-task.canvas.tsx",
      canvas: true,
    });
    expect(tryConsumeLawyerChatLink("[合同](cases/m/派遣协议.docx:12:3)", 0)?.link).toEqual({
      kind: "wps",
      label: "合同",
      path: "cases/m/派遣协议.docx",
    });
    expect(
      tryConsumeLawyerChatLink(
        "[国浩改-26年9月-装饰装修施工合同.docx](非技术相关/采购合同模板/基建工程/国浩改-26年9月-装饰装修施工合同.docx)",
        0,
      )?.link,
    ).toEqual({
      kind: "wps",
      label: "国浩改-26年9月-装饰装修施工合同.docx",
      path: "非技术相关/采购合同模板/基建工程/国浩改-26年9月-装饰装修施工合同.docx",
    });
  });

  it("leaves a private url as text and does not open paths outside the workspace", () => {
    expect(tryConsumeLawyerChatLink("[内网](https://127.0.0.1/a)", 0)?.link).toEqual({
      kind: "plain",
      label: "内网",
    });
    expect(tryConsumeLawyerChatLink("[登录](https://user:pass@example.com/a)", 0)?.link).toEqual({
      kind: "plain",
      label: "登录",
    });
    expect(tryConsumeLawyerChatLink("[脚本](javascript:alert(1))", 0)?.link).toEqual({
      kind: "plain",
      label: "脚本",
    });
    expect(workspaceChatFile("../secret.docx")).toBeNull();
    expect(workspaceChatFile("/etc/passwd.docx")).toBeNull();
    expect(workspaceChatFile("file:///tmp/a.docx")).toBeNull();
    expect(publicWebUrl("http://127.0.0.1/a")).toBeNull();
  });

  it("rejects private hosts even when the label looks like a statute", () => {
    expect(statuteJumpUrl("https://127.0.0.1/a", "《劳动合同法》第63条")).toBeNull();
    expect(statuteJumpUrl("https://user:pass@pkulaw.com/a", "《劳动合同法》第63条")).toBeNull();
    expect(statuteJumpUrl("http://flk.npc.gov.cn/a", "《劳动合同法》第63条")).toBeNull();
  });

  it("allows a legal host even without a book-title label", () => {
    expect(statuteJumpUrl("https://www.pkulaw.com/chl/x", "同工同酬")).toContain("pkulaw.com");
  });

  it("opens a deliverable path in WPS and refuses paths outside the workspace", () => {
    const href = wpsDeliverableHref("cases/m/派遣 协议.docx");
    expect(href).toBe(`lm-wps:${encodeURIComponent("cases/m/派遣 协议.docx")}`);
    expect(tryConsumeLawyerChatLink(`[cases/m/派遣 协议.docx](${href})`, 0)?.link).toEqual({
      kind: "wps",
      label: "cases/m/派遣 协议.docx",
      path: "cases/m/派遣 协议.docx",
    });
    expect(wpsDeliverablePath("../secret.docx")).toBeNull();
    expect(wpsDeliverablePath("/tmp/secret.docx")).toBeNull();
    expect(wpsDeliverablePath("notes/memo.md")).toBeNull();
    expect(tryConsumeLawyerChatLink("[越界](lm-wps:..%2Fsecret.docx)", 0)?.link.kind).toBe("plain");
  });

  it("picks bare urls and files out of a sentence without eating the punctuation", () => {
    const web = tryConsumeBareChatTarget("见https://flk.npc.gov.cn/a。", 1);
    expect(web?.link).toMatchObject({ kind: "web", url: "https://flk.npc.gov.cn/a" });
    expect(web?.next).toBe(1 + "https://flk.npc.gov.cn/a".length);
    const file = tryConsumeBareChatTarget("打开 canvas/核对.canvas.tsx。", 3);
    expect(file?.link).toMatchObject({
      kind: "file",
      path: "canvas/核对.canvas.tsx",
      canvas: true,
    });
    expect(tryConsumeBareChatTarget("见 https://127.0.0.1/secret", 2)).toBeNull();
    expect(tryConsumeBareChatTarget("不要 ../secret.docx", 3)).toBeNull();
  });

  it("joins a table filename with the directory column", () => {
    const cell = docxCellWithDirectory("国浩改-26年9月-装饰装修施工合同.docx", [
      "国浩改-26年9月-装饰装修施工合同.docx",
      "非技术相关/采购合同模板/基建工程类合同/",
    ]);
    expect(cell).toBe(
      "[国浩改-26年9月-装饰装修施工合同.docx](非技术相关/采购合同模板/基建工程类合同/国浩改-26年9月-装饰装修施工合同.docx)",
    );
    expect(
      docxCellWithDirectory("租赁合同（物）FB-QT-017_**20260928_01**.docx", [
        "租赁合同（物）FB-QT-017_**20260928_01**.docx",
        "非技术相关/采购合同模板/租赁合同/",
      ]),
    ).toContain("租赁合同（物）FB-QT-017_20260928_01.docx)");
    expect(
      docxCellWithDirectory("`国浩改-26年9月-小型施工合同.docx`", [
        "`国浩改-26年9月-小型施工合同.docx`",
        "非技术相关/采购合同模板/外协外包类合同/",
      ]),
    ).toBe(
      "[国浩改-26年9月-小型施工合同.docx](非技术相关/采购合同模板/外协外包类合同/国浩改-26年9月-小型施工合同.docx)",
    );
  });
});
