import type { EditorNodeV1 } from "@kanvas/contracts/editor";
import { canvasExportBlobDataUrlV1 } from "../editor/canvas-export-v1.js";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";
import {
  deliverAgentCanvasExport,
  executeAgentCanvasExport,
} from "./agent-canvas-export-recovery.js";
import type {
  CompleteAgentCanvasExportBody,
  AgentThreadView,
} from "@kanvas/contracts/api";
import {
  completeAgentCanvasExport,
  downloadArtifact,
  fetchCanvasDraftRevision,
  fetchWorkspaceFontCatalog,
} from "../../api/transport.js";
import { CanvasPageV1 } from "../editor/canvas-node-renderer-v1.js";
import {
  editorDocumentV1ArtifactIds,
  normalizeEditorDocumentV1,
  type EditorArtifactRuntimeResourceV1,
} from "../editor/editor-document-v1.js";
import { createEditorRuntimeDocumentV1 } from "../editor/editor-runtime-v1.js";
import { useCanvasExportV1 } from "../editor/use-canvas-export-v1.js";

const maximumErrorMessageLength = 4_000;

type Request = NonNullable<AgentThreadView["pendingCanvasExports"]>[number];
type Loaded = {
  fontCss: string;
  document: ReturnType<typeof createEditorRuntimeDocumentV1>;
  resources: Map<string, EditorArtifactRuntimeResourceV1>;
};

export function AgentCanvasExportExecutor({
  request,
  workspaceId,
  csrfToken,
}: {
  request: Request;
  workspaceId: string;
  csrfToken: string;
}) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [sourceFailure, setSourceFailure] = useState<string>();
  const { t } = useTranslation();
  useEffect(() => {
    let disposed = false;
    const urls: string[] = [];
    const faces: FontFace[] = [];
    void (async () => {
      const snapshot = await fetchCanvasDraftRevision(
        workspaceId,
        request.canvasDraftId,
        request.documentVersion,
      );
      const source = normalizeEditorDocumentV1(snapshot.document);
      const selectedPage = source.pages.find(
        (page) => page.id === request.pageId,
      );
      if (!selectedPage)
        throw new Error("The requested Canvas page is unavailable.");
      const document = { ...source, pages: [selectedPage] };
      const resources = new Map<string, EditorArtifactRuntimeResourceV1>();
      await Promise.all(
        editorDocumentV1ArtifactIds(document).map(async (artifactId) => {
          const blob = await downloadArtifact(workspaceId, artifactId);
          if (disposed) return;
          const sourceUrl = URL.createObjectURL(blob);
          urls.push(sourceUrl);
          resources.set(artifactId, {
            artifactId,
            sourceUrl,
            sourceUnavailable: false,
            sourceQuality: "original",
          });
        }),
      );
      const requestedFonts = new Map<
        string,
        { family: string; revision: string }
      >();
      const visit = (nodes: readonly EditorNodeV1[]): void => {
        for (const node of nodes) {
          if (node.kind === "group") visit(node.children);
          if (node.kind === "text")
            for (const paragraph of node.content.paragraphs)
              for (const run of paragraph.runs) {
                if (
                  run.font.source === "workspace" ||
                  run.font.source === "brand"
                )
                  requestedFonts.set(run.font.family, {
                    family: run.font.family,
                    revision: run.font.revision ?? run.font.fontId,
                  });
              }
        }
      };
      visit(selectedPage.nodes);
      const css: string[] = [];
      if (requestedFonts.size) {
        const catalog = await fetchWorkspaceFontCatalog(workspaceId);
        for (const font of requestedFonts.values()) {
          const revision = catalog.fonts.find(
            (item) => item.id === font.revision,
          );
          if (!revision)
            throw new Error(
              `The fixed font revision for ${font.family} is unavailable.`,
            );
          for (const file of revision.files) {
            const dataUrl = await canvasExportBlobDataUrlV1(
              await downloadArtifact(workspaceId, file.artifactId),
            );
            if (disposed) return;
            const face = new FontFace(font.family, `url(${dataUrl})`, {
              style: file.style,
              weight: String(file.weight),
            });
            await face.load();
            if (disposed) return;
            globalThis.document.fonts.add(face);
            faces.push(face);
            css.push(
              `@font-face{font-family:${JSON.stringify(font.family)};font-style:${file.style};font-weight:${file.weight};src:url(${JSON.stringify(dataUrl)})}`,
            );
          }
        }
      }
      if (!disposed)
        setLoaded({
          fontCss: css.join("\n"),
          document: createEditorRuntimeDocumentV1(document),
          resources,
        });
    })().catch(async (error) => {
      if (!disposed)
        await deliverAgentCanvasExport(() =>
          completeAgentCanvasExport(
            { workspaceId, csrfToken },
            request.actionReceiptId,
            {
              error: {
                code: "canvas_export.source_unavailable",
                message:
                  error instanceof Error
                    ? error.message.slice(0, maximumErrorMessageLength)
                    : "Canvas source could not be loaded.",
              },
            },
          ),
        ).catch((reportError) => {
          if (!disposed)
            setSourceFailure(
              reportError instanceof Error
                ? reportError.message
                : String(reportError),
            );
        });
    });
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
      faces.forEach((face) => globalThis.document.fonts.delete(face));
    };
  }, [
    workspaceId,
    csrfToken,
    request.actionReceiptId,
    request.canvasDraftId,
    request.documentVersion,
    request.pageId,
  ]);
  if (sourceFailure)
    return (
      <Alert
        type="error"
        title={t("agent.exportSyncFailed")}
        description={sourceFailure}
      />
    );
  return loaded ? (
    <RenderExport
      request={request}
      workspaceId={workspaceId}
      csrfToken={csrfToken}
      loaded={loaded}
    />
  ) : null;
}

