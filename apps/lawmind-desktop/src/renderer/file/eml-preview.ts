/**
 * Lightweight .eml header/body parse for the middle-column preview.
 * Not a full MIME stack — enough for lawyers to read From/Subject and skim text.
 */

export type EmlAttachmentMeta = {
  fileName: string;
  contentType?: string;
};

export type EmlPreview = {
  from: string;
  to: string;
  subject: string;
  date: string;
  bodyText: string;
  attachments: EmlAttachmentMeta[];
};

function bytesFromBinary(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const name = charset.trim().toLowerCase().replace(/['"]/g, "") || "utf-8";
  const label = name === "gb2312" || name === "gbk" || name === "gb18030" ? "gbk" : name;
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function decodeQuotedPrintable(data: string, charset: string): string {
  const stripped = data.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < stripped.length; i += 1) {
    const hex = stripped.slice(i + 1, i + 3);
    if (stripped[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }
    bytes.push(stripped.charCodeAt(i) & 0xff);
  }
  return decodeBytes(new Uint8Array(bytes), charset);
}

function decodeBase64(data: string, charset: string): string {
  return decodeBytes(bytesFromBinary(atob(data.replace(/\s+/g, ""))), charset);
}

function decodeRfc2047(value: string): string {
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_all, charset: string, enc, data: string) => {
    try {
      if (String(enc).toUpperCase() === "B") {
        return decodeBase64(data, charset);
      }
      return decodeQuotedPrintable(data.replace(/_/g, " "), charset);
    } catch {
      return data;
    }
  });
}

function headerValue(raw: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*([\\s\\S]*?)(?=\\r?\\n\\S|\\r?\\n\\r?\\n|$)`, "im");
  const match = re.exec(raw);
  if (!match?.[1]) {
    return "";
  }
  return decodeRfc2047(match[1].replace(/\r?\n[ \t]+/g, " ").trim());
}

function unfoldParts(raw: string): string[] {
  const boundary = /boundary="?([^=";]+)"?/i.exec(raw)?.[1];
  if (!boundary) {
    return [raw];
  }
  const marker = `--${boundary}`;
  return raw
    .split(marker)
    .map((part) => part.trim())
    .filter((part) => part && part !== "--" && !part.startsWith("--"));
}

function partHeadersAndBody(part: string): { headers: string; body: string } {
  const split = part.search(/\r?\n\r?\n/);
  if (split < 0) {
    return { headers: part, body: "" };
  }
  return { headers: part.slice(0, split), body: part.slice(split).replace(/^\r?\n/, "") };
}

function attachmentMeta(headers: string): EmlAttachmentMeta | null {
  const disposition = headerValue(headers, "Content-Disposition");
  if (!/attachment/i.test(disposition) && !/name=/i.test(disposition)) {
    const type = headerValue(headers, "Content-Type");
    if (!/name=/i.test(type)) {
      return null;
    }
  }
  const fromDisp = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition)?.[1];
  const fromType = /name="?([^";]+)"?/i.exec(headerValue(headers, "Content-Type"))?.[1];
  const fileName = decodeURIComponent((fromDisp || fromType || "附件").trim().replace(/"/g, ""));
  const contentType = headerValue(headers, "Content-Type").split(";")[0]?.trim();
  return { fileName, ...(contentType ? { contentType } : {}) };
}

function charsetOf(headers: string): string {
  return /charset="?([^";\s]+)"?/i.exec(headerValue(headers, "Content-Type"))?.[1] ?? "utf-8";
}

function decodeBody(headers: string, body: string): string {
  const encoding = headerValue(headers, "Content-Transfer-Encoding").toLowerCase();
  const type = headerValue(headers, "Content-Type").toLowerCase();
  const charset = charsetOf(headers);
  let text = body;
  if (encoding.includes("base64")) {
    try {
      text = decodeBase64(body, charset);
    } catch {
      /* keep raw */
    }
  } else if (encoding.includes("quoted-printable")) {
    text = decodeQuotedPrintable(body, charset);
  }
  if (type.includes("text/html")) {
    return text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
  }
  return text.trim();
}

/** Parse a raw .eml string into preview fields. */
export function parseEmlPreview(raw: string): EmlPreview {
  const headSplit = raw.search(/\r?\n\r?\n/);
  const head = headSplit >= 0 ? raw.slice(0, headSplit) : raw;
  const from = headerValue(head, "From");
  const to = headerValue(head, "To");
  const subject = headerValue(head, "Subject");
  const date = headerValue(head, "Date");
  const attachments: EmlAttachmentMeta[] = [];
  let bodyText = "";

  const contentType = headerValue(head, "Content-Type").toLowerCase();
  if (contentType.includes("multipart/")) {
    for (const part of unfoldParts(raw)) {
      const { headers, body } = partHeadersAndBody(part);
      const att = attachmentMeta(headers);
      if (att) {
        attachments.push(att);
        continue;
      }
      const partType = headerValue(headers, "Content-Type").toLowerCase();
      if (partType.includes("text/plain") && !bodyText) {
        bodyText = decodeBody(headers, body);
      } else if (partType.includes("text/html") && !bodyText) {
        bodyText = decodeBody(headers, body);
      }
    }
  } else {
    const body = headSplit >= 0 ? raw.slice(headSplit).replace(/^\r?\n/, "") : "";
    bodyText = decodeBody(head, body);
  }

  return {
    from,
    to,
    subject,
    date,
    bodyText: bodyText.slice(0, 50_000),
    attachments,
  };
}
