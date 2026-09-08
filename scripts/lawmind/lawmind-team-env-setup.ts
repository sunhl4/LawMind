import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type CliOptions = {
  yes: boolean;
  desktop: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { yes: false, desktop: false };
  for (const arg of argv) {
    if (arg === "--yes" || arg === "-y") {
      opts.yes = true;
    } else if (arg === "--desktop") {
      opts.desktop = true;
    }
  }
  return opts;
}

function parseEnvLines(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map.set(key, value);
  }
  return map;
}

function renderEnvFile(baseContent: string, secrets: Map<string, string>): string {
  const lines = baseContent.split("\n");
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    seen.add(key);
    if (secrets.has(key)) {
      out.push(`${key}=${secrets.get(key) ?? ""}`);
    } else {
      out.push(line);
    }
  }

  const extra: string[] = [];
  for (const [key, value] of secrets) {
    if (!seen.has(key)) {
      extra.push(`${key}=${value}`);
    }
  }
  if (extra.length > 0) {
    out.push("", "# --- merged from .env.lawmind.team.secrets ---", ...extra);
  }

  return out.join("\n").replace(/\n?$/, "\n");
}

function resolveDesktopEnvPath(): string | null {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Electron", "LawMind", ".env.lawmind");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (!appData) {
      return null;
    }
    return path.join(appData, "LawMind", ".env.lawmind");
  }
  const xdg = process.env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
  return path.join(xdg, "LawMind", ".env.lawmind");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function confirmOverwrite(targetPath: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }
  process.stdout.write(`File exists: ${targetPath}\nOverwrite? (y/N): `);
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk) => {
      const answer = String(chunk).trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
}

async function writeEnvFile(targetPath: string, content: string, yes: boolean): Promise<void> {
  if ((await fileExists(targetPath)) && !yes) {
    const ok = await confirmOverwrite(targetPath);
    if (!ok) {
      console.log(`[LawMind] Skipped: ${targetPath}`);
      return;
    }
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  console.log(`[LawMind] Wrote ${targetPath}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const teamExample = path.resolve(cwd, ".env.lawmind.team.example");
  const teamSecrets = path.resolve(cwd, ".env.lawmind.team.secrets");
  const repoTarget = path.resolve(cwd, ".env.lawmind");

  if (!(await fileExists(teamExample))) {
    console.error("[LawMind] Missing .env.lawmind.team.example in repo root.");
    process.exitCode = 1;
    return;
  }

  const baseContent = await fs.readFile(teamExample, "utf8");
  let secrets = new Map<string, string>();

  if (await fileExists(teamSecrets)) {
    const secretsContent = await fs.readFile(teamSecrets, "utf8");
    secrets = parseEnvLines(secretsContent);
    console.log(`[LawMind] Loaded secrets from ${teamSecrets}`);
  } else {
    console.warn(
      "[LawMind] No .env.lawmind.team.secrets found. Copy .env.lawmind.team.secrets.example, fill keys, then re-run.",
    );
  }

  const merged = renderEnvFile(baseContent, secrets);
  await writeEnvFile(repoTarget, merged, opts.yes);

  if (opts.desktop) {
    const desktopPath = resolveDesktopEnvPath();
    if (!desktopPath) {
      console.warn("[LawMind] Could not resolve desktop userData path for this platform.");
    } else {
      await writeEnvFile(desktopPath, merged, opts.yes);
    }
  }

  console.log("\nNext steps:");
  console.log("  pnpm lawmind:env:check");
  console.log("  pnpm lawmind:smoke");
  if (!opts.desktop) {
    console.log(
      "  pnpm lawmind:setup:team -- --desktop   # also write Electron userData .env.lawmind",
    );
  }
}

main().catch((err) => {
  console.error("[LawMind] team env setup failed:", err);
  process.exitCode = 1;
});
