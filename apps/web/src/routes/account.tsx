import { CheckCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { createRoute, Navigate } from "@tanstack/react-router";
import { Alert, Button } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { authClient } from "../auth/auth-client.js";
import {
  fetchLoginMethods,
  oauthErrorKey,
  startOAuth,
  type LoginProvider,
} from "../auth/oauth.js";
import { PageLoading } from "../components/feedback.js";
import { AccountSettingsShell } from "../components/account-settings-shell.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { rootRoute } from "./root.js";

function AccountPage(): React.JSX.Element {
  const { t } = useTranslation();
  useDocumentTitle(t("publicEntry.oauth.accounts"));
  const session = authClient.useSession();
  const search = accountRoute.useSearch();
  const methods = useQuery({
    queryKey: ["authentication", "login-methods"],
    queryFn: fetchLoginMethods,
    retry: false,
  });
  const accounts = useQuery({
    queryKey: ["authentication", "linked-accounts", session.data?.user.id],
    enabled: Boolean(session.data),
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) throw new Error("Cannot load accounts");
      return result.data;
    },
    retry: false,
  });
  const [pending, setPending] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [dismissedCallbackError, setDismissedCallbackError] = useState(false);

  async function link(provider: LoginProvider): Promise<void> {
    setPending(provider.id);
    setFailed(false);
    setDismissedCallbackError(true);
    try {
      await startOAuth(provider, "/account", "/account", true);
    } catch {
      setFailed(true);
      setPending(undefined);
    }
  }

  function retryAccountConnections(): void {
    void methods.refetch();
    void accounts.refetch();
  }

  if (session.isPending)
    return <PageLoading label={t("publicEntry.login.checking")} />;
  if (!session.data)
    return <Navigate to="/login" search={{ returnTo: "/account" }} replace />;

  return (
    <AccountSettingsShell scope="account">
      <section className="w-full max-w-[720px]">
        <h1
          className="m-0 text-ui-headline font-bold text-ink"
          data-page-focus-target
          tabIndex={-1}
        >
          {t("publicEntry.oauth.accounts")}
        </h1>
        <p className="mb-6 mt-2 break-all text-sm text-muted">
          {session.data.user.email}
        </p>
        {failed || (search.error && !dismissedCallbackError) ? (
          <Alert
            className="mb-5"
            showIcon
            type="error"
            title={t(
              search.error &&
                !dismissedCallbackError &&
                oauthErrorKey(search.error) === "emailMismatch"
                ? "publicEntry.oauth.emailMismatch"
                : "publicEntry.oauth.linkFailed",
            )}
          />
        ) : null}
        {methods.isError || accounts.isError ? (
          <Alert
            showIcon
            type="error"
            title={t("publicEntry.login.connectionError")}
            action={
              <Button
                loading={methods.isFetching || accounts.isFetching}
                onClick={retryAccountConnections}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}
        {!methods.isError &&
        !accounts.isError &&
        (methods.isPending || accounts.isPending) ? (
          <div
            className="flex items-center gap-2 py-4 text-sm text-muted"
            role="status"
          >
            <LoadingOutlined aria-hidden="true" spin />
            {t("publicEntry.oauth.loadingAccounts")}
          </div>
        ) : null}
        {methods.isSuccess && accounts.isSuccess ? (
          <div className="grid gap-3">
            {methods.data.providers.length === 0 ? (
              <p className="m-0 py-3 text-sm text-muted">
                {t("publicEntry.oauth.noneConfigured")}
              </p>
            ) : null}
            {methods.data.providers.map((provider) => {
              const linked = accounts.data?.some(
                (account) => account.providerId === provider.id,
              );
              return (
                <div
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-control bg-paper px-4 py-3"
                  key={provider.id}
                >
                  <span className="min-w-0 flex-1 break-words text-sm font-medium">
                    {provider.name}
                  </span>
                  {linked ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-positive">
                      <CheckCircleOutlined aria-hidden="true" />
                      {t("publicEntry.oauth.linked")}
                    </span>
                  ) : (
                    <Button
                      className="shrink-0"
                      disabled={Boolean(pending)}
                      loading={pending === provider.id}
                      onClick={() => {
                        void link(provider);
                      }}
                    >
                      {t("publicEntry.oauth.link")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </AccountSettingsShell>
  );
}

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  validateSearch: (
    search: Record<string, unknown>,
  ): { readonly error?: string } =>
    typeof search.error === "string"
      ? { error: search.error.slice(0, 100) }
      : {},
  component: AccountPage,
});
