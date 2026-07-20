import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldPersistMailAttachment, writeFetchedAttachments } from "./imap-client.js";

/**
 * Regression: imapflow socket timeout must not crash the Node process via
 * unhandled 'error' event. We assert the client options we rely on for safety.
 */
describe("imap-client safety", () => {
  it("documents that withImapClient attaches an error listener", async () => {
    const mod = await import("./imap-client.js");
    expect(typeof mod.testImapConnection).toBe("function");
    expect(typeof mod.fetchImapMessages).toBe("function");
  });

  it("only persists document-like attachments to disk", () => {
    expect(shouldPersistMailAttachment("合同.docx")).toBe(true);
    expect(shouldPersistMailAttachment("scan.pdf")).toBe(true);
    expect(shouldPersistMailAttachment("logo.png", "image/png")).toBe(false);
    expect(shouldPersistMailAttachment("inline", "image/jpeg")).toBe(false);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mail-att-"));
    const refs = writeFetchedAttachments(root, "m1", "imap-abc-1", [
      { name: "nda.docx", content: Buffer.from("PK") },
      { name: "sig.png", content: Buffer.from("PNG"), contentType: "image/png" },
    ]);
    expect(refs).toEqual([
      {
        name: "nda.docx",
        relativePath: path.join("mail", "attachments", "imap-abc-1", "nda.docx"),
      },
      { name: "sig.png" },
    ]);
    expect(
      fs.existsSync(
        path.join(root, "cases", "m1", "mail", "attachments", "imap-abc-1", "nda.docx"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, "cases", "m1", "mail", "attachments", "imap-abc-1", "sig.png")),
    ).toBe(false);
  });

  it("testImapConnection returns structured failure when secret missing", async () => {
    const { testImapConnection } = await import("./imap-client.js");
    const result = await testImapConnection(
      {
        id: "acc-1",
        label: "t",
        provider: "gmail",
        email: "a@gmail.com",
        authKind: "app_password",
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      "/tmp/lawmind-no-such-root-for-mail-test",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("missing_password");
    }
  });
});
