/**
 * Product playbooks are built into the app. This route lists them.
 * It does not install, enable, or disable skills.
 */

import { listProductPlaybooks } from "../../../src/lawmind/skills/product-playbooks.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

export async function handleSkillsRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { pathname, req, res, c } = args;

  if (pathname === "/api/skills" && req.method === "GET") {
    sendJson(
      res,
      200,
      {
        ok: true,
        configurable: false,
        skills: listProductPlaybooks().map((s) => ({
          id: s.id,
          name: s.name,
          version: s.version,
          description: s.description,
          toolNames: s.toolNames ?? [],
        })),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/skills/enabled" && req.method === "POST") {
    sendJson(
      res,
      405,
      {
        ok: false,
        error: "作业标准随软件内置，不能安装或开关。",
      },
      c,
    );
    return true;
  }

  return false;
}
