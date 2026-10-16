import {
  ArrowRightOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { createRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { authClient } from "../auth/auth-client.js";
import { safeReturnTo } from "../auth/entry-recovery.js";
import { PageLoading } from "../components/feedback.js";
import {
  PublicEntryShell,
  PublicResult,
} from "../components/public-entry-shell.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { rootRoute } from "./root.js";

interface EmailVerificationSearch {
  readonly error?: string;
  readonly returnTo?: string;
}

function EmailVerificationPage(): React.JSX.Element {
  const { t } = useTranslation();
  const search = emailVerificationRoute.useSearch();
  const session = authClient.useSession();
  useDocumentTitle(t("publicEntry.emailVerification.documentTitle"));

  useEffect(() => {
    if (session.data && !search.error) {
      window.location.replace(search.returnTo ?? "/");
    }
  }, [search.error, search.returnTo, session.data]);

  if (session.isPending || (session.data && !search.error)) {
    return <PageLoading label={t("publicEntry.emailVerification.finishing")} />;
  }

  return (
    <PublicEntryShell>
      <PublicResult
        description={t(
          search.error
            ? "publicEntry.emailVerification.failedDescription"
            : "publicEntry.emailVerification.sessionDescription",
        )}
        icon={<ExclamationCircleOutlined />}
        primaryAction={{
          icon: search.error ? <ReloadOutlined /> : <ArrowRightOutlined />,
          ...(search.error ? {} : { iconPlacement: "end" as const }),
          label: t(
            search.error
              ? "publicEntry.emailVerification.requestAgain"
              : "publicEntry.emailVerification.signIn",
          ),
          onClick: () => {
            const base = search.error ? "/register" : "/login";
            window.location.assign(
              search.returnTo
                ? `${base}?returnTo=${encodeURIComponent(search.returnTo)}`
                : base,
            );
          },
        }}
        {...(search.error
          ? {
              secondaryAction: {
                icon: <ArrowRightOutlined />,
                iconPlacement: "end" as const,
                label: t("publicEntry.emailVerification.signIn"),
                onClick: () => {
                  window.location.assign(
                    search.returnTo
                      ? `/login?returnTo=${encodeURIComponent(search.returnTo)}`
                      : "/login",
                  );
                },
              },
            }
          : {})}
        title={t(
          search.error
            ? "publicEntry.emailVerification.failedTitle"
            : "publicEntry.emailVerification.sessionTitle",
        )}
        tone={search.error ? "danger" : "warning"}
      />
    </PublicEntryShell>
  );
}

export const emailVerificationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/email-verification",
  validateSearch: (
    search: Record<string, unknown>,
  ): EmailVerificationSearch => {
    const returnTo = safeReturnTo(search.returnTo);
    return {
      ...(typeof search.error === "string"
        ? { error: search.error.slice(0, 100) }
        : {}),
      ...(returnTo ? { returnTo } : {}),
    };
  },
  component: EmailVerificationPage,
});
