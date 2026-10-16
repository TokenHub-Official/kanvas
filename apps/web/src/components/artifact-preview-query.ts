import { queryOptions } from "@tanstack/react-query";

import { downloadArtifactPreview } from "../api/transport.js";

const PREVIEW_CACHE_MINUTES = 30;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
const PREVIEW_CACHE_MILLISECONDS =
  PREVIEW_CACHE_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

export function artifactPreviewQueryKeyV1(
  workspaceId: string,
  artifactId: string,
) {
  return ["artifacts", workspaceId, artifactId, "thumbnail"] as const;
}

export function artifactPreviewQueryOptionsV1(
  workspaceId: string,
  artifactId: string,
  enabled = true,
) {
  return queryOptions({
    queryKey: artifactPreviewQueryKeyV1(workspaceId, artifactId),
    queryFn: ({ signal }) =>
      downloadArtifactPreview(workspaceId, artifactId, fetch, signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: PREVIEW_CACHE_MILLISECONDS,
    retry: false,
  });
}
