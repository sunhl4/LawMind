import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTeamRoster, writeTeamRoster } from "./team-roster.js";

describe("team-roster", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("roundtrips participants and synthesizer", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-roster-"));
    const saved = writeTeamRoster(dir, "matter_1", {
      participantAssistantIds: ["a1", "a2", "a1"],
      synthesizerAssistantId: "a2",
    });
    expect(saved.participantAssistantIds).toEqual(["a1", "a2"]);
    expect(saved.synthesizerAssistantId).toBe("a2");
    const loaded = readTeamRoster(dir, "matter_1");
    expect(loaded).toEqual(saved);
  });

  it("falls synthesizer back into participants", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-roster-"));
    const saved = writeTeamRoster(dir, "m2", {
      participantAssistantIds: ["only"],
      synthesizerAssistantId: "missing",
    });
    expect(saved.synthesizerAssistantId).toBe("only");
  });
});
