import { ArrowRightOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, Button, Spin, type AlertProps } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../lib/cn.js";

const noticeTypes = {
  danger: "error",
  info: "info",
  positive: "success",
  warning: "warning",
} as const satisfies Record<
  "info" | "positive" | "warning" | "danger",
  NonNullable<AlertProps["type"]>
>;

function StateModule({
  action,
  actionLabel,
  actionPending = false,
  actionPendingLabel,
  children,
  headingLevel = "h2",
  kind,
  title,
}: {
  readonly action?: () => void;
  readonly actionLabel?: string;
  readonly actionPending?: boolean;
  readonly actionPendingLabel?: string;
  readonly children?: ReactNode;
  readonly headingLevel?: "h1" | "h2" | "p";
  readonly kind: "empty" | "loading";
  readonly title: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const Heading = headingLevel;
  return (
    <div
      aria-busy={kind === "loading" || undefined}
      aria-live={kind === "loading" ? "polite" : undefined}
      className="mx-auto grid min-h-56 w-full max-w-[560px] place-content-center justify-items-center px-6 py-14 text-center"
      data-state-module={kind}
      role={kind === "loading" ? "status" : undefined}
    >
      <div
        aria-hidden="true"
        className="mb-5 grid size-14 place-items-center rounded-[18px] bg-primary-soft text-primary"
      >
        {kind === "loading" ? (
          <Spin size="large" />
        ) : (
          <InboxOutlined className="text-2xl" />
        )}
      </div>
      <Heading
        {...(headingLevel === "h1"
          ? {
              "data-page-focus-target": true,
              tabIndex: -1,
            }
          : {})}
        className={cn(
          "m-0 text-ink",
          headingLevel === "h1"
            ? "text-ui-headline font-bold tracking-[-0.025em]"
            : "text-ui-title font-semibold tracking-[-0.01em]",
        )}
      >
        {title}
      </Heading>
      {children ? (
        <div className="mt-2 max-w-[52ch] text-ui-body leading-6 text-muted">
          {children}
        </div>
      ) : null}
      {action && actionLabel ? (
        <Button
          aria-busy={actionPending || undefined}
          className="mt-6"
          disabled={actionPending}
          icon={!actionPending ? <ArrowRightOutlined /> : undefined}
          iconPlacement="end"
          loading={actionPending}
          onClick={action}
          type="primary"
        >
          {actionPending
            ? (actionPendingLabel ?? t("common.feedback.retrying"))
            : actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function InlineNotice({
  action,
  children,
  className,
  closable,
  title,
  tone = "info",
}: {
  readonly action?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly closable?: AlertProps["closable"];
  readonly title: ReactNode;
  readonly tone?: "info" | "positive" | "warning" | "danger";
}): React.JSX.Element {
  return (
    <Alert
      action={action}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={cn("border-0", className)}
      classNames={{
        title: "text-ui-label font-bold leading-5",
        description: "text-ui-label leading-5 text-muted",
      }}
      {...(closable === undefined ? {} : { closable })}
      description={children}
      role={tone === "danger" ? "alert" : "status"}
      showIcon
      title={title}
      type={noticeTypes[tone]}
      variant="filled"
    />
  );
}

export function EmptyState({
  action,
  actionLabel,
  actionPending = false,
  actionPendingLabel,
  children,
  headingLevel = "h2",
  title,
}: {
  readonly action?: () => void;
  readonly actionLabel?: string;
  readonly actionPending?: boolean;
  readonly actionPendingLabel?: string;
  readonly children: ReactNode;
  readonly headingLevel?: "h1" | "h2";
  readonly title: string;
}): React.JSX.Element {
  return (
    <StateModule
      {...(action ? { action } : {})}
      {...(actionLabel ? { actionLabel } : {})}
      actionPending={actionPending}
      {...(actionPendingLabel ? { actionPendingLabel } : {})}
      headingLevel={headingLevel}
      kind="empty"
      title={title}
    >
      {children}
    </StateModule>
  );
}

export function LoadingState({
  label,
}: {
  readonly label: string;
}): React.JSX.Element {
  return <StateModule headingLevel="p" kind="loading" title={label} />;
}

export function PageEmptyState({
  action,
  actionLabel,
  actionPending,
  actionPendingLabel,
  children,
  title,
}: {
  readonly action?: () => void;
  readonly actionLabel?: string;
  readonly actionPending?: boolean;
  readonly actionPendingLabel?: string;
  readonly children: ReactNode;
  readonly title: string;
}): React.JSX.Element {
  return (
    <EmptyState
      {...(action ? { action } : {})}
      {...(actionLabel ? { actionLabel } : {})}
      {...(actionPending === undefined ? {} : { actionPending })}
      {...(actionPendingLabel ? { actionPendingLabel } : {})}
      headingLevel="h1"
      title={title}
    >
      {children}
    </EmptyState>
  );
}

export function PageLoading({
  label,
}: {
  readonly label?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-screen place-items-center bg-mist px-6">
      <StateModule
        headingLevel="p"
        kind="loading"
        title={label ?? t("common.feedback.loading")}
      />
    </div>
  );
}
