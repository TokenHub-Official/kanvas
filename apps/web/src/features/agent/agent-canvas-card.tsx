import type { AgentThreadView } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "antd";
import { useTranslation } from "react-i18next";

import {
  fetchCanvasDraft,
  fetchCanvasDraftRevision,
} from "../../api/transport.js";
import { CanvasPageV1 } from "../editor/canvas-node-renderer-v1.js";
import { normalizeEditorDocumentV1 } from "../editor/editor-document-v1.js";
import { createEditorRuntimeDocumentV1 } from "../editor/editor-runtime-v1.js";

type CanvasRelatedContent = AgentThreadView["relatedContent"][number];

const emptyResources = new Map();

export function AgentCanvasCard({
  canRead,
  item,
  returnTo,
  snapshot = false,
  workspaceId,
}: {
  readonly canRead: boolean;
  readonly item: CanvasRelatedContent;
  readonly returnTo: string;
  readonly snapshot?: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const draft = useQuery({
    queryKey: [
      "agent-canvas-preview",
      workspaceId,
      item.resourceId,
      snapshot ? item.version : "current",
    ],
    queryFn: async () => {
      const result =
        snapshot && item.version
          ? await fetchCanvasDraftRevision(
              workspaceId,
              item.resourceId,
              item.version,
            )
          : await fetchCanvasDraft(workspaceId, item.resourceId);
      return { document: result.document };
    },
    enabled: canRead && item.state === "available",
    retry: false,
    staleTime: 10_000,
  });
  const document = draft.data
    ? createEditorRuntimeDocumentV1(
        normalizeEditorDocumentV1(draft.data.document),
      )
    : undefined;
  const title =
    draft.data?.document.title ?? item.title ?? t("agent.canvasAttached");
  const pageCount = document?.pages.length ?? item.pageCount;
  const page = document?.pages[0];
  const available = canRead && item.state === "available" && !draft.isError;
  let preview = (
    <div className="grid size-full place-items-center rounded-[10px] bg-paper px-5 text-center text-sm text-ink-muted">
      {t("agent.canvasUnavailable")}
    </div>
  );
  if (draft.isPending && available) {
    preview = <Skeleton.Image active className="!h-full !w-full" />;
  } else if (page) {
    preview = (
      <div
        aria-label={t("agent.canvasPreview", { title })}
        className="grid size-full place-items-center overflow-hidden rounded-[10px] bg-white shadow-sm [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
      >
        <CanvasPageV1 clipToPage page={page} resources={emptyResources} />
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[16px] bg-mist text-ink">
      <div className="aspect-[16/10] bg-mist-deep p-3">{preview}</div>
      <div className="grid gap-1 p-4">
        <strong className="truncate text-sm">{title}</strong>
        {pageCount ? (
          <span className="text-xs text-ink-muted">
            {t("agent.canvasPages", { count: pageCount })}
          </span>
        ) : null}
        {available ? (
          <Link
            className="mt-2 inline-flex w-fit text-xs font-bold text-primary no-underline hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
            params={{ canvasDraftId: item.resourceId, workspaceId }}
            search={{ importImage: false, returnTo }}
            to="/w/$workspaceId/boards/$canvasDraftId"
          >
            {t("agent.openCanvas")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
