import type { CapabilityBindingSummary } from "@kanvas/contracts/api";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  moveCapabilityBinding,
  setCapabilityBindingStatus,
} from "../../api/transport.js";
import { useSettingsNotification } from "../../components/settings-notification.js";
import { capabilityOperationError } from "./capability-bindings-runtime.js";
import type { PendingCapabilityOrderMove } from "./capability-bindings-runtime.js";

export interface CapabilityPauseTarget {
  readonly binding: CapabilityBindingSummary;
  readonly capabilityName: string;
  readonly removesLastEnabledRoute: boolean;
}

export function useCapabilityBindingsController({
  csrfToken,
  onRefresh,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly onRefresh: () => Promise<unknown>;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const toast = useSettingsNotification();
  const context = { csrfToken, workspaceId };
  const [pauseTarget, setPauseTarget] = useState<CapabilityPauseTarget>();

  const statusMutation = useMutation({
    mutationFn: ({
      binding,
      status,
    }: {
      readonly binding: CapabilityBindingSummary;
      readonly status: "enabled" | "paused";
    }) =>
      setCapabilityBindingStatus(context, binding.id, {
        expectedVersion: binding.version,
        status,
      }),
    onSuccess: async (_result, variables) => {
      setPauseTarget(undefined);
      toast.notify({
        title:
          variables.status === "enabled"
            ? t("settings.execution.toast.resumedTitle")
            : t("settings.execution.toast.pausedTitle"),
        description: t("settings.execution.toast.statusDescription"),
        tone: "positive",
      });
      await onRefresh();
    },
    onError: async (error) => {
      setPauseTarget(undefined);
      toast.notify({ ...capabilityOperationError(error), tone: "danger" });
      await onRefresh();
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({
      bindings,
      moves,
    }: {
      readonly bindings: readonly CapabilityBindingSummary[];
      readonly moves: readonly PendingCapabilityOrderMove[];
    }) => {
      const versions = new Map(
        bindings.map((binding) => [binding.id, binding.version]),
      );
      for (const move of moves) {
        const expectedVersion = versions.get(move.bindingId);
        const expectedAdjacentVersion = versions.get(move.adjacentBindingId);
        if (
          expectedVersion === undefined ||
          expectedAdjacentVersion === undefined
        ) {
          throw new Error("Capability binding order is stale.");
        }
        const result = await moveCapabilityBinding(context, move.bindingId, {
          expectedVersion,
          adjacentBindingId: move.adjacentBindingId,
          expectedAdjacentVersion,
          direction: move.direction,
        });
        versions.set(result.bindingId, result.version);
        if (result.adjacentBindingId && result.adjacentVersion !== undefined) {
          versions.set(result.adjacentBindingId, result.adjacentVersion);
        }
      }
    },
    onSuccess: async () => {
      toast.notify({
        title: t("settings.execution.toast.orderTitle"),
        description: t("settings.execution.toast.orderDescription"),
        tone: "positive",
      });
      await onRefresh();
    },
    onError: async (error) => {
      toast.notify({ ...capabilityOperationError(error), tone: "danger" });
      await onRefresh();
    },
  });

  return {
    pauseTarget,
    closePause: () => setPauseTarget(undefined),
    confirmPause: () => {
      if (pauseTarget) {
        statusMutation.mutate({
          binding: pauseTarget.binding,
          status: "paused",
        });
      }
    },
    moveOrder: moveMutation.mutateAsync,
    openPause: setPauseTarget,
    operationPending: statusMutation.isPending || moveMutation.isPending,
    orderSaving: moveMutation.isPending,
    resume: (binding: CapabilityBindingSummary) =>
      statusMutation.mutate({ binding, status: "enabled" }),
  };
}
