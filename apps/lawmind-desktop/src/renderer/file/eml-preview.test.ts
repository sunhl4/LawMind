/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { parseEmlPreview } from "./eml-preview";

describe("parseEmlPreview", () => {
  it("reads headers and plain body", () => {
    const raw =
      "From: a@example.com\r\n" +
      "To: b@example.com\r\n" +
      "Subject: =?UTF-8?B?5rWL6K+V?=\r\n" +
      "Date: Fri, 9 Oct 2026 12:00:00 +0800\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "\r\n" +
      "您好，请查收附件。\r\n";
    const parsed = parseEmlPreview(raw);
    expect(parsed.from).toBe("a@example.com");
    expect(parsed.to).toBe("b@example.com");
    expect(parsed.subject).toBe("测试");
    expect(parsed.bodyText).toContain("请查收附件");
  });

  it("lists multipart attachments", () => {
    const raw =
      "From: a@example.com\r\n" +
      "Subject: 材料\r\n" +
      'Content-Type: multipart/mixed; boundary="b1"\r\n' +
      "\r\n" +
      "--b1\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "\r\n" +
      "正文\r\n" +
      "--b1\r\n" +
      "Content-Type: application/pdf; name=\"判决书.pdf\"\r\n" +
      'Content-Disposition: attachment; filename="判决书.pdf"\r\n' +
      "Content-Transfer-Encoding: base64\r\n" +
      "\r\n" +
      "JVBERg==\r\n" +
      "--b1--\r\n";
    const parsed = parseEmlPreview(raw);
    expect(parsed.bodyText).toContain("正文");
    expect(parsed.attachments).toEqual([
      expect.objectContaining({ fileName: "判决书.pdf", contentType: "application/pdf" }),
    ]);
  });

  it("decodes UTF-8 quoted-printable headers and bodies", () => {
    const raw =
      "From: a@example.com\r\n" +
      "Subject: =?UTF-8?Q?=E6=B5=8B=E8=AF=95?=\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Content-Transfer-Encoding: quoted-printable\r\n" +
      "\r\n" +
      "=E6=B5=8B=E8=AF=95\r\n";
    const parsed = parseEmlPreview(raw);
    expect(parsed.subject).toBe("测试");
    expect(parsed.bodyText).toBe("测试");
  });
});
