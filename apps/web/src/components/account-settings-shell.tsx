import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { fetchCurrentHumanContext } from "../api/transport.js";
import { Brand } from "./brand.js";
import { cn } from "../lib/cn.js";

/** Account and site settings remain accessible without workspace membership. */
export function AccountSettingsShell({
  children,
  scope,
}: {
  readonly children: ReactNode;
  readonly scope: "account" | "site";
}): React.JSX.Element {
  const { t } = useTranslation();
  const runtimeActive = useLocation({
    select: (location) => location.pathname.startsWith("/admin/runtime"),
  });
  const toolsActive = useLocation({
    select: (location) => location.pathname.startsWith("/admin/tools"),
  });
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    retry: false,
  });
  const scopeLabel =
    scope === "account"
      ? t("publicEntry.settings.personal")
      : t("instanceAccess.title");
  return (
    <div className="min-h-svh bg-[var(--mist)]">
      <header className="flex h-[72px] items-center gap-5 border-b border-[var(--line)] bg-paper px-5 sm:px-8">
        <Brand />
        <span className="border-l border-[var(--line)] pl-5 text-sm font-medium text-muted">
          {scopeLabel}
        </span>
      </header>
      <div
        className={cn("mx-auto px-5 py-6 sm:px-8 sm:py-8", "max-w-[1200px]")}
      >
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
        >
          <ArrowLeftOutlined />
          {t("publicEntry.settings.returnWorkspaces")}
        </Link>
        <div className="grid items-start gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav
            aria-label={t("publicEntry.settings.navigation")}
            className="flex flex-wrap gap-2 md:flex-col"
          >
            <Link
              to="/account"
              aria-current={scope === "account" ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-control px-4 py-3 text-sm",
                scope === "account"
                  ? "bg-paper font-semibold text-primary"
                  : "text-muted hover:bg-paper",
              )}
            >
              <UserOutlined />
              {t("publicEntry.settings.personal")}
            </Link>
            {context.data?.instanceAdministrator ? (
              <div className="w-full px-4 pt-4 text-xs text-muted">
                {t("instanceAccess.title")}
              </div>
            ) : null}
            {context.data?.instanceAdministrator ? (
              <Link
                to="/admin/access"
                aria-current={
                  scope === "site" && !toolsActive && !runtimeActive
                    ? "page"
                    : undefined
                }
                className={cn(
                  "flex items-center gap-3 rounded-control px-4 py-3 text-sm",
                  scope === "site" && !toolsActive && !runtimeActive
                    ? "bg-paper font-semibold text-primary"
                    : "text-muted hover:bg-paper",
                )}
              >
                <SafetyCertificateOutlined />
                {t("studio.tools.editor.accessSettings")}
              </Link>
            ) : null}
            {context.data?.instanceAdministrator ? (
              <Link
                to="/admin/tools"
                aria-current={toolsActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-control px-4 py-3 text-sm",
                  toolsActive
                    ? "bg-paper font-semibold text-primary"
                    : "text-muted hover:bg-paper",
                )}
              >
                <AppstoreOutlined />
                {t("studio.tools.management")}
              </Link>
            ) : null}
            {context.data?.instanceAdministrator ? (
              <Link
                to="/admin/runtime"
                aria-current={runtimeActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-control px-4 py-3 text-sm",
                  runtimeActive
                    ? "bg-paper font-semibold text-primary"
                    : "text-muted hover:bg-paper",
                )}
              >
                <SafetyCertificateOutlined />
                {t("runtimeConfiguration.title")}
              </Link>
            ) : null}
          </nav>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
