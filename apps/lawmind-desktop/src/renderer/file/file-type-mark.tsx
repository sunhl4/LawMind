import type { ReactNode } from "react";

export type FileTypeTone =
  | "pdf"
  | "sheet"
  | "word"
  | "slide"
  | "image"
  | "mail"
  | "archive"
  | "media"
  | "text"
  | "code"
  | "file";

const TONE_BY_EXT: Record<string, FileTypeTone> = {
  pdf: "pdf",
  xlsx: "sheet",
  xls: "sheet",
  csv: "sheet",
  numbers: "sheet",
  docx: "word",
  doc: "word",
  rtf: "word",
  odt: "word",
  pptx: "slide",
  ppt: "slide",
  key: "slide",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  tif: "image",
  tiff: "image",
  bmp: "image",
  heic: "image",
  eml: "mail",
  msg: "mail",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  mp3: "media",
  wav: "media",
  m4a: "media",
  aac: "media",
  ogg: "media",
  flac: "media",
  mp4: "media",
  webm: "media",
  mov: "media",
  m4v: "media",
  md: "text",
  txt: "text",
  log: "text",
  json: "code",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  css: "code",
  html: "code",
  yaml: "code",
  yml: "code",
  xml: "code",
  py: "code",
  sh: "code",
};

/** Keep the extension visible when the tab label ellipsizes. */
export function fileTabLabelParts(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, ext: "" };
  }
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

export function fileTypeTone(name: string): FileTypeTone {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ext || ext === name.toLowerCase()) {
    return "file";
  }
  return TONE_BY_EXT[ext] ?? "file";
}

function DocumentGlyph({ lined }: { lined?: boolean }) {
  return (
    <g>
      <path fill="#fff" d="M4.15 2.35h4.35L12.15 6.1v7.55H4.15V2.35z" />
      <path fill="currentColor" opacity="0.45" d="M8.45 2.45v3.55h3.6z" />
      {lined ? (
        <g stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.8">
          <path d="M5.7 7.35h4.5M5.7 9.05h4.5M5.7 10.75h2.7" />
        </g>
      ) : null}
    </g>
  );
}

function Glyph({ tone }: { tone: FileTypeTone }): ReactNode {
  if (tone === "sheet") {
    return (
      <g fill="none" stroke="#fff" strokeWidth="1.05" strokeLinejoin="round">
        <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.1" />
        <path d="M3.25 6.4h9.5M3.25 9.55h9.5M6.4 3.25v9.5M9.55 3.25v9.5" />
      </g>
    );
  }
  if (tone === "slide") {
    return (
      <g fill="#fff">
        <rect x="2.6" y="3.5" width="10.8" height="7.2" rx="1" />
        <path d="M8 10.7v2.1M5.6 12.8h4.8" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
      </g>
    );
  }
  if (tone === "image") {
    return (
      <g fill="#fff">
        <path d="M3.1 11.7l2.5-2.7 1.55 1.45 1.9-2.15 3.85 3.4H3.1z" />
        <circle cx="6.05" cy="6.05" r="1.15" />
      </g>
    );
  }
  if (tone === "mail") {
    return (
      <g fill="none" stroke="#fff" strokeWidth="1.15" strokeLinejoin="round">
        <rect x="2.4" y="4" width="11.2" height="8" rx="1.1" />
        <path d="M2.8 4.5l5.2 4.1 5.2-4.1" />
      </g>
    );
  }
  if (tone === "archive") {
    return (
      <g fill="none" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round">
        <path d="M3 6.2h10v6.3H3z" />
        <path d="M2.5 3.6h11v2.6h-11z" />
        <path d="M6.6 8.2h2.8" strokeLinecap="round" />
      </g>
    );
  }
  if (tone === "media") {
    return <path fill="#fff" d="M6.2 4.3l5.1 3.7-5.1 3.7V4.3z" />;
  }
  if (tone === "code") {
    return (
      <path
        d="M6.3 5.1L3.7 8l2.6 2.9M9.7 5.1l2.6 2.9-2.6 2.9"
        fill="none"
        stroke="#fff"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  return <DocumentGlyph lined={tone === "word" || tone === "text"} />;
}

export function FileTypeMark({ name }: { name: string }) {
  const tone = fileTypeTone(name);
  return (
    <svg
      className={`lm-file-type-mark is-${tone}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <rect width="16" height="16" rx="4" fill="currentColor" />
      <Glyph tone={tone} />
    </svg>
  );
}
