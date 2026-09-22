import { describe, expect, it, vi } from "vitest";
import {
  clarifyBringInActive,
  registerClarifyBringInHandlers,
  tryClarifyAttachFile,
  tryClarifyAttachSession,
} from "./lawmind-clarify-bring-in-bus";

describe("lawmind-clarify-bring-in-bus", () => {
  it("routes attach to registered clarify handlers", () => {
    const onAttachFile = vi.fn();
    const onAttachSession = vi.fn();
    registerClarifyBringInHandlers({ onAttachFile, onAttachSession });
    expect(clarifyBringInActive()).toBe(true);
    expect(
      tryClarifyAttachFile({ root: "workspace", relPath: "a.pdf", kind: "file" }),
    ).toBe(true);
    expect(onAttachFile).toHaveBeenCalledWith(
      expect.objectContaining({ relPath: "a.pdf" }),
    );
    expect(
      tryClarifyAttachSession({ sessionId: "s1", title: "审查" }),
    ).toBe(true);
    expect(onAttachSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1" }),
    );
    registerClarifyBringInHandlers(null);
    expect(clarifyBringInActive()).toBe(false);
    expect(tryClarifyAttachFile({ root: "workspace", relPath: "b.pdf", kind: "file" })).toBe(
      false,
    );
  });
});
