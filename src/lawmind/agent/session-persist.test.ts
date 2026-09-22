import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSessionEvent } from "./session-event-log.js";
import { isSessionPersistError, persistOrThrow, SessionPersistError } from "./session-persist.js";
import { createSession, saveSession } from "./session.js";

describe("session persist fail-closed", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("persistOrThrow wraps the cause", () => {
    expect(() =>
      persistOrThrow("events", () => {
        throw new Error("disk full");
      }),
    ).toThrow(SessionPersistError);
    try {
      persistOrThrow("events", () => {
        throw new Error("disk full");
      });
    } catch (err) {
      expect(isSessionPersistError(err)).toBe(true);
      expect((err as SessionPersistError).op).toBe("events");
      expect((err as SessionPersistError).message).toContain("events");
    }
  });

  it("appendSessionEvent throws when sessions is not a directory", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-persist-ev-"));
    dirs.push(ws);
    fs.writeFileSync(path.join(ws, "sessions"), "blocked");
    expect(() => appendSessionEvent(ws, "sid", { type: "turn_begin" })).toThrow(
      SessionPersistError,
    );
  });

  it("saveSession throws when the session file cannot be replaced", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-persist-sv-"));
    dirs.push(ws);
    const session = createSession({ workspaceDir: ws, actorId: "a" });
    const file = path.join(ws, "sessions", `${session.sessionId}.json`);
    fs.rmSync(file);
    fs.mkdirSync(file);
    expect(() => saveSession(ws, session)).toThrow(SessionPersistError);
  });
});
