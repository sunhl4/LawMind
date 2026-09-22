/**
 * Clear project directory via Electron bridge — leaf module (no settings page tree).
 */
import type { AppConfig } from "./lawmind-app-bootstrap";

type SetProjectDirBridge = NonNullable<Window["lawmindDesktop"]>["setProjectDir"];

export async function clearProjectDirectory(args: {
  config: AppConfig | null;
  setProjectDir?: SetProjectDirBridge;
}): Promise<{ projectDir?: string | null; apiBase?: string; error?: string }> {
  const { config, setProjectDir } = args;
  if (!config || !setProjectDir) {
    return {};
  }
  const response = await setProjectDir(null);
  if (!response.ok) {
    return { error: response.error || "关闭项目失败" };
  }
  return {
    projectDir: response.projectDir ?? null,
    apiBase: typeof response.apiBase === "string" ? response.apiBase : undefined,
  };
}
