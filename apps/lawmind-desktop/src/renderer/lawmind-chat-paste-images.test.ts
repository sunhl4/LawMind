/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { pinPastedChatImages } from "./lawmind-chat-paste-images";

describe("pinPastedChatImages", () => {
  it("imports clipboard image bytes via bridge and pins", async () => {
    const importPastedBytes = vi.fn(async () => ({
      ok: true as const,
      root: "workspace" as const,
      relPath: "cases/m1/materials/paste.png",
      kind: "file" as const,
      imported: true,
    }));
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    const dt = {
      files: [file],
    } as unknown as DataTransfer;
    const onAdd = vi.fn();
    const pins = await pinPastedChatImages({
      clipboardData: dt,
      matterId: "m1",
      bridge: { importPastedBytes },
      onAdd,
    });
    expect(importPastedBytes).toHaveBeenCalled();
    expect(pins).toEqual([
      { root: "workspace", relPath: "cases/m1/materials/paste.png", kind: "file" },
    ]);
    expect(onAdd).toHaveBeenCalledWith(pins[0]);
  });

  it("ignores non-image clipboard files", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const dt = { files: [file] } as unknown as DataTransfer;
    const pins = await pinPastedChatImages({
      clipboardData: dt,
      bridge: { importPastedBytes: vi.fn() },
      onAdd: vi.fn(),
    });
    expect(pins).toEqual([]);
  });
});
