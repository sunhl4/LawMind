import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentConfig } from "./lawmind-server-helpers.js";
import { bootstrapLawMindDesktopEnv } from "./lawmind-desktop-env-bootstrap.js";

describe("bootstrapLawMindDesktopEnv", () => {
  const envKeys = [
    "LAWMIND_AGENT_API_KEY",
    "LAWMIND_QWEN_API_KEY",
    "LAWMIND_AGENT_MODEL",
    "LAWMIND_QWEN_MODEL",
    "LAWMIND_AGENT_BASE_URL",
    "LAWMIND_QWEN_BASE_URL",
  ] as const;

  function clearModelEnv() {
    for (const k of envKeys) {
      delete process.env[k];
    }
  }

  afterEach(() => {
    clearModelEnv();
  });

  it("prefers user env over repo env for the same key", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-env-boot-"));
    const repoRoot = path.join(root, "repo");
    const lawMindRoot = path.join(root, "userData", "LawMind");
    const workspaceDir = path.join(lawMindRoot, "workspace");
    const userEnvPath = path.join(lawMindRoot, ".env.lawmind");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, ".env.lawmind"),
      "LAWMIND_AGENT_API_KEY=repo-key\nLAWMIND_AGENT_MODEL=repo-model\n",
      "utf8",
    );
    fs.writeFileSync(
      userEnvPath,
      "LAWMIND_AGENT_API_KEY=user-key\nLAWMIND_AGENT_MODEL=user-model\n",
      "utf8",
    );

    clearModelEnv();
    const boot = bootstrapLawMindDesktopEnv({
      workspaceDir,
      envFile: userEnvPath,
      repoRoot,
    });
    expect(boot.userEnvLoaded).toBe(true);
    expect(boot.repoEnvLoaded).toBe(true);
    expect(process.env.LAWMIND_AGENT_API_KEY).toBe("user-key");
    expect(process.env.LAWMIND_AGENT_MODEL).toBe("user-model");

    const built = buildAgentConfig(workspaceDir, { modelId: "builtin:qwen-max" });
    expect(built.error).toBeUndefined();
    expect(built.config.model.apiKey).toBe("user-key");
    expect(built.config.model.model).toBe("qwen-max");
  });

  it("falls back to repo env when user file is missing (dev checkout)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-env-boot-"));
    const repoRoot = path.join(root, "repo");
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, ".env.lawmind"),
      "LAWMIND_QWEN_API_KEY=repo-qwen-key\nLAWMIND_QWEN_MODEL=qwen-plus\n",
      "utf8",
    );

    clearModelEnv();
    const boot = bootstrapLawMindDesktopEnv({ workspaceDir, repoRoot });
    expect(boot.userEnvLoaded).toBe(false);
    expect(boot.repoEnvLoaded).toBe(true);
    expect(buildAgentConfig(workspaceDir).config.model.apiKey).toBe("repo-qwen-key");
  });

  it("packaged-like: no user env and no repo env yields missing key", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-env-boot-"));
    clearModelEnv();
    bootstrapLawMindDesktopEnv({ workspaceDir });
    const err = buildAgentConfig(workspaceDir).error;
    expect(err === "missing_api_key" || err === "missing_provider_api_key").toBe(true);
  });
});
