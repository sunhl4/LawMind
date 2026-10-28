/**
 * P2.1 录音转写路由：律师点「转写」，结果按原因返回；不出站时明确说明为什么。
 *
 * 真实端点行为（fetch 到 127.0.0.1 cassette）由 `intake/recording.test.ts` 覆盖；
 * 这里只锁路由的状态码与透传。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMailRoutes } from "./lawmind-server-route-mail.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import { putIntakeBlob, recordIntakeItem } from "../../../src/lawmind/intake/store.js";

describe("lawmind-server-route-mail transcribe route", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  function workspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-transcribe-route-"));
    dirs.push(dir);
    return dir;
  }

  function response() {
    let status = 0;
    let body = "";
    const res = {
      writeHead(next: number) {
        status = next;
      },
      end(value?: string | Buffer) {
        body += value?.toString() ?? "";
      },
    } as unknown as http.ServerResponse;
    return {
      res,
      get status() {
        return status;
      },
      json: () => JSON.parse(body) as Record<string, unknown>,
    };
  }

  function request(method: string, value?: unknown): http.IncomingMessage {
    const req = { method, headers: {} } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "data" && value !== undefined) {
          cb(Buffer.from(JSON.stringify(value)));
        }
        if (event === "end") {
          cb();
        }
        return this;
      },
    });
    return req;
  }

  function context(workspaceDir: string): LawmindDispatchContext {
    return {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
  }

  async function post(dir: string, itemId: string, suffix = "") {
    const out = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", { itemId }),
      res: out.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${itemId}/transcribe${suffix}`),
      pathname: `/api/intake/items/${itemId}/transcribe`,
      c: {},
    });
    return out;
  }

  it("returns 409 with a clear reason when ASR is not configured", async () => {
    const dir = workspace();
    vi.stubEnv("LAWMIND_ASR_ENDPOINT", "");
    const sha = putIntakeBlob(dir, Buffer.from("audio"));
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:route",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "",
      attachments: [{ name: "通话录音.mp3", sha256: sha, size: 5 }],
    }).item;
    const out = await post(dir, item.id);
    expect(out.status).toBe(409);
    expect(out.json()).toMatchObject({ ok: false, reason: "no_config" });
    expect(out.json().error).toBeUndefined();
  });

  it("reports 404 for a missing item and 400 for an item that already has text", async () => {
    const dir = workspace();
    vi.stubEnv("LAWMIND_ASR_ENDPOINT", "");
    expect((await post(dir, "it-nonexistent")).status).toBe(404);

    const sha = putIntakeBlob(dir, Buffer.from("doc"));
    const pdf = recordIntakeItem(dir, {
      channel: "dropzone",
      externalKey: "dropzone:route-pdf",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "合同.pdf",
      text: "合同文本",
      attachments: [{ name: "合同.pdf", sha256: sha, size: 4 }],
    }).item;
    const out = await post(dir, pdf.id);
    expect(out.status).toBe(400);
    expect(out.json()).toMatchObject({ ok: false, reason: "has_text" });
  });

  it("lets force override an existing transcript so the ASR config is checked", async () => {
    const dir = workspace();
    vi.stubEnv("LAWMIND_ASR_ENDPOINT", "");
    const sha = putIntakeBlob(dir, Buffer.from("audio"));
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:force",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "已有文字",
      attachments: [{ name: "通话录音.mp3", sha256: sha, size: 5 }],
    }).item;
    const out = await post(dir, item.id, "?force=1");
    expect(out.status).toBe(409);
    expect(out.json()).toMatchObject({ ok: false, reason: "no_config" });
  });
});
