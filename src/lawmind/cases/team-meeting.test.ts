import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADHOC_MEETING_MATTER_ID,
  appendTeamMeetingLinesSync,
  createTeamMeetingUserLine,
  formatTeamMeetingTranscriptPrefix,
  migrateLegacyAdhocTeamMeetingIfNeeded,
  readTeamMeetingTail,
  readTeamMeetingWindow,
  teamMeetingFilePath,
  TEAM_MEETING_TRANSCRIPT_MAX_CHARS,
} from "./team-meeting.js";

describe("team-meeting", () => {
  it("append and read tail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lm-tm-"));
    const matterId = "m1";
    const caseDir = path.join(dir, "cases", matterId);
    mkdirSync(caseDir, { recursive: true });

    const u1 = createTeamMeetingUserLine("hello");
    const u2 = createTeamMeetingUserLine("world");
    appendTeamMeetingLinesSync(dir, matterId, [u1]);
    appendTeamMeetingLinesSync(dir, matterId, [u2]);

    const tail = readTeamMeetingTail(dir, matterId, 10);
    expect(tail).toHaveLength(2);
    expect(tail[0].text).toBe("hello");
    expect(tail[1].text).toBe("world");

    const p = teamMeetingFilePath(dir, matterId);
    expect(readFileSync(p, "utf8").split("\n").filter(Boolean).length).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it("readTeamMeetingWindow paginates from the tail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lm-tm-win-"));
    const matterId = "m2";
    mkdirSync(path.join(dir, "cases", matterId), { recursive: true });
    for (let i = 0; i < 5; i++) {
      appendTeamMeetingLinesSync(dir, matterId, [createTeamMeetingUserLine(`line-${i}`)]);
    }
    const w0 = readTeamMeetingWindow(dir, matterId, 2, 0);
    expect(w0.total).toBe(5);
    expect(w0.lines.map((r) => r.text)).toEqual(["line-3", "line-4"]);
    const w1 = readTeamMeetingWindow(dir, matterId, 2, 2);
    expect(w1.total).toBe(5);
    expect(w1.lines.map((r) => r.text)).toEqual(["line-1", "line-2"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("formatTeamMeetingTranscriptPrefix includes recent user lines within budget", () => {
    const lines = [createTeamMeetingUserLine("short"), createTeamMeetingUserLine("second")];
    const prefix = formatTeamMeetingTranscriptPrefix(lines);
    expect(prefix.length).toBeLessThanOrEqual(TEAM_MEETING_TRANSCRIPT_MAX_CHARS + 500);
    expect(prefix).toContain("用户");
    expect(prefix).toContain("second");
  });

  it("stores adhoc meetings under meetings/adhoc and migrates legacy cases path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lm-tm-adhoc-"));
    const legacyDir = path.join(dir, "cases", ADHOC_MEETING_MATTER_ID);
    mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, "team-meeting.jsonl");
    const legacyLine = createTeamMeetingUserLine("legacy-adhoc");
    appendFileSync(legacyFile, `${JSON.stringify(legacyLine)}\n`, "utf8");

    migrateLegacyAdhocTeamMeetingIfNeeded(dir);
    const next = teamMeetingFilePath(dir, ADHOC_MEETING_MATTER_ID);
    expect(next).toContain(`${path.sep}meetings${path.sep}adhoc${path.sep}`);
    expect(readFileSync(next, "utf8")).toContain("legacy-adhoc");

    appendTeamMeetingLinesSync(dir, ADHOC_MEETING_MATTER_ID, [
      createTeamMeetingUserLine("new-adhoc"),
    ]);
    const tail = readTeamMeetingTail(dir, ADHOC_MEETING_MATTER_ID, 10);
    expect(tail.map((r) => r.text)).toEqual(["legacy-adhoc", "new-adhoc"]);

    rmSync(dir, { recursive: true, force: true });
  });
});
