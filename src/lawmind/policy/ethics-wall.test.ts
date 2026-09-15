import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ethicsWallBlocksOutbound,
  isEthicsWallEnabled,
  recordEthicsWallScan,
} from "./ethics-wall.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(policy: Record<string, unknown>): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ethics-"));
  dirs.push(ws);
  fs.writeFileSync(
    path.join(ws, "lawmind.policy.json"),
    JSON.stringify({ schemaVersion: 1, ...policy }),
    "utf8",
  );
  return ws;
}

describe("ethics-wall", () => {
  it("is off for Solo unless policy forces it", () => {
    const ws = tmpWs({ edition: "solo" });
    expect(isEthicsWallEnabled(ws)).toBe(false);
    expect(ethicsWallBlocksOutbound(ws, "m1").blocked).toBe(false);
  });

  it("holds outbound on Firm until the lawyer acknowledges", () => {
    const ws = tmpWs({ edition: "firm" });
    expect(isEthicsWallEnabled(ws)).toBe(true);
    const held = recordEthicsWallScan({
      workspaceDir: ws,
      matterId: "matter_a",
      parties: ["张三公司"],
      flags: ["「张三公司」在多个来源中出现"],
    });
    expect(held?.status).toBe("hold");
    expect(ethicsWallBlocksOutbound(ws, "matter_a").blocked).toBe(true);
    const disclosed = recordEthicsWallScan({
      workspaceDir: ws,
      matterId: "matter_a",
      parties: ["张三公司"],
      flags: ["「张三公司」在多个来源中出现"],
      acknowledge: true,
      actorId: "lawyer",
    });
    expect(disclosed?.status).toBe("disclosed");
    expect(ethicsWallBlocksOutbound(ws, "matter_a").blocked).toBe(false);
  });

  it("clears when a Firm scan finds no flags", () => {
    const ws = tmpWs({ edition: "firm" });
    const state = recordEthicsWallScan({
      workspaceDir: ws,
      matterId: "matter_b",
      parties: ["独有客户"],
      flags: [],
    });
    expect(state?.status).toBe("clear");
    expect(ethicsWallBlocksOutbound(ws, "matter_b").blocked).toBe(false);
  });
});
