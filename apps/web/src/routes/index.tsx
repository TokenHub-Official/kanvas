import type { CurrentHumanContext } from "@kanvas/contracts/api";
import {
  LogoutOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, Navigate } from "@tanstack/react-router";
import { Alert, Button } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { httpStatus } from "../api/http-status.js";
import {
  ApiProblem,
  fetchCurrentHumanContext,
  retryDefaultAccess,
} from "../api/transport.js";
import { authClient } from "../auth/auth-client.js";
import {
  clearWorkspacePreference,
  lastWorkspacePreferenceKey,
} from "../auth/entry-recovery.js";
import { performSignOut } from "../auth/sign-out.js";
import serverCogIcon from "../assets/icons/ant-design/SettingOutlined.svg";
import userShieldIcon from "../assets/icons/ant-design/SafetyCertificateOutlined.svg";
import { DoodleIcon } from "../components/doodle-icon.js";
import { PageLoading } from "../components/feedback.js";
import {
  PublicEntryShell,
  PublicResult,
} from "../components/public-entry-shell.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { SessionExpired } from "../components/workspace-page.js";
import { rootRoute } from "./root.js";

function GatewayPage(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const signOutInFlightRef = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  useDocumentTitle(t("publicEntry.gateway.documentTitle"));
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    retry: false,
    staleTime: 15_000,
  });
  const accessRetry = useMutation({
    mutationFn: async () => {
      if (!context.data) return;
      return retryDefaultAccess(context.data.csrfToken);
    },
    onSuccess: async (result) => {
      if (!result) return;
      queryClient.setQueryData<CurrentHumanContext>(
        ["authentication", "current-human-context"],
        (previous) =>
          previous ? { ...previous, defaultAccess: result } : previous,
      );
      await context.refetch();
    },
  });
  const accessStatus = context.data?.defaultAccess;
  const allocationIncomplete =
    accessStatus?.state === "failed" || accessStatus?.state === "pending";
  const contextRecovery = usePageQueryRecovery(context.refetch);

  function signOut(): void {
    setSigningOut(true);
    setSignOutFailed(false);
    void performSignOut({
      lock: signOutInFlightRef,
      onFailure: () => {
        setSigningOut(false);
        setSignOutFailed(true);
      },
      onRevoked: () => {
        queryClient.clear();
        clearWorkspacePreference(window.localStorage);
        window.location.assign("/login");
      },
      revoke: async () => {
        const result = await authClient.signOut();
        if (result.error) throw new Error("Session revocation failed.");
      },
    });
  }

  if (context.isPending) {
    return <PageLoading label={t("publicEntry.gateway.loading")} />;
  }

  if (
    context.error instanceof ApiProblem &&
    context.error.status === httpStatus.unauthorized
  ) {
    return <SessionExpired returnTo="/" />;
  }

  if (context.isError) {
    return (
      <PublicEntryShell>
        <PublicResult
          description={t("publicEntry.gateway.unavailableDescription")}
          primaryAction={{
            icon: <ReloadOutlined />,
            iconPlacement: "start",
            label: t("common.retry"),
            loading: contextRecovery.pending,
            onClick: contextRecovery.retry,
          }}
          icon={
            <DoodleIcon
              aspectRatio="170 / 133"
              className="h-[72px] w-auto"
              source={serverCogIcon}
            />
          }
          title={t("publicEntry.gateway.unavailableTitle")}
          tone="danger"
          visualVariant="illustration"
        />
      </PublicEntryShell>
    );
  }

  if (context.data.human.status !== "active") {
    return (
      <PublicEntryShell>
        <PublicResult
          title={t("instanceAccess.accounts.disabledTitle")}
          description={t("instanceAccess.accounts.disabledDescription")}
          icon={<SafetyCertificateOutlined />}
          tone="warning"
          primaryAction={{
            icon: <LogoutOutlined />,
            label: t("instanceAccess.awaiting.signOut"),
            loading: signingOut,
            onClick: signOut,
          }}
        />
        {signOutFailed ? (
          <p role="alert" className="text-sm text-danger">
            {t("instanceAccess.awaiting.signOutError")}
          </p>
        ) : null}
      </PublicEntryShell>
    );
  }

  const firstWorkspace = context.data.workspaces[0];
  const lastWorkspaceId =
    typeof window === "undefined"
      ? undefined
      : window.localStorage.getItem(lastWorkspacePreferenceKey);
  const preferredWorkspace =
    context.data.workspaces.find(
      (workspace) => workspace.id === lastWorkspaceId,
    ) ?? firstWorkspace;
  if (preferredWorkspace) {
    return (
      <Navigate
        params={{
          workspaceId: preferredWorkspace.id,
        }}
        replace
        to="/w/$workspaceId"
      />
    );
  }

  const administrator = Boolean(context.data.instanceAdministrator);
  return (
    <PublicEntryShell
      headerEnd={
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span
            className="max-w-28 truncate sm:max-w-64"
            title={
              context.data.human.verifiedEmail ?? context.data.human.displayName
            }
          >
            {context.data.human.verifiedEmail ?? context.data.human.displayName}
          </span>
          <Button
            disabled={signingOut}
            icon={<LogoutOutlined />}
            loading={signingOut}
            onClick={signOut}
            size="small"
            type="text"
          >
            {t(
              signingOut
                ? "instanceAccess.awaiting.signingOut"
                : "instanceAccess.awaiting.signOut",
            )}
          </Button>
        </div>
      }
    >
      <div className="grid w-full justify-items-center">
        {signOutFailed ? (
          <Alert
            className="mb-5 w-full max-w-[520px]"
            showIcon
            title={t("instanceAccess.awaiting.signOutError")}
            type="error"
          />
        ) : null}
        {accessRetry.isError ? (
          <Alert
            type="error"
            showIcon
            title={t("instanceAccess.defaultAccess.temporary_failure")}
          />
        ) : null}
        <PublicResult
          description={t(
            allocationIncomplete
              ? `instanceAccess.defaultAccess.${accessStatus.reason}`
              : "instanceAccess.awaiting.description",
          )}
          primaryAction={
            administrator
              ? {
                  icon: <SafetyCertificateOutlined />,
                  iconPlacement: "start",
                  label: t("instanceAccess.awaiting.manage"),
                  onClick: () => {
                    window.location.assign("/admin/access");
                  },
                }
              : {
                  icon: <ReloadOutlined />,
                  iconPlacement: "start",
                  label: t("instanceAccess.awaiting.recheck"),
                  loading: contextRecovery.pending || accessRetry.isPending,
                  onClick: allocationIncomplete
                    ? () => accessRetry.mutate()
                    : contextRecovery.retry,
                }
          }
          {...(administrator
            ? {
                secondaryAction: {
                  icon: <ReloadOutlined />,
                  iconPlacement: "start" as const,
                  label: t("instanceAccess.awaiting.recheck"),
                  loading: contextRecovery.pending || accessRetry.isPending,
                  onClick: allocationIncomplete
                    ? () => accessRetry.mutate()
                    : contextRecovery.retry,
                },
              }
            : {})}
          icon={
            <DoodleIcon
              aspectRatio="203 / 139"
              className="h-[72px] w-auto"
              source={userShieldIcon}
            />
          }
          title={t(
            allocationIncomplete
              ? "instanceAccess.defaultAccess.incomplete"
              : "instanceAccess.awaiting.title",
          )}
          visualVariant="illustration"
        />
        <Link
          className="mt-4 rounded-control px-3 py-2 text-sm text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          to="/account"
        >
          {t("publicEntry.oauth.accounts")}
        </Link>
      </div>
    </PublicEntryShell>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: GatewayPage,
});
