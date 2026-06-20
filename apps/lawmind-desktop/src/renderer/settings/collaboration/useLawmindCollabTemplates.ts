import { useEffect, useState } from "react";
import { apiGetJson, errorMessage } from "../../api-client.js";
import type { WorkflowTemplateRow } from "./lawmind-collab-types.js";

export function useLawmindCollabTemplates(
  apiBase: string | undefined,
  collaborationEnabled: boolean | undefined,
) {
  const [templates, setTemplates] = useState<WorkflowTemplateRow[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase || !collaborationEnabled) {
      setTemplates(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const j = await apiGetJson<{ ok?: boolean; templates?: WorkflowTemplateRow[] }>(
          apiBase,
          "/api/collaboration/workflow-templates",
        );
        if (cancelled) {
          return;
        }
        if (j.ok && Array.isArray(j.templates)) {
          setTemplates(j.templates);
          setTemplatesError(null);
        } else {
          setTemplates([]);
          setTemplatesError("无法加载工作流模板列表");
        }
      } catch (e) {
        if (!cancelled) {
          setTemplates([]);
          setTemplatesError(errorMessage(e, "加载失败"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, collaborationEnabled]);

  const templatesLoading =
    collaborationEnabled === true && Boolean(apiBase) && templates === null && !templatesError;

  return { templates, templatesError, templatesLoading };
}
