import { buildMatterIndex, listMatterOverviews, summarizeMatterIndex } from "../../cases/index.js";
import { buildMatterReadModelFromIndex, type MatterReadModel } from "../../core/contracts.js";
import type { MatterOverview, MatterSummary } from "../../types.js";

export async function getMatterReadModel(
  workspaceDir: string,
  matterId: string,
): Promise<MatterReadModel> {
  const index = await buildMatterIndex(workspaceDir, matterId);
  return buildMatterReadModelFromIndex(index);
}

export async function listMatterReadModels(workspaceDir: string): Promise<MatterReadModel[]> {
  const overviews = await listMatterOverviews(workspaceDir);
  const models = await Promise.all(
    overviews.map((overview) => getMatterReadModel(workspaceDir, overview.matterId)),
  );
  return models.toSorted((a, b) =>
    (b.matter.updatedAt ?? "").localeCompare(a.matter.updatedAt ?? ""),
  );
}

export async function listMatterCockpitOverviews(workspaceDir: string): Promise<MatterOverview[]> {
  return listMatterOverviews(workspaceDir);
}

export async function getMatterCockpitSummary(
  workspaceDir: string,
  matterId: string,
): Promise<MatterSummary> {
  const index = await buildMatterIndex(workspaceDir, matterId);
  return summarizeMatterIndex(index);
}
