import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  fetchCapabilityRun,
  fetchCanvasCapabilities,
} from "../../api/transport.js";
import { workspaceQueryKeys } from "../../api/query-keys.js";
import {
  canvasImageCapabilityTools,
  type CanvasImageCapabilityTool,
} from "./canvas-capability-tools.js";
import {
  createCanvasCoreOperationRegistry,
  workspaceCanvasOperationDefinitionsV1,
} from "./canvas-operation-registry.js";
import type { CanvasOperationSessionV1 } from "./canvas-operation-runtime-v1.js";

const forbiddenStatus = 403;
const capabilityRunPollIntervalMs = 1_000;
const executableCanvasOutputModes = new Set([
  "add_node",
  "asset_only",
  "replace_content",
  "set_background",
]);

export function useCanvasOperationCatalogV1({
  canEdit,
  operationSession,
  permissions,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly operationSession: CanvasOperationSessionV1 | undefined;
  readonly permissions: readonly string[];
  readonly workspaceId: string;
}) {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const canvasCoreOperationDefinitions = useMemo(
    () =>
      createCanvasCoreOperationRegistry({
        crop: t("canvas.editor.crop"),
        resize: t("canvas.editor.resize"),
      }).list(),
    [i18n.resolvedLanguage, t],
  );
  const canRunCanvasOperations =
    canEdit &&
    [
      "artifact.download",
      "asset.write",
      "capability.run",
      "canvas.write",
    ].every((permission) => permissions.includes(permission));
  const canApplyCanvasOperations =
    canEdit &&
    ["artifact.download", "asset.write", "canvas.write"].every((permission) =>
      permissions.includes(permission),
    );
  const canvasCapabilities = useQuery({
    queryKey: workspaceQueryKeys.canvasCapabilities(
      workspaceId,
      "image.edit",
      "artifact.image",
    ),
    queryFn: () =>
      fetchCanvasCapabilities(workspaceId, {
        actionGroup: "image.edit",
        selectedSemanticType: "artifact.image",
      }),
    enabled: canRunCanvasOperations,
    retry: false,
  });
  const capabilityTools = useMemo(
    () =>
      canvasImageCapabilityTools(
        canvasCapabilities.data?.items ?? [],
        i18n.resolvedLanguage?.startsWith("en") ? "en-US" : "zh-CN",
      ),
    [canvasCapabilities.data?.items, i18n.resolvedLanguage],
  );
  const workspaceOperationDefinitions = useMemo(
    () =>
      workspaceCanvasOperationDefinitionsV1(
        canvasCoreOperationDefinitions,
        capabilityTools,
      ),
    [capabilityTools],
  );
  const executableCapabilityTools = useMemo(
    () =>
      capabilityTools.filter((tool) =>
        isExecutableCapabilityTool(
          tool,
          canRunCanvasOperations,
          workspaceOperationDefinitions,
        ),
      ),
    [canRunCanvasOperations, capabilityTools, workspaceOperationDefinitions],
  );
  const capabilityRunId = operationSession?.capabilityRunId;
  const operationPhase = operationSession?.phase;
  const capabilityRunQuery = useQuery({
    queryKey: ["canvas-v1-capability-run", workspaceId, capabilityRunId],
    queryFn: () => fetchCapabilityRun(workspaceId, capabilityRunId ?? ""),
    enabled: Boolean(capabilityRunId && operationPhase === "running"),
    refetchInterval: (query) => {
      const status = query.state.data?.lifecycleStatus;
      return status && ["cancelled", "completed", "failed"].includes(status)
        ? false
        : capabilityRunPollIntervalMs;
    },
    retry: false,
  });
  const authorityChanged = isForbidden(capabilityRunQuery.error);

  useEffect(() => {
    if (!authorityChanged) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: ["authentication", "current-human-context"],
    });
  }, [authorityChanged, queryClient]);

  return {
    canApplyCanvasOperations,
    canRunCanvasOperations,
    executableCapabilityTools,
    capabilityRunQuery,
  };
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiProblem && error.status === forbiddenStatus;
}

function isExecutableCapabilityTool(
  tool: CanvasImageCapabilityTool,
  canRunCanvasOperations: boolean,
  definitions: ReturnType<typeof workspaceCanvasOperationDefinitionsV1>,
): boolean {
  const definition = definitions.find(
    (candidate) => candidate.id === tool.operationId,
  );
  return Boolean(
    canRunCanvasOperations &&
    definition?.availability.status === "available" &&
    definition.input.minimum <= 1 &&
    definition.input.maximum >= 1 &&
    definition.input.nodeKinds.includes("image") &&
    tool.outputModes.some((mode) => executableCanvasOutputModes.has(mode)),
  );
}
