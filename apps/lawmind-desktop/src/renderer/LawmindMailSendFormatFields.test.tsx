/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindMailSendFormatFields } from "./LawmindMailSendFormatFields";
import type { MailSendFormat } from "../../../../src/lawmind/mail/mail-send-format.ts";

describe("LawmindMailSendFormatFields", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("shows preview with closing and 落款", () => {
    const value: MailSendFormat = {
      closingStyle: "business",
      signature: "某某律师事务所\n张三 律师",
    };
    act(() => {
      root.render(<LawmindMailSendFormatFields value={value} onChange={() => undefined} />);
    });
    const preview = host.querySelector('[data-testid="lm-mail-send-preview"]');
    expect(host.querySelector('[data-testid="lm-mail-send-format"]')).toBeTruthy();
    expect(preview?.textContent).toContain("顺颂商祺");
    expect(preview?.textContent).toContain("某某律师事务所");
    expect((host.querySelector('[data-testid="lm-mail-signature"]') as HTMLTextAreaElement).value).toContain(
      "张三 律师",
    );
  });
});
