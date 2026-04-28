import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAssistantDraft,
  deleteAssistant,
  saveAssistantDraft,
} from "./lawmind-assistant-editor.js";

describe("lawmind-assistant-editor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds edit draft from an existing assistant", () => {
    expect(
      createAssistantDraft("edit", [], {
        assistantId: "assistant-1",
        displayName: "诉讼助理",
        introduction: "负责诉讼文书",
        presetKey: "litigation",
        customRoleTitle: "首席诉讼助理",
        customRoleInstructions: "先列争点再写文书",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }),
    ).toEqual({
      displayName: "诉讼助理",
      introduction: "负责诉讼文书",
      presetKey: "litigation",
      customRoleTitle: "首席诉讼助理",
      customRoleInstructions: "先列争点再写文书",
      orgRole: "",
      reportsToAssistantId: "",
      peerReviewDefaultAssistantId: "",
    });
  });

  it("saves assistant draft to the correct endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, assistant: { assistantId: "assistant-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      saveAssistantDraft({
        apiBase: "http://127.0.0.1:4312",
        editingAssistantId: "assistant-1",
        draft: {
          displayName: "诉讼助理",
          introduction: "负责诉讼文书",
          presetKey: "litigation",
          customRoleTitle: "",
          customRoleInstructions: "",
          orgRole: "",
          reportsToAssistantId: "",
          peerReviewDefaultAssistantId: "",
        },
      }),
    ).resolves.toMatchObject({
      assistant: { assistantId: "assistant-1" },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4312/api/assistants/assistant-1",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });

  it("deletes assistant through the delete endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(deleteAssistant("http://127.0.0.1:4312", "assistant-1")).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4312/api/assistants/assistant-1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
