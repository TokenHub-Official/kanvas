import { ApartmentOutlined } from "@ant-design/icons";
import { Link } from "@tanstack/react-router";
import { Breadcrumb } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function WorkflowPageHeader({
  action,
  title,
}: {
  readonly action?: ReactNode;
  readonly title: string;
}): React.JSX.Element {
  return (
    <header className="pt-1.5 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="m-0 text-[30px] leading-[1.2] font-bold tracking-[-0.03em] text-ink">
          {title}
        </h2>
        {action}
      </div>
    </header>
  );
}

export function WorkflowAuthoringLink({
  workspaceId,
}: {
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Link
      className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-primary-soft px-3.5 text-[13px] font-semibold text-primary no-underline transition-[color,background-color,box-shadow] hover:bg-mist-deep hover:text-primary-deep hover:shadow-[0_3px_10px_rgb(35_32_68_/_8%)] focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary"
      params={{ workspaceId }}
      to="/w/$workspaceId/workflows"
    >
      <ApartmentOutlined aria-hidden="true" />
      {t("workflows.nav.workflows")}
    </Link>
  );
}

export function WorkflowAuthoringBreadcrumb({
  workspaceId,
}: {
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("workflows.nav.authoringBreadcrumb")} className="mb-8">
      <Breadcrumb
        items={[
          {
            title: (
              <Link
                className="text-muted no-underline hover:text-primary"
                params={{ workspaceId }}
                to="/w/$workspaceId/workflow-templates"
              >
                {t("workflows.nav.root")}
              </Link>
            ),
          },
          { title: t("workflows.nav.workflows") },
        ]}
      />
    </nav>
  );
}
