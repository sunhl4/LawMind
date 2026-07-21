import { handleAuditExportRoute } from "./lawmind-server-route-audit-export.js";
import { handleBootstrapRoute } from "./lawmind-server-route-bootstrap.js";
import { handleChatRoute } from "./lawmind-server-route-chat.js";
import { handleActionSummaryRoutes } from "./lawmind-server-route-action-summary.js";
import { handleAgentFleetRoutes } from "./lawmind-server-route-agent-fleet.js";
import { handleAutomationsRoutes } from "./lawmind-server-route-automations.js";
import { handleMailRoutes } from "./lawmind-server-route-mail.js";
import { handleAssistantRoutes } from "./lawmind-server-route-assistants.js";
import { handleCollaborationRoutes } from "./lawmind-server-route-collaboration.js";
import { handleJobRoutes } from "./lawmind-server-route-jobs.js";
import { handleFilesystemRoute } from "./lawmind-server-route-fs.js";
import { handleHealthRoute } from "./lawmind-server-route-health.js";
import { handleMatterRoutes } from "./lawmind-server-route-matters.js";
import { handleAcceptanceRoutes } from "./lawmind-server-route-acceptance.js";
import { handleOnboardingRoutes } from "./lawmind-server-route-onboarding.js";
import { handleLearningContractRoutes } from "./lawmind-server-route-learning-contract.js";
import { handleContractReviewRoutes } from "./lawmind-server-route-contract-review.js";
import { handleDeskSettingsRoutes } from "./lawmind-server-route-desk-settings.js";
import { handleRecordRoutes } from "./lawmind-server-route-records.js";
import { handleSessionExtendedRoutes } from "./lawmind-server-route-sessions.js";
import { handleDraftRevisionJobRoute } from "./lawmind-server-route-draft-revision.js";
import { handleReviewRoute } from "./lawmind-server-route-review.js";
import { handleRedlineRoutes } from "./lawmind-server-route-redline.js";
import { handleSearchRoutes } from "./lawmind-server-route-search.js";
import { handlePlatformRoutes } from "./lawmind-server-route-platform.js";
import { handleModelsRoutes } from "./lawmind-server-route-models.js";
import { handleSourceRoutes } from "./lawmind-server-route-sources.js";
import { handleIntegrationsRoutes } from "./lawmind-server-route-integrations.js";
import { handleToolsRegistryRoute } from "./lawmind-server-route-tools-registry.js";
import { handleTemplateRoutes } from "./lawmind-server-route-templates.js";
import { handleMemoryAndTemplateRoutes } from "./lawmind-server-route-memory-templates.js";
import { handleMemorySourceTextRoute } from "./lawmind-server-route-memory-preview.js";
import { handleMemoryAdoptionRoutes } from "./lawmind-server-route-memory-adoption.js";
import { handleRolesRoutes } from "./lawmind-server-route-roles.js";
import { handleTriageRoutes } from "./lawmind-server-route-triage.js";
import { handleReviewCampaignRoutes } from "./lawmind-server-route-review-campaign.js";
import { handleSkillsRoutes } from "./lawmind-server-route-skills.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

export type LawmindRouteHandler = (args: LawmindRouteContext) => boolean | Promise<boolean>;

/** Ordered route handlers; first match wins (same semantics as the legacy if-chain). */
export const LAWMIND_ROUTE_HANDLERS: LawmindRouteHandler[] = [
  (args) => handleHealthRoute(args),
  (args) => handleBootstrapRoute(args),
  (args) => handleTemplateRoutes(args),
  (args) => handleAcceptanceRoutes(args),
  (args) => handleTriageRoutes(args),
  (args) => handleReviewCampaignRoutes(args),
  (args) => handleSkillsRoutes(args),
  (args) => handleSourceRoutes(args),
  (args) => handleIntegrationsRoutes(args),
  (args) => handleToolsRegistryRoute(args),
  (args) => handleDraftRevisionJobRoute(args),
  (args) => handleRedlineRoutes(args),
  (args) => handleSearchRoutes(args),
  (args) => handleReviewRoute(args),
  (args) => handleModelsRoutes(args),
  (args) => handleChatRoute(args),
  (args) => handleActionSummaryRoutes(args),
  (args) => handleAgentFleetRoutes(args),
  (args) => handleMailRoutes(args),
  (args) => handleAutomationsRoutes(args),
  (args) => handleAssistantRoutes(args),
  (args) => handleMatterRoutes(args),
  (args) => handleOnboardingRoutes(args),
  (args) => handleDeskSettingsRoutes(args),
  (args) => handleContractReviewRoutes(args),
  (args) => handleLearningContractRoutes(args),
  (args) => handleSessionExtendedRoutes(args),
  (args) => handleRecordRoutes(args),
  (args) => handleJobRoutes(args),
  (args) => handleCollaborationRoutes(args),
  (args) => handlePlatformRoutes(args),
  (args) => handleAuditExportRoute(args),
  (args) => handleMemoryAndTemplateRoutes(args),
  (args) => handleMemorySourceTextRoute(args),
  (args) => handleMemoryAdoptionRoutes(args),
  (args) => handleRolesRoutes(args),
  (args) => handleFilesystemRoute(args),
];

export async function dispatchLawmindRoute(
  args: LawmindRouteContext,
): Promise<boolean> {
  for (const handler of LAWMIND_ROUTE_HANDLERS) {
    const handled = await handler(args);
    if (handled) {
      return true;
    }
  }
  return false;
}
