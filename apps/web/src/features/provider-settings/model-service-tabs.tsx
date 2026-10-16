import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function ModelServiceTabs({
  active,
  workspaceId,
}: {
  readonly active: "models" | "providers";
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("settings.modelServices.navigation")}
      className="mb-6 flex gap-1 border-b border-ink/8"
    >
      {(
        [
          ["models", "/w/$workspaceId/settings/models"],
          ["providers", "/w/$workspaceId/settings/providers"],
        ] as const
      ).map(([key, to]) => (
        <Link
          aria-current={active === key ? "page" : undefined}
          className="border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-muted no-underline hover:text-ink aria-[current=page]:border-primary aria-[current=page]:text-primary"
          key={key}
          params={{ workspaceId }}
          to={to}
        >
          {t(`settings.modelServices.tabs.${key}`)}
        </Link>
      ))}
    </nav>
  );
}
