import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export type WorkflowModule = "workflows" | "templates" | "runs";

export const workflowPrimaryModules = ["templates", "runs"] as const;

export function WorkflowModuleNav({
  active,
  workspaceId,
}: {
  readonly active: WorkflowModule;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const primaryItems = workflowPrimaryModules.map((id) => ({
    id,
    label: t(`workflows.nav.${id}`),
    to:
      id === "templates"
        ? ("/w/$workspaceId/workflow-templates" as const)
        : ("/w/$workspaceId/workflow-runs" as const),
  }));
  const itemClassName =
    "inline-flex min-h-9.5 shrink-0 items-center rounded-[10px] px-3.5 text-[13px] font-semibold text-muted no-underline transition-[color,background-color,box-shadow] duration-150 hover:bg-paper/70 hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary aria-[current=page]:bg-paper aria-[current=page]:text-primary aria-[current=page]:shadow-[0_3px_10px_rgb(35_32_68_/_8%)]";

  return (
    <nav
      aria-label={t("workflows.nav.label")}
      className="mb-8 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="inline-flex max-w-full gap-1 rounded-[14px] bg-paper/55 p-1">
        {primaryItems.map((item) => (
          <Link
            aria-current={active === item.id ? "page" : undefined}
            className={itemClassName}
            key={item.id}
            params={{ workspaceId }}
            to={item.to}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
