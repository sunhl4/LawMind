import { describe, expect, it, vi } from "vitest";
import { encodeLawmindFsDrag, LAWMID_FS_DRAG_MIME } from "./lawmind-file-drag";
import { applyChatFileDrop, pinDroppedChatFiles } from "./lawmind-file-drop-context";

function mockDataTransfer(opts: {
  types: string[];
  data?: Record<string, string>;
  files?: File[];
}): DataTransfer {
  const files = opts.files ?? [];
  return {
    types: opts.types,
    files,
    items: [],
    getData: (mime: string) => opts.data?.[mime] ?? "",
    dropEffect: "none",
  } as unknown as DataTransfer;
}

function fileWithPath(name: string, absPath: string): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "path", { value: absPath });
  return file;
}

describe("applyChatFileDrop", () => {
  it("pins internal file-tree MIME without importing", async () => {
    const payload = { root: "workspace" as const, relPath: "contracts/nda.docx", kind: "file" as const };
    const dt = mockDataTransfer({
      types: [LAWMID_FS_DRAG_MIME],
      data: { [LAWMID_FS_DRAG_MIME]: encodeLawmindFsDrag(payload) },
    });
    const result = await applyChatFileDrop({
      dataTransfer: dt,
      workspaceDir: "/tmp/ws",
      projectDir: null,
    });
    expect(result.pins).toEqual([payload]);
    expect(result.errors).toEqual([]);
  });

  it("maps Finder files that already sit in the workspace", async () => {
    const dt = mockDataTransfer({
      types: ["Files"],
      files: [fileWithPath("nda.docx", "/tmp/ws/contracts/nda.docx")],
    });
    const result = await applyChatFileDrop({
      dataTransfer: dt,
      workspaceDir: "/tmp/ws",
      projectDir: "/tmp/proj",
    });
    expect(result.pins).toEqual([{ root: "workspace", relPath: "contracts/nda.docx", kind: "file" }]);
    expect(result.errors).toEqual([]);
  });

  it("maps files under the project folder", async () => {
    const dt = mockDataTransfer({
      types: ["Files"],
      files: [fileWithPath("memo.md", "/tmp/proj/notes/memo.md")],
    });
    const result = await applyChatFileDrop({
      dataTransfer: dt,
      workspaceDir: "/tmp/ws",
      projectDir: "/tmp/proj",
    });
    expect(result.pins).toEqual([{ root: "project", relPath: "notes/memo.md", kind: "file" }]);
  });

  it("imports files outside workspace via the desktop bridge", async () => {
    const importDroppedFiles = vi.fn(async () => ({
      ok: true,
      items: [
        {
          root: "workspace" as const,
          relPath: "uploads/外发合同.docx",
          kind: "file" as const,
          imported: true,
        },
      ],
      errors: [],
    }));
    const dt = mockDataTransfer({
      types: ["Files"],
      files: [fileWithPath("外发合同.docx", "/Users/me/Downloads/外发合同.docx")],
    });
    const result = await applyChatFileDrop({
      dataTransfer: dt,
      workspaceDir: "/tmp/ws",
      matterId: "临时讨论",
      bridge: { importDroppedFiles },
    });
    expect(importDroppedFiles).toHaveBeenCalledWith({
      absPaths: ["/Users/me/Downloads/外发合同.docx"],
      matterId: "临时讨论",
    });
    expect(result.pins).toEqual([
      { root: "workspace", relPath: "uploads/外发合同.docx", kind: "file" },
    ]);
  });

  it("imports directories outside workspace via the desktop bridge", async () => {
    const importDroppedFiles = vi.fn(async () => ({
      ok: true,
      items: [
        {
          root: "workspace" as const,
          relPath: "uploads/证据包",
          kind: "directory" as const,
          imported: true,
        },
      ],
      errors: [],
    }));
    const dt = mockDataTransfer({
      types: ["Files"],
      files: [fileWithPath("证据包", "/Users/me/Desktop/证据包")],
    });
    const result = await applyChatFileDrop({
      dataTransfer: dt,
      workspaceDir: "/tmp/ws",
      matterId: "临时讨论",
      bridge: { importDroppedFiles },
    });
    expect(importDroppedFiles).toHaveBeenCalledWith({
      absPaths: ["/Users/me/Desktop/证据包"],
      matterId: "临时讨论",
    });
    expect(result.pins).toEqual([{ root: "workspace", relPath: "uploads/证据包", kind: "directory" }]);
  });

  it("explains when OS files have no resolvable path", async () => {
    const dt = mockDataTransfer({
      types: ["Files"],
      files: [new File(["x"], "orphan.docx")],
    });
    const result = await applyChatFileDrop({
      dataTransfer: dt,
      workspaceDir: "/tmp/ws",
    });
    expect(result.pins).toEqual([]);
    expect(result.errors[0]).toMatch(/未能识别文件路径/);
  });
});

describe("pinDroppedChatFiles", () => {
  it("adds pins and reports import errors", async () => {
    const onAdd = vi.fn();
    const onError = vi.fn();
    const dt = mockDataTransfer({
      types: [LAWMID_FS_DRAG_MIME],
      data: {
        [LAWMID_FS_DRAG_MIME]: encodeLawmindFsDrag({
          root: "workspace",
          relPath: "a.md",
          kind: "file",
        }),
      },
    });
    await pinDroppedChatFiles({
      dataTransfer: dt,
      onAdd,
      onError,
    });
    expect(onAdd).toHaveBeenCalledWith({ root: "workspace", relPath: "a.md", kind: "file" });
    expect(onError).toHaveBeenCalledWith(null);
  });
});
