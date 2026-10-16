import { FileImageOutlined, LoadingOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchCanvasDraft } from "../api/transport.js";
import { artifactPreviewQueryOptionsV1 } from "./artifact-preview-query.js";
import { CanvasPageV1 } from "../features/editor/canvas-node-renderer-v1.js";
import {
  editorDocumentV1ArtifactIds,
  normalizeEditorDocumentV1,
  type EditorArtifactRuntimeResourceV1,
} from "../features/editor/editor-document-v1.js";
import { createEditorRuntimeDocumentV1 } from "../features/editor/editor-runtime-v1.js";
export function CanvasDraftPreview({
  canvasDraftId,
  version,
  workspaceId,
}: {
  readonly canvasDraftId: string;
  readonly version: number;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const draft = useQuery({
    queryKey: ["canvas-draft-preview", workspaceId, canvasDraftId, version],
    queryFn: () => fetchCanvasDraft(workspaceId, canvasDraftId),
    retry: false,
    staleTime: 30_000,
  });
  const [previewResources, setPreviewResources] = useState<
    ReadonlyMap<string, EditorArtifactRuntimeResourceV1>
  >(() => new Map());
  const previewSourceDocument = useMemo(() => {
    if (!draft.data) return undefined;
    const document = normalizeEditorDocumentV1(draft.data.document);
    return {
      ...document,
      pages: document.pages.slice(0, 1),
    };
  }, [draft.data]);
  const previewDocument = useMemo(
    () =>
      previewSourceDocument
        ? createEditorRuntimeDocumentV1(previewSourceDocument)
        : undefined,
    [previewSourceDocument],
  );

  useEffect(() => {
    if (!previewSourceDocument) {
      return;
    }
    let disposed = false;
    const urls = new Set<string>();
    void Promise.all(
      editorDocumentV1ArtifactIds(previewSourceDocument).map(
        async (artifactId) => {
          try {
            const blob = await queryClient.fetchQuery(
              artifactPreviewQueryOptionsV1(workspaceId, artifactId),
            );
            const url = URL.createObjectURL(blob);
            if (disposed) {
              URL.revokeObjectURL(url);
              throw new DOMException(
                "Canvas draft preview was disposed.",
                "AbortError",
              );
            }
            urls.add(url);
            setPreviewResources((current) => {
              if (disposed) return current;
              const resources = new Map(current);
              resources.set(artifactId, {
                artifactId,
                sourceQuality: "preview",
                sourceUnavailable: false,
                sourceUrl: url,
              });
              return resources;
            });
          } catch {
            if (!disposed) {
              setPreviewResources((current) => {
                const resources = new Map(current);
                resources.set(artifactId, {
                  artifactId,
                  sourceUnavailable: true,
                });
                return resources;
              });
            }
          }
        },
      ),
    );
    return () => {
      disposed = true;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [previewSourceDocument, queryClient, workspaceId]);

  const page = previewDocument?.pages[0];
  if (page) {
    return <CanvasPageV1 clipToPage page={page} resources={previewResources} />;
  }

  const unavailable = draft.isError;
  return (
    <div
      aria-label={
        unavailable
          ? t("studio.home.draftPreviewError")
          : t("studio.home.draftPreviewLoading")
      }
      className="grid size-full place-items-center text-xl text-primary"
      role={unavailable ? "img" : "status"}
    >
      {unavailable ? (
        <FileImageOutlined aria-hidden="true" />
      ) : (
        <LoadingOutlined aria-hidden="true" spin />
      )}
    </div>
  );
}
