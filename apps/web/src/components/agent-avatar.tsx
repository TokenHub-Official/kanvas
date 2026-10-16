import kanvasMark from "../assets/brand/kanvas-mark.svg";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import type { AgentHubAgentAvatar } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";

import { fetchWorkspaceAsset } from "../api/transport.js";
import { ArtifactPreview } from "./artifact-preview.js";
import { VisualIdentityMark } from "./visual-identity-symbol.js";
export { visualIdentityIconOptions as agentAvatarIconOptions } from "./visual-identity-symbol.js";

export function AgentAvatar({
  isDefault = false,
  alt,
  avatar,
  canReadAssets,
  className = "size-12 rounded-[14px] text-xl",
  workspaceId,
}: {
  readonly isDefault?: boolean;
  readonly alt: string;
  readonly avatar?: AgentHubAgentAvatar;
  readonly canReadAssets: boolean;
  readonly className?: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const imageAsset = useQuery({
    queryKey: [
      "workspace-asset",
      workspaceId,
      avatar?.kind === "image" ? avatar.assetId : undefined,
      "agent-avatar",
    ],
    queryFn: () =>
      fetchWorkspaceAsset(
        workspaceId,
        avatar?.kind === "image" ? avatar.assetId : "",
      ),
    enabled: !isDefault && canReadAssets && avatar?.kind === "image",
    retry: false,
  });
  if (isDefault) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={`grid shrink-0 place-items-center ${className}`}
      >
        <img
          src={kanvasMark}
          alt=""
          aria-hidden="true"
          className="size-4/5 object-contain"
        />
      </span>
    );
  }
  const artifact = imageAsset.data?.currentArtifact;
  const imageAvailable =
    avatar?.kind === "image" &&
    artifact?.availabilityStatus === "available" &&
    artifact.mediaType?.startsWith("image/");
  if (avatar?.kind === "emoji" || avatar?.kind === "icon") {
    return (
      <VisualIdentityMark value={avatar} alt={alt} className={className} />
    );
  }
  const fallback = <RobotIcon aria-hidden="true" weight="duotone" size="1em" />;

  return (
    <span
      aria-label={alt}
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-black/5 bg-primary/8 text-primary ${className}`}
      role="img"
    >
      {fallback}
      {imageAvailable && artifact ? (
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
