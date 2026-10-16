import {
  ArrowRightOutlined,
  BgColorsOutlined,
  BranchesOutlined,
  FileImageOutlined,
  LayoutOutlined,
} from "@ant-design/icons";
import type { AgentThreadView } from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";

import { ArtifactPreview } from "../../components/artifact-preview.js";
import { cn } from "../../lib/cn.js";
import {
  agentCardClassName,
  agentCardIconClassName,
} from "./agent-presentation.js";

type RelatedContent = AgentThreadView["relatedContent"][number];

function ResourceIcon({ kind }: { readonly kind: RelatedContent["kind"] }) {
  if (kind === "canvas") return <LayoutOutlined />;
  if (kind === "workflow") return <BranchesOutlined />;
  if (kind === "brand") return <BgColorsOutlined />;
  return <FileImageOutlined />;
}

export function AgentResourceReference({
  className,
  item,
  onOpen,
  workspaceId,
}: {
  readonly className?: string;
  readonly item: RelatedContent;
  readonly onOpen: (item: RelatedContent) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  function openContextResource(event: React.MouseEvent): void {
    event.preventDefault();
    onOpen(item);
  }
  const title = item.title ?? t(`agent.resourceKind.${item.kind}`);
  const media =
    (item.kind === "asset" || item.kind === "artifact") && item.artifactId;
  return (
    <button
      aria-label={t("agent.openResource", { title })}
      className={cn(
        media
          ? agentCardClassName
          : "flex min-h-8 items-center gap-2 rounded-[9px] px-1.5 py-1 text-left text-xs text-ink-muted transition-colors hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        media
          ? "mt-3 w-fit min-w-64 max-w-[520px] bg-mist text-ink hover:bg-mist-deep"
          : "mt-2 w-fit max-w-full",
        className,
      )}
      onContextMenu={openContextResource}
      onClick={() => onOpen(item)}
      type="button"
    >
      <span
        className={cn(
          media
            ? agentCardIconClassName
            : "grid size-5 shrink-0 place-items-center text-primary",
          "overflow-hidden",
        )}
      >
        {item.artifactId ? (
          <ArtifactPreview
            alt=""
            artifactId={item.artifactId}
            className="size-full"
            imageClassName="size-full object-cover"
            thumbnail
            workspaceId={workspaceId}
          />
        ) : (
          <ResourceIcon kind={item.kind} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <strong
          className={cn(
            "block truncate",
            media ? "text-sm font-semibold" : "text-xs font-medium",
          )}
        >
          {title}
        </strong>
        {media ? (
          <span className="mt-0.5 block text-xs text-ink-muted">
            {t(`agent.resourceKind.${item.kind}`)}
            {item.state === "unavailable"
              ? ` · ${t("agent.resourceStateUnavailable")}`
              : ""}
          </span>
        ) : null}
      </span>
      {!media && item.pageCount ? (
        <span className="shrink-0 text-xs text-muted">
          {t("agent.canvasPages", { count: item.pageCount })}
        </span>
      ) : null}
      {!media && item.state === "unavailable" ? (
        <span className="shrink-0 text-xs text-muted">
          {t("agent.resourceStateUnavailable")}
        </span>
      ) : null}
      <ArrowRightOutlined aria-hidden="true" className="shrink-0 text-muted" />
    </button>
  );
}
