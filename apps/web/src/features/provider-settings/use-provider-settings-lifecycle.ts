import type {
  ProviderModelPricingConfiguration,
  ProviderModelCatalogReview,
  ProviderSettingSummary,
} from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  activateWorkspaceProviderSetting,
  adoptWorkspaceProviderModelCatalog,
  disableWorkspaceProviderSetting,
  fetchWorkspaceProviderModelCatalogReview,
  fetchWorkspaceProviderSettings,
  refreshWorkspaceProviderModelCatalog,
} from "../../api/transport.js";
import { workspaceQueryKeys } from "../../api/query-keys.js";
import { useSettingsNotification } from "../../components/settings-notification.js";
import {
  createProviderOperationKey,
  providerSettingsError,
} from "./provider-settings-runtime.js";

interface ProviderSettingsLifecycleInput {
  readonly csrfToken: string;
  readonly workspaceId: string;
}

export function useProviderSettingsLifecycle({
  csrfToken,
  workspaceId,
}: ProviderSettingsLifecycleInput) {
  const { t } = useTranslation();
  const toast = useSettingsNotification();
  const queryClient = useQueryClient();
  const queryKey = workspaceQueryKeys.providerSettings(workspaceId);
  const apiContext = { csrfToken, workspaceId };
  const [disableTarget, setDisableTarget] = useState<ProviderSettingSummary>();
  const [catalogReviewProviderId, setCatalogReviewProviderId] =
    useState<string>();
  const catalogAdoptionRequestKeyRef = useRef<string | undefined>(undefined);

  const settings = useQuery({
    queryKey,
    queryFn: () => fetchWorkspaceProviderSettings(workspaceId),
    retry: false,
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey });
  }

  const activateProvider = useMutation({
    mutationFn: (input: {
      readonly hardLimitAmount: string;
      readonly provider: ProviderSettingSummary;
      readonly modelPricingConfigurations?: readonly ProviderModelPricingConfiguration[];
    }) =>
      activateWorkspaceProviderSetting(
        apiContext,
        input.provider.id,
        {
          expectedVersion: input.provider.version,
          hardLimitAmount: input.hardLimitAmount,
          ...(input.modelPricingConfigurations?.length
            ? {
                modelPricingConfigurations: [
                  ...input.modelPricingConfigurations,
                ],
              }
            : {}),
        },
        createProviderOperationKey(),
      ),
    onSuccess: async (_result, { provider }) => {
      toast.notify({
        title: provider.activatedAt
          ? t("settings.providers.toast.reactivatedTitle")
          : t("settings.providers.toast.activatedTitle"),
        description: t("settings.providers.toast.activatedDescription"),
        tone: "positive",
      });
      await refresh();
    },
    onError: async (error) => {
      toast.notify({
        title: t("settings.providers.toast.activateErrorTitle"),
        description: providerSettingsError(error),
        tone: "danger",
      });
      await refresh();
    },
  });

  const refreshProviderCatalog = useMutation({
    mutationFn: (provider: ProviderSettingSummary) =>
      refreshWorkspaceProviderModelCatalog(
        apiContext,
        provider.id,
        { expectedVersion: provider.version },
        createProviderOperationKey(),
      ),
    onSuccess: async (result) => {
      toast.notify({
        title: t("settings.providers.toast.catalogRefreshedTitle"),
        description: result.changesPendingReview
          ? t("settings.providers.toast.catalogChangesPendingDescription")
          : t("settings.providers.toast.catalogRefreshedDescription"),
        tone: "positive",
      });
      if (result.changesPendingReview) {
        openCatalogReview(result.provider);
      }
      await refresh();
    },
    onError: async (error) => {
      toast.notify({
        title: t("settings.providers.toast.catalogRefreshErrorTitle"),
        description: providerSettingsError(error),
        tone: "danger",
      });
      await refresh();
    },
  });

  const reviewProviderCatalog = useMutation({
    mutationFn: (providerSettingId: string) =>
      fetchWorkspaceProviderModelCatalogReview(apiContext, providerSettingId),
  });

  const adoptProviderCatalog = useMutation({
    mutationFn: ({
      providerSettingId,
      review,
    }: {
      readonly providerSettingId: string;
      readonly review: ProviderModelCatalogReview;
    }) => {
      if (!review.activated) {
        throw new Error(
          "An activated catalog revision is required for adoption.",
        );
      }
      return adoptWorkspaceProviderModelCatalog(
        apiContext,
        providerSettingId,
        {
          expectedVersion: review.version,
          currentRevision: review.current.revision,
          activatedRevision: review.activated.revision,
        },
        catalogAdoptionRequestKeyRef.current ??
          (catalogAdoptionRequestKeyRef.current = createProviderOperationKey()),
      );
    },
    onSuccess: async () => {
      closeCatalogReview();
      toast.notify({
        title: t("settings.providers.toast.catalogAdoptedTitle"),
        description: t("settings.providers.toast.catalogAdoptedDescription"),
        tone: "positive",
      });
      await refresh();
    },
    onError: refresh,
  });

  function openCatalogReview(provider: ProviderSettingSummary): void {
    catalogAdoptionRequestKeyRef.current = undefined;
    adoptProviderCatalog.reset();
    reviewProviderCatalog.reset();
    setCatalogReviewProviderId(provider.id);
    reviewProviderCatalog.mutate(provider.id);
  }

  function closeCatalogReview(): void {
    if (adoptProviderCatalog.isPending) {
      return;
    }
    setCatalogReviewProviderId(undefined);
    catalogAdoptionRequestKeyRef.current = undefined;
    adoptProviderCatalog.reset();
    reviewProviderCatalog.reset();
  }

  const disableProvider = useMutation({
    mutationFn: (provider: ProviderSettingSummary) =>
      disableWorkspaceProviderSetting(
        apiContext,
        provider.id,
        { expectedVersion: provider.version },
        createProviderOperationKey(),
      ),
    onSuccess: async () => {
      setDisableTarget(undefined);
      toast.notify({
        title: t("settings.providers.toast.disabledTitle"),
        description: t("settings.providers.toast.disabledDescription"),
        tone: "positive",
      });
      await refresh();
    },
    onError: async (error) => {
      toast.notify({
        title: t("settings.providers.toast.disableErrorTitle"),
        description: providerSettingsError(error),
        tone: "danger",
      });
      await refresh();
    },
  });

  return {
    activateProvider,
    adoptProviderCatalog,
    catalogReviewProviderId,
    closeCatalogReview,
    disableProvider,
    disableTarget,
    openCatalogReview,
    refresh,
    refreshProviderCatalog,
    reviewProviderCatalog,
    setDisableTarget,
    settings,
  };
}
