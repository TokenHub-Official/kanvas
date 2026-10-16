import type { CSSProperties } from "react";

import { cn } from "../lib/cn.js";

interface DoodleIconProperties {
  readonly aspectRatio: `${number} / ${number}`;
  readonly className?: string;
  readonly source: string;
}

export function DoodleIcon({
  aspectRatio,
  className,
  source,
}: DoodleIconProperties): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "doodle-icon inline-block shrink-0 bg-current align-middle [mask-image:var(--doodle-icon-source)] [mask-mode:alpha] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]",
        className,
      )}
      style={
        {
          "--doodle-icon-source": `url("${source}")`,
          aspectRatio,
        } as CSSProperties
      }
    />
  );
}
