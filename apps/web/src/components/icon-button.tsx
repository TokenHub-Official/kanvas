import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "../lib/cn.js";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly children: ReactNode;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly selected?: boolean;
}

export function IconButton({
  buttonRef,
  children,
  className,
  label,
  selected,
  type = "button",
  ...properties
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-control border border-transparent text-muted transition",
        "hover:bg-mist hover:text-ink",
        selected === true && "bg-ink text-white hover:bg-ink hover:text-white",
        className,
      )}
      ref={buttonRef}
      type={type}
      {...properties}
    >
      {children}
    </button>
  );
}
