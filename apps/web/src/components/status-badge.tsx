import type { PropsWithChildren } from "react";

import { cn } from "../lib/cn.js";

export type StatusBadgeTone = "neutral" | "positive" | "warning" | "danger";

export function StatusBadge({
  children,
  className,
  tone = "neutral",
}: PropsWithChildren<{
  readonly className?: string;
  readonly tone?: StatusBadgeTone;
}>): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 text-ui-label font-bold",
        tone === "neutral" && "bg-mist text-muted",
        tone === "positive" && "bg-positive-surface text-positive",
        tone === "warning" &&
          "bg-[var(--warning-surface)] text-[var(--warning)]",
        tone === "danger" && "bg-danger-surface text-danger",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          tone === "neutral" && "opacity-60",
        )}
      />
      {children}
    </span>
  );
}