function RenderExport({
  request,
  workspaceId,
  csrfToken,
  loaded,
}: {
  request: Request;
  workspaceId: string;
  csrfToken: string;
  loaded: Loaded;
}) {
  const draftIdRef = useRef<string | undefined>(request.canvasDraftId);
  const { t } = useTranslation();
  const [deliveryError, setDeliveryError] = useState<string>();
  const [hasCompletion, setHasCompletion] = useState(false);
  const completionRef = useRef<CompleteAgentCanvasExportBody | undefined>(
    undefined,
  );
  const exporter = useCanvasExportV1({
    agentExportScope: {
      documentVersion: request.documentVersion,
      pageId: request.pageId,
    },
    activePageId: request.pageId,
    canDownloadExport: true,
    canExport: true,
    csrfToken,
    document: loaded.document,
    draftId: draftIdRef,
    ensureSnapshot: () =>
      Promise.resolve({
        canvasDraftId: request.canvasDraftId,
        documentVersion: request.documentVersion,
      }),
    title: loaded.document.title,
    workspaceId,
  });
  const exporterRef = useRef(exporter);
  useEffect(() => {
    exporterRef.current = exporter;
  }, [exporter]);
  const { actionReceiptId, canvasDraftId, documentVersion, pageId } = request;
  async function retryDelivery(): Promise<void> {
    const completion = completionRef.current;
    if (!completion) return;
    setDeliveryError(undefined);
    try {
      await deliverAgentCanvasExport(() =>
        completeAgentCanvasExport(
          { workspaceId, csrfToken },
          actionReceiptId,
          completion,
        ),
      );
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    let disposed = false;
    const current = exporterRef.current;
    const lifetime = new AbortController();
    void executeAgentCanvasExport({
      signal: lifetime.signal,
      ready: document.fonts.ready,
      render: () =>
        current.exportPngForAgent({
          actionReceiptId,
          canvasDraftId,
          documentVersion,
          pageId,
        }),
      cancel: current.cancelExport,
      remember: (completion) => {
        completionRef.current = completion;
        if (!disposed) setHasCompletion(true);
      },
      report: (completion) =>
        completeAgentCanvasExport(
          { workspaceId, csrfToken },
          actionReceiptId,
          completion,
        ),
    }).catch((error) => {
      if (!disposed)
        setDeliveryError(
          error instanceof Error ? error.message : String(error),
        );
    });
    return () => {
      disposed = true;
      lifetime.abort();
    };
  }, [
    actionReceiptId,
    canvasDraftId,
    documentVersion,
    pageId,
    workspaceId,
    csrfToken,
  ]);
  return (
    <>
      {deliveryError ? (
        <Alert
          type="error"
          title={t("agent.exportSyncFailed")}
          description={deliveryError}
          action={
            hasCompletion ? (
              <Button onClick={() => void retryDelivery()}>
                {t("agent.exportSyncRetry")}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {loaded.document.pages
        .filter((page) => page.id === request.pageId)
        .map((page) => (
          <svg
            key={page.id}
            aria-hidden="true"
            className="invisible fixed top-[-100000px] left-[-100000px]"
            ref={(node) => exporter.registerExportSource(page.id, node)}
            viewBox={`0 0 ${page.width} ${page.height}`}
          >
            {loaded.fontCss ? <style>{loaded.fontCss}</style> : null}
            <CanvasPageV1 clipToPage page={page} resources={loaded.resources} />
          </svg>
        ))}
    </>
  );
}
