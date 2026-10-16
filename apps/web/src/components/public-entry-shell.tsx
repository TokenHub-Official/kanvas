import { Button } from "antd";
import type { ReactNode } from "react";

import { cn } from "../lib/cn.js";
import { Brand } from "./brand.js";

interface PublicEntryAction {
  readonly icon: ReactNode;
  readonly iconPlacement?: "end" | "start";
  readonly label: string;
  readonly loading?: boolean;
  readonly onClick: () => void;
}

export function PublicEntryShell({
  children,
  contentClassName,
  headerEnd,
}: {
  readonly children: ReactNode;
  readonly contentClassName?: string;
  readonly headerEnd?: ReactNode;
}): React.JSX.Element {
  return (
    <main className="grid min-h-svh grid-rows-[72px_1fr] bg-[var(--mist)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-5 sm:px-8">
        <Brand />
        {headerEnd ? (
          <div className="min-w-0 text-xs text-[var(--muted)]">{headerEnd}</div>
        ) : null}
      </header>
      <div
        className={cn(
          "grid min-h-0 place-items-center px-5 py-10 sm:px-8 sm:py-14",
          contentClassName,
        )}
      >
        {children}
      </div>
    </main>
  );
}

const resultIconToneClasses = {
  danger: "bg-[var(--danger-surface)] text-[var(--danger)]",
  neutral: "bg-[var(--primary-soft)] text-[var(--primary)]",
  success: "bg-[var(--positive-surface)] text-[var(--positive)]",
  warning: "bg-[var(--warning-surface)] text-[var(--warning)]",
} as const;

export function PublicResult({
  description,
  icon,
  primaryAction,
  secondaryAction,
  title,
  tone = "neutral",
  visualVariant = "symbol",
}: {
  readonly description?: string;
  readonly icon: ReactNode;
  readonly primaryAction?: PublicEntryAction;
  readonly secondaryAction?: PublicEntryAction;
  readonly title: string;
  readonly tone?: keyof typeof resultIconToneClasses;
  readonly visualVariant?: "illustration" | "symbol";
}): React.JSX.Element {
  return (
    <section className="grid w-full max-w-[520px] justify-items-center text-center">
      <div
        aria-hidden="true"
        className={cn(
          "grid place-items-center",
          visualVariant === "illustration"
            ? "h-24 w-24 rounded-[26px]"
            : "size-14 rounded-[18px] text-xl",
          resultIconToneClasses[tone],
        )}
      >
        {icon}
      </div>
      <h1
        className="m-0 mt-7 text-3xl font-bold leading-tight tracking-[-0.04em] text-[var(--ink)] sm:text-[36px]"
        data-page-focus-target
        tabIndex={-1}
      >
        {title}
      </h1>
      {description ? (
        <p className="m-0 mt-3 max-w-[48ch] text-sm leading-6 text-[var(--muted)]">
          {description}
        </p>
      ) : null}
      {primaryAction || secondaryAction ? (
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {primaryAction ? (
            <Button
              icon={
                <span aria-hidden="true" className="inline-flex">
                  {primaryAction.icon}
                </span>
              }
              iconPlacement={primaryAction.iconPlacement ?? "start"}
              {...(primaryAction.loading === undefined
                ? {}
                : { loading: primaryAction.loading })}
              onClick={primaryAction.onClick}
              size="large"
              type="primary"
            >
              {primaryAction.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button
              icon={
                <span aria-hidden="true" className="inline-flex">
                  {secondaryAction.icon}
                </span>
              }
              iconPlacement={secondaryAction.iconPlacement ?? "start"}
              {...(secondaryAction.loading === undefined
                ? {}
                : { loading: secondaryAction.loading })}
              onClick={secondaryAction.onClick}
              size="large"
            >
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
