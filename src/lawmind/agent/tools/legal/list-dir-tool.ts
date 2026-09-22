import { directoryListingToolData, resolveAndListDirectory } from "../../../runtime/list-dir.js";
import type { AgentTool } from "../../types.js";

export const listDirTool: AgentTool = {
  definition: {
    name: "list_dir",
    description:
      "列举工作区、本机文件夹或钉选目录下的文件与子目录（默认递归，有界）。律师带入整夹时先用本工具看清树，再按返回的 path 阅读正文。不要把目录当成文件去读。",
    category: "search",
    parameters: {
      path: {
        type: "string",
        description:
          "相对工作区/项目根的路径，或本机文件夹内路径。省略或 `.` 表示项目目录（若已选）或工作区根。",
      },
      recursive: {
        type: "boolean",
        description: "是否递归子目录。默认 true。",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const raw = typeof params.path === "string" ? params.path : "";
    const recursive = params.recursive !== false;
    const listing = resolveAndListDirectory(ctx, raw, { recursive });
    if (!listing.ok) {
      return { ok: false, error: listing.error };
    }
    return { ok: true, data: directoryListingToolData(listing) };
  },
};
