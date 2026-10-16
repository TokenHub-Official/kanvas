import { ReadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { downloadArtifact, fetchWorkspaceAsset } from "../../api/transport.js";
import { useObjectUrl } from "../../components/use-object-url.js";

/** A bounded thumbnail slot; unavailable artwork never changes the tile geometry. */
export function HomeSkillCover({
  workspaceId,
  assetId,
}: {
  readonly workspaceId: string;
  readonly assetId?: string;
}) {
  const asset = useQuery({
    queryKey: ["workspace-asset", workspaceId, assetId, "artwork"],
    queryFn: () => fetchWorkspaceAsset(workspaceId, assetId!),
    enabled: Boolean(assetId),
    retry: false,
  });
  const artifact = asset.data?.currentArtifact;
  const available = Boolean(
    assetId &&
    !asset.isError &&
    artifact?.availabilityStatus === "available" &&
    artifact.mediaType?.startsWith("image/"),
  );
  const preview = useQuery({
    queryKey: ["artifacts", workspaceId, artifact?.id, "content"],
    queryFn: ({ signal }) =>
      downloadArtifact(workspaceId, artifact!.id, fetch, signal),
    enabled: available,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const url = useObjectUrl(
    available && !preview.isError ? preview.data : undefined,
  );
  const [failedUrl, setFailedUrl] = useState<string>();
  const loading =
    Boolean(assetId) && (asset.isPending || (available && preview.isPending));
  return (
    <span
      aria-hidden="true"
      aria-busy={loading}
      className="relative grid aspect-[16/9] w-full place-items-center rounded-control bg-mist/60 text-3xl text-muted"
    >
      {!url || url === failedUrl ? (
        <ReadOutlined
          className={loading ? "animate-pulse motion-reduce:animate-none" : ""}
        />
      ) : null}
      {url && url !== failedUrl ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
          className="absolute inset-0 size-full object-contain"
        />
      ) : null}
    </span>
  );
}
