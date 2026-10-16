import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageLoading } from "../components/feedback.js";
import { safeReturnTo } from "../auth/entry-recovery.js";
import { rootRoute } from "./root.js";

function BoardPending(): React.JSX.Element {
  const { t } = useTranslation();
  return <PageLoading label={t("canvas.loading")} />;
}

export const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/boards/$canvasDraftId",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    readonly brandKitRevisionId?: string;
    readonly importImage: boolean;
    readonly importToken?: string;
    readonly returnTo?: string;
    readonly withoutBrand?: boolean;
  } => {
    const returnTo = safeReturnTo(search.returnTo);
    return {
      importImage: search.importImage === true || search.importImage === "true",
      ...(search.withoutBrand === true || search.withoutBrand === "true"
        ? { withoutBrand: true }
        : {}),
      ...(typeof search.brandKitRevisionId === "string" &&
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.brandKitRevisionId)
        ? { brandKitRevisionId: search.brandKitRevisionId }
        : {}),
      ...(typeof search.importToken === "string" &&
      search.importToken.length > 0
        ? { importToken: search.importToken }
        : {}),
      ...(returnTo ? { returnTo } : {}),
    };
  },
  component: lazyRouteComponent(() => import("./board-page.js"), "BoardPage"),
  pendingComponent: BoardPending,
});
