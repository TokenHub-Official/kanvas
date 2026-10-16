import { ArrowLeftOutlined } from "@ant-design/icons";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn.js";
import { workspaceResourceNavigation } from "./app-shell-model.js";

export function ResourceNavigation({
  workspaceId,
  permissions,
  path,
  returnTo,
  onNavigate,
}: {
  readonly workspaceId: string;
  readonly permissions: readonly string[];
  readonly path: string;
  readonly returnTo: string;
  readonly onNavigate: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col px-3 pb-4">
      <Link
        to={returnTo}
        onClick={onNavigate}
        className="mb-5 flex items-center gap-2 rounded-control px-3 py-2 text-sm text-muted no-underline hover:bg-paper focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ArrowLeftOutlined />
        {t("common.appShell.returnToWorkbench")}
      </Link>
      <div className="mb-3 px-3 text-xs text-muted">
        {t("agent.navigation.manage")}
      </div>
      <nav
        aria-label={t("agent.navigation.manage")}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {workspaceResourceNavigation(permissions).map((item) => {
          const target = item.to.replace("$workspaceId", workspaceId);
          const active = path === target || path.startsWith(`${target}/`);
          return (
            <Link
              key={item.key}
              to={item.to}
              params={{ workspaceId }}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "mb-1 flex rounded-control px-3 py-2.5 text-sm text-ink no-underline hover:bg-paper focus-visible:outline-2 focus-visible:outline-primary",
                active && "bg-paper font-semibold",
              )}
            >
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
