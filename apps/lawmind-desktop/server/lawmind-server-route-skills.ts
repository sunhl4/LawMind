/**
 * Skills E7 — list / enable local SKILL.md packs.
 */

import { z } from "zod";
import { ensureBuiltinSkillSeeds } from "../../../src/lawmind/skills/ensure-builtin-skill-seeds.js";
import {
  listLocalSkills,
  writeSkillEnabled,
} from "../../../src/lawmind/skills/skill-runtime.js";
import {
  isInvalidRequestBodyError,
  parseJsonBodyZod,
} from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import fs from "node:fs";
import path from "node:path";

export async function handleSkillsRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { ctx, pathname, req, res, c } = args;
  const { workspaceDir } = ctx;

  if (pathname === "/api/skills" && req.method === "GET") {
    // Idempotent: Settings Skills visible even if local-server boot seed was skipped.
    ensureBuiltinSkillSeeds(workspaceDir);
    const skills = listLocalSkills(workspaceDir);
    const packPath = path.join(workspaceDir, "lawmind", "packs", "cn-legal-pack.json");
    let cnPack = null;
    try {
      if (fs.existsSync(packPath)) {
        cnPack = JSON.parse(fs.readFileSync(packPath, "utf8"));
      }
    } catch {
      cnPack = null;
    }
    sendJson(res, 200, { ok: true, skills, cnPack }, c);
    return true;
  }

  if (pathname === "/api/skills/enabled" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(
        req,
        z.object({ skillId: z.string().min(1), enabled: z.boolean() }),
      );
      writeSkillEnabled(workspaceDir, body.skillId, body.enabled);
      sendJson(res, 200, { ok: true, skills: listLocalSkills(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid body" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  return false;
}
