import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { fetchCanvasDraft } from "../api/transport.js";
import { PageEmptyState, PageLoading } from "../components/feedback.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import {
  clearCanvasImportFiles,
  readCanvasImportFiles,
} from "../features/editor/canvas-import-handoff.js";
import { CanvasWorkspaceV1 } from "../features/editor/canvas-workspace-v1.js";
import {
  editorDocumentV1ArtifactIds,
  normalizeEditorDocumentV1,
} from "../features/editor/editor-document-v1.js";
import { createEditorRuntimeDocumentV1 } from "../features/editor/editor-runtime-v1.js";
import {
  boardEditorMediaQuery,
  focusBoardViewportSurface,
} from "./board-viewport-gate.js";

function BoardDesktopWorkspaceSurface({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    if (window.matchMedia(boardEditorMediaQuery).matches) {
      focusBoardViewportSurface(true);
    }
  }, []);
  return <>{children}</>;
}

async function loadCanvasDraftForEditor(
  workspaceId: string,
  canvasDraftId: string,
) {
  const draft = await fetchCanvasDraft(workspaceId, canvasDraftId);
  const normalized = normalizeEditorDocumentV1(draft.document);

  return {
    artifactIds: editorDocumentV1ArtifactIds(normalized),
    draft,
    document: createEditorRuntimeDocumentV1(normalized),
  };
}

export function BoardDesktopContent({
  canEdit,
  canvasDraftId,
  csrfToken,
  embedded,
  importImageInitially,
  initialBrandKitRevisionId,
  importToken,
  onExit,
  permissions,
  returnTo,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly canvasDraftId: string;
  readonly csrfToken: string;
  readonly embedded?: boolean;
  readonly importImageInitially: boolean;
  readonly initialBrandKitRevisionId?: string | null;
  readonly importToken?: string;
  readonly onExit?: () => void;
  readonly permissions: readonly string[];
  readonly returnTo?: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [createdDraftId, setCreatedDraftId] = useState<string>();
  const isNew = canvasDraftId === "new" || canvasDraftId === createdDraftId;
  const draftQuery = useQuery({
    queryKey: ["canvas-draft-v1", workspaceId, canvasDraftId],
    queryFn: () => loadCanvasDraftForEditor(workspaceId, canvasDraftId),
    enabled: !isNew,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const draftRecovery = usePageQueryRecovery(draftQuery.refetch);

  if (isNew && !canEdit) {
    return (
      <PageEmptyState
        action={() => {
          void navigate({
            to: "/w/$workspaceId",
            params: { workspaceId },
          });
        }}
        actionLabel={t("canvas.backToStudio")}
        title={t("canvas.readOnlyTitle")}
      >
        {t("canvas.readOnlyDescription")}
      </PageEmptyState>
    );
  }

  if (!isNew && draftQuery.isPending) {
    return <PageLoading label={t("canvas.loading")} />;
  }
  if (!isNew && draftQuery.isError) {
    return (
      <PageEmptyState
        action={draftRecovery.retry}
        actionLabel={t("canvas.reload")}
        actionPending={draftRecovery.pending}
        title={t("canvas.loadError")}
      >
        {t("canvas.loadErrorDescription")}
      </PageEmptyState>
    );
  }

  async function commitCreatedDraftRoute(draftId: string): Promise<void> {
    setCreatedDraftId(draftId);
    await navigate({
      to: "/w/$workspaceId/boards/$canvasDraftId",
      params: {
        workspaceId,
        canvasDraftId: draftId,
      },
      search: {
        importImage: false,
      },
      replace: true,
    });
  }

  return (
    <BoardDesktopWorkspaceSurface>
      <CanvasWorkspaceV1
        canEdit={canEdit}
        csrfToken={csrfToken}
        {...(embedded ? { embedded: true } : {})}
        {...(draftQuery.data
          ? {
              initialArtifactIds: draftQuery.data.artifactIds,
              initialDocument: draftQuery.data.document,
              initialDraft: draftQuery.data.draft,
            }
          : {})}
        {...(importImageInitially
          ? { initialPanel: "materials" as const }
          : {})}
        initialImportFiles={readCanvasImportFiles(importToken)}
        {...(initialBrandKitRevisionId !== undefined
          ? { initialBrandKitRevisionId }
          : {})}
        onInitialImportFilesConsumed={() => {
          clearCanvasImportFiles(importToken);
        }}
        onDraftCreated={commitCreatedDraftRoute}
        {...(onExit ? { onExit } : {})}
        permissions={permissions}
        {...(returnTo ? { returnTo } : {})}
        workspaceId={workspaceId}
      />
    </BoardDesktopWorkspaceSurface>
  );
}
