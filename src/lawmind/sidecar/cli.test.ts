import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAWMIDD_PORT } from "./advertise.js";
import { parseLawminddArgs } from "./cli.js";

describe("parseLawminddArgs", () => {
  it("defaults to ./workspace and 4312", () => {
    const cwd = "/tmp/lawmind-cli";
    const opts = parseLawminddArgs([], cwd, {});
    expect(opts.port).toBe(DEFAULT_LAWMIDD_PORT);
    expect(opts.workspaceDir).toBe(path.resolve(cwd, "workspace"));
    expect(opts.help).toBe(false);
  });

  it("reads flags and env", () => {
    const cwd = "/tmp/lawmind-cli";
    const fromEnv = parseLawminddArgs([], cwd, {
      LAWMIND_WORKSPACE_DIR: "from-env",
      LAWMIND_DESKTOP_PORT: "4400",
    });
    expect(fromEnv.workspaceDir).toBe(path.resolve(cwd, "from-env"));
    expect(fromEnv.port).toBe(4400);
    const fromFlags = parseLawminddArgs(
      ["--workspace", "ws", "--port", "4313", "--env-file", ".env.lawmind", "--help"],
      cwd,
      { LAWMIND_WORKSPACE_DIR: "from-env" },
    );
    expect(fromFlags.workspaceDir).toBe(path.resolve(cwd, "ws"));
    expect(fromFlags.port).toBe(4313);
    expect(fromFlags.help).toBe(true);
    expect(fromFlags.envFile).toBe(path.resolve(cwd, ".env.lawmind"));
  });

  it("rejects a bad port", () => {
    expect(() => parseLawminddArgs(["--port", "0"], "/tmp", {})).toThrow("invalid_port");
  });
});
