import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { PageLoading } from "../components/feedback.js";
import { WorkspaceBoundary } from "../components/workspace-page.js";
import { BoardViewportGate } from "./board-viewport-gate.js";

const boardRouteApi = getRouteApi("/w/$workspaceId/boards/$canvasDraftId");

const BoardDesktopContent = lazy(async () => {
  const module = await import("./board-desktop-content.js");
  return { default: module.BoardDesktopContent };
});

export function BoardPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { workspaceId, canvasDraftId } = boardRouteApi.useParams();
  const search = boardRouteApi.useSearch();
  let initialBrandKitRevisionId: string | null | undefined;
  if (search.brandKitRevisionId) {
    initialBrandKitRevisionId = search.brandKitRevisionId;
  } else if (search.withoutBrand) {
    initialBrandKitRevisionId = null;
  }

  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <BoardViewportGate
          onBack={() => {
            if (search.returnTo) {
              window.location.assign(search.returnTo);
            } else {
              void navigate({
                to: "/w/$workspaceId",
                params: { workspaceId: workspace.id },
              });
            }
          }}
        >
          <Suspense fallback={<PageLoading label={t("canvas.loading")} />}>
            <BoardDesktopContent
              canEdit={
                workspace.permissions.includes("asset.write") &&
                workspace.permissions.includes("canvas.write")
              }
              canvasDraftId={canvasDraftId}
              {...(initialBrandKitRevisionId !== undefined
                ? { initialBrandKitRevisionId }
                : {})}
              csrfToken={context.csrfToken}
              importImageInitially={search.importImage}
              {...(search.importToken
                ? { importToken: search.importToken }
                : {})}
              workspaceId={workspace.id}
              permissions={workspace.permissions}
              {...(search.returnTo ? { returnTo: search.returnTo } : {})}
            />
          </Suspense>
        </BoardViewportGate>
      )}
    </WorkspaceBoundary>
  );
}
