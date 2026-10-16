import { useQuery } from "@tanstack/react-query";

import { fetchWorkspaceAsset } from "../api/transport.js";
import { ArtifactPreview } from "./artifact-preview.js";

export function AssetArtwork({
  alt,
  assetId,
  children,
  className,
  workspaceId,
}: {
  readonly alt: string;
  readonly assetId?: string;
  readonly children: React.ReactNode;
  readonly className: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const asset = useQuery({
    queryKey: ["workspace-asset", workspaceId, assetId, "artwork"],
    queryFn: () => fetchWorkspaceAsset(workspaceId, assetId!),
    enabled: Boolean(assetId),
    retry: false,
  });
  const artifact = asset.data?.currentArtifact;
  const available =
    artifact?.availabilityStatus === "available" &&
    artifact.mediaType?.startsWith("image/");

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden ${className}`}
    >
      {children}
      {available && artifact ? (
        <ArtifactPreview
          alt={alt}
          artifactId={artifact.id}
          className="absolute inset-0 grid size-full place-items-center"
          imageClassName="absolute inset-0 block size-full object-cover"
          thumbnail
          workspaceId={workspaceId}
        />
      ) : null}
    </span>
  );
}
