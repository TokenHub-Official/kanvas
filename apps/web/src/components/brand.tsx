import kanvasMark from "../assets/brand/kanvas-mark.svg";
import { cn } from "../lib/cn.js";

export function Brand({
  compact = false,
  className,
  markSize = "default",
}: {
  readonly compact?: boolean;
  readonly className?: string;
  readonly markSize?: "default" | "large";
}): React.JSX.Element {
  return (
    <span
      aria-label="Kanvas"
      className={cn(
        "inline-flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em]",
        className,
      )}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn(
          "brand-mark size-[22px] shrink-0",
          markSize === "large" && "size-7",
        )}
        height={28}
        src={kanvasMark}
        width={28}
      />
      {compact ? null : <span>Kanvas</span>}
    </span>
  );
}
