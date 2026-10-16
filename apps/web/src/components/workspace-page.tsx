import type { CurrentHumanContext } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { httpStatus } from "../api/http-status.js";
import { ApiProblem, fetchCurrentHumanContext } from "../api/transport.js";
import { returnToFromLocation } from "../auth/entry-recovery.js";
import {
  developmentProxyRetryMilliseconds,
  developmentProxyStartupGraceMilliseconds,
} from "../development-api-proxy.js";
import { queryClient } from "../query-client.js";
import { AppShell } from "./app-shell.js";
import { PageEmptyState, PageLoading } from "./feedback.js";
import { usePageQueryRecovery } from "./page-query-recovery.js";

type WorkspaceAccess = {
  readonly context: CurrentHumanContext;
  readonly workspace: CurrentHumanContext["workspaces"][number];
};

const developmentServerStartingCode = "development.server_starting";
const developmentServerStartingRetries = Math.ceil(
  developmentProxyStartupGraceMilliseconds / developmentProxyRetryMilliseconds,
);

export function workspaceContextIsStarting(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    error.status === httpStatus.serviceUnavailable &&
    error.code === developmentServerStartingCode
  );
}

export function retryStartingWorkspaceContext(
  failureCount: number,
  error: unknown,
): boolean {
  return (
    failureCount < developmentServerStartingRetries &&
    workspaceContextIsStarting(error)
  );
}

export function SessionExpired({
  returnTo,
}: {
  readonly returnTo: string;
}): React.JSX.Element {
  useEffect(() => {
    queryClient.clear();
  }, []);
  return (
    <Navigate
      replace
      search={{
        reason: "authentication-required",
        returnTo,
      }}
      to="/login"
    />
  );
}

export function WorkspaceBoundary({
  children,
  workspaceId,
}: {
  readonly children: (input: WorkspaceAccess) => ReactNode;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    retry: retryStartingWorkspaceContext,
    retryDelay: developmentProxyRetryMilliseconds,
    staleTime: 15_000,
  });
  const contextRecovery = usePageQueryRecovery(context.refetch);
  const serverStarting = workspaceContextIsStarting(
    context.failureReason ?? context.error,
  );

  if (context.isPending || serverStarting) {
    return serverStarting ? (
      <PageLoading label={t("common.appShell.boundary.starting")} />
    ) : (
      <PageLoading />
    );
  }
  if (
    context.error instanceof ApiProblem &&
    context.error.status === httpStatus.unauthorized
  ) {
    return <SessionExpired returnTo={returnToFromLocation(window.location)} />;
  }
  if (context.isError) {
    return (
      <PageEmptyState
        action={contextRecovery.retry}
        actionLabel={t("common.appShell.boundary.reconnect")}
        actionPending={contextRecovery.pending}
        title={t("common.appShell.boundary.loadErrorTitle")}
      >
        {t("common.appShell.boundary.loadErrorDescription")}
      </PageEmptyState>
    );
  }

  const workspace = context.data.workspaces.find(
    (candidate) => candidate.id === workspaceId,
  );
  if (!workspace) {
    return (
      <div className="min-h-screen bg-mist">
        <PageEmptyState
          action={() => {
            window.location.assign("/");
          }}
          actionLabel={t("common.appShell.boundary.chooseWorkspace")}
          title={t("common.appShell.boundary.noAccessTitle")}
        >
          {t("common.appShell.boundary.noAccessDescription")}
        </PageEmptyState>
      </div>
    );
  }

  return <>{children({ context: context.data, workspace })}</>;
}

export function WorkspacePage({
  children,
  fullBleed = false,
  pageTitle,
  workspaceId,
}: {
  readonly children: ReactNode | ((input: WorkspaceAccess) => ReactNode);
  readonly fullBleed?: boolean;
  readonly pageTitle: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <AppShell
          context={context}
          fullBleed={fullBleed}
          pageTitle={pageTitle}
          workspace={workspace}
        >
          {typeof children === "function"
            ? children({ context, workspace })
            : children}
        </AppShell>
      )}
    </WorkspaceBoundary>
  );
}
