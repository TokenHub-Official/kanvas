import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function SkipLink({
  children,
  targetId,
}: {
  readonly children?: ReactNode;
  readonly targetId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <a
      className="fixed top-3 left-3 z-[120] -translate-y-[calc(100%+20px)] rounded-control bg-ink px-4 py-3 text-ui-label font-bold text-white shadow-floating transition-transform duration-150 focus:translate-y-0 motion-reduce:transition-none"
      href={`#${targetId}`}
    >
      {children ?? t("common.skipToContent")}
    </a>
  );
}
