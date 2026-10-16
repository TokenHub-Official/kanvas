import type { CurrentHumanContext } from "@kanvas/contracts/api";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { KanvasSelect } from "./kanvas-select.js";

export type SettingsPageKey =
  | "capabilities"
  | "general"
  | "modelResources"
  | "models"
  | "people"
  | "providers"
  | "sources"
  | "usage"
  | "tasks";

type SettingsWorkspace = CurrentHumanContext["workspaces"][number];
type SettingsRoute =
  | "/w/$workspaceId/settings/capabilities"
  | "/w/$workspaceId/settings/general"
  | "/w/$workspaceId/settings/model-resources"
  | "/w/$workspaceId/settings/models"
  | "/w/$workspaceId/settings/people"
  | "/w/$workspaceId/settings/providers"
  | "/w/$workspaceId/settings/resource-sources"
  | "/w/$workspaceId/settings/usage"
  | "/w/$workspaceId/settings/tasks";

interface SettingsNavigationItem {
  readonly key: SettingsPageKey;
  readonly labelKey: string;
  readonly permission:
    | "capability.configure"
    | "credential.manage"
    | "membership.manage"
    | "audit.read"
    | "usage.read"
    | "workspace.manage";
  readonly to: SettingsRoute;
}

const settingsNavigation = [
  {
    key: "general",
    labelKey: "general",
    permission: "workspace.manage",
    to: "/w/$workspaceId/settings/general",
  },
  {
    key: "people",
    labelKey: "people",
    permission: "membership.manage",
    to: "/w/$workspaceId/settings/people",
  },
  {
    key: "providers",
    labelKey: "providers",
    permission: "credential.manage",
    to: "/w/$workspaceId/settings/models",
  },
  {
    key: "sources",
    labelKey: "sources",
    permission: "credential.manage",
    to: "/w/$workspaceId/settings/resource-sources",
  },
  {
    key: "modelResources",
    labelKey: "modelResources",
    permission: "capability.configure",
    to: "/w/$workspaceId/settings/model-resources",
  },
  {
    key: "capabilities",
    labelKey: "capabilities",
    permission: "capability.configure",
    to: "/w/$workspaceId/settings/capabilities",
  },
  {
    key: "usage",
    labelKey: "usage",
    permission: "usage.read",
    to: "/w/$workspaceId/settings/usage",
  },
  {
    key: "tasks",
    labelKey: "tasks",
    permission: "audit.read",
    to: "/w/$workspaceId/settings/tasks",
  },
] as const satisfies readonly SettingsNavigationItem[];

export function canAccessSettings(workspace: SettingsWorkspace): boolean {
  return settingsNavigation.some((item) =>
    workspace.permissions.includes(item.permission),
  );
}

export function firstSettingsRoute(
  workspace: SettingsWorkspace,
): SettingsRoute | undefined {
  for (const item of settingsNavigation) {
    if (workspace.permissions.includes(item.permission)) {
      return item.to;
    }
  }
  return undefined;
}

export function SettingsShell({
  active,
  children,
  workspace,
}: {
  readonly active: SettingsPageKey;
  readonly children: ReactNode;
  readonly workspace: SettingsWorkspace;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const visibleItems = settingsNavigation.filter((item) =>
    workspace.permissions.includes(item.permission),
  );

  function openSettingsItem(key: string): void {
    const destination = visibleItems.find((item) => item.key === key);
    if (!destination) {
      return;
    }
    void navigate({
      params: { workspaceId: workspace.id },
      to: destination.to,
    });
  }

  return (
    <div className="mx-auto w-full max-w-350 pb-12">
      <nav
        aria-label={t("settings.shell.navigation")}
        className="mb-9 hidden min-w-0 md:block"
      >
        <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-[14px] bg-paper/55 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleItems.map((item) => (
            <Link
              aria-current={active === item.key ? "page" : undefined}
              className="inline-flex min-h-9.5 shrink-0 items-center rounded-[10px] px-3.5 text-[13px] font-semibold text-muted no-underline transition-[color,background-color,box-shadow] duration-150 hover:bg-paper/70 hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary aria-[current=page]:bg-paper aria-[current=page]:text-primary aria-[current=page]:shadow-[0_3px_10px_rgb(35_32_68_/_8%)]"
              key={item.key}
              params={{ workspaceId: workspace.id }}
              preload="render"
              to={item.to}
            >
              {t(`settings.shell.items.${item.labelKey}`)}
            </Link>
          ))}
        </div>
      </nav>
      <div className="mb-6 min-w-0 md:hidden">
        <KanvasSelect
          aria-label={t("settings.shell.navigation")}
          className="w-full"
          onChange={openSettingsItem}
          options={visibleItems.map((item) => ({
            label: t(`settings.shell.items.${item.labelKey}`),
            value: item.key,
          }))}
          size="large"
          value={active}
        />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsPageHeader({
  action,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly description?: ReactNode;
  readonly title: string;
}): React.JSX.Element {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-5">
      <div className="max-w-180">
        <h2 className="text-2xl font-semibold tracking-[-0.025em]">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-170 text-sm leading-6 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
